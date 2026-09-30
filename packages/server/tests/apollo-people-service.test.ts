import { describe, expect, it, vi } from 'vitest';
import type { PeopleQuery } from '@pursuit/shared';
import {
  APOLLO_MAX_PAGE_SIZE,
  type ApolloClient,
  type ApolloPeopleSearchParams,
} from '../src/modules/apollo/apollo-client.js';
import { apolloPeopleSearchResponseSchema } from '../src/modules/apollo/apollo-people-dto.js';
import { ApolloNotConfiguredError, ApolloRateLimitError } from '../src/modules/apollo/apollo-errors.js';
import {
  ApolloPeopleService,
  translatePeopleQuery,
} from '../src/modules/apollo/apollo-people-service.js';
import {
  apolloPeopleResponse,
  apolloPerson,
  type ApolloPersonFixture,
} from './apollo-people-fixtures.js';

/**
 * A stubbed `ApolloClient`.
 *
 * The service is tested against the client *interface* rather than a fetch
 * mock, because query translation and de-duplication are the service's own
 * logic and asserting them through HTTP would test the wrong seam. The client's
 * own behaviour has its own suite.
 */
function stubClient(
  result: { people?: ApolloPersonFixture[]; contacts?: ApolloPersonFixture[] } | Error,
  pagination: { totalEntries?: number; totalPages?: number; omitPagination?: boolean } = {},
) {
  const calls: ApolloPeopleSearchParams[] = [];
  const searchPeople = vi.fn(async (params: ApolloPeopleSearchParams) => {
    calls.push(params);
    if (result instanceof Error) throw result;
    const people = result.people ?? [];
    const contacts = result.contacts ?? [];
    // Parsed through the DTO schema, exactly as the real client does before
    // returning. It is what turns Apollo's JSON `null`s into absent fields, and
    // a stub that skipped it would hand the service a shape it never sees.
    const body = apolloPeopleResponse(people, {
      contacts,
      pagination: {
        page: params.page,
        per_page: params.perPage,
        total_entries: pagination.totalEntries ?? people.length + contacts.length,
        total_pages: pagination.totalPages ?? 1,
      },
    });
    // The shape Apollo actually returned in the field: results, no pagination.
    if (pagination.omitPagination) delete (body as { pagination?: unknown }).pagination;

    return await Promise.resolve(apolloPeopleSearchResponseSchema.parse(body));
  });

  const client = {
    describe: () => ({
      id: 'apollo',
      version: 'v1',
      maxPageSize: APOLLO_MAX_PAGE_SIZE,
      available: true,
    }),
    isConfigured: () => true,
    authHealth: () => Promise.resolve({ healthy: true, loggedIn: true }),
    searchPeople,
  } as unknown as ApolloClient;

  return { client, calls, searchPeople };
}

function query(overrides: Partial<PeopleQuery> = {}): PeopleQuery {
  return {
    buyer: { titles: ['CTO'], seniorities: ['C_LEVEL'], departments: ['IT'] },
    company: { countries: ['NL'], industries: ['SOFTWARE_SAAS'], employeeMin: 50, employeeMax: 500 },
    page: 1,
    perPage: 25,
    ...overrides,
  };
}

describe('translatePeopleQuery - what Apollo can filter on', () => {
  it('translates titles into Apollo\'s free-text form', () => {
    const { filters } = translatePeopleQuery(query({ buyer: { titles: ['CTO', 'VP_IT'] } }));
    // The human label the user saw themselves select, not the catalog code -
    // Apollo matches this against a real job title.
    expect(filters.personTitles).toEqual(['CTO', 'VP IT']);
  });

  it("translates seniorities into Apollo's closed vocabulary", () => {
    const { filters } = translatePeopleQuery(
      query({ buyer: { seniorities: ['C_LEVEL', 'VP', 'HEAD'] } }),
    );
    expect(filters.personSeniorities).toEqual(['c_suite', 'vp', 'head']);
  });

  it('collapses seniorities that share one Apollo tier', () => {
    const { filters } = translatePeopleQuery(query({ buyer: { seniorities: ['MANAGER', 'LEAD'] } }));
    // Apollo has no lead tier; sending `manager` twice would only lengthen the
    // request.
    expect(filters.personSeniorities).toEqual(['manager']);
  });

  it('translates country codes into the place names Apollo matches', () => {
    const { filters } = translatePeopleQuery(
      query({ company: { countries: ['NL', 'DE'], excludedCountries: ['BE'] } }),
    );
    expect(filters.organizationLocations).toEqual(['Netherlands', 'Germany']);
    expect(filters.organizationNotLocations).toEqual(['Belgium']);
  });

  it('sends the employee bounds as one Apollo range', () => {
    const { filters } = translatePeopleQuery(
      query({ company: { employeeMin: 50, employeeMax: 500 } }),
    );
    expect(filters.organizationNumEmployeesRanges).toEqual(['50,500']);
  });

  it('keeps an open bound one-sided instead of accidentally capping it', () => {
    const { filters } = translatePeopleQuery(query({ company: { employeeMin: 500 } }));
    expect(filters.organizationNumEmployeesRanges).toEqual(['500,1000000']);
  });

  it('translates industries into keyword tags', () => {
    const { filters } = translatePeopleQuery(query({ company: { industries: ['SOFTWARE_SAAS'] } }));
    expect(filters.qOrganizationKeywordTags).toEqual(['software', 'saas', 'computer software']);
  });

  it('merges the analysis roles into the same title filter', () => {
    const { filters } = translatePeopleQuery(
      query({ buyer: { titles: ['CTO'], freeTextTitles: ['Head of Digital Transformation'] } }),
    );
    // Apollo ORs these, so the analysis widens recall rather than narrowing it.
    expect(filters.personTitles).toEqual(['CTO', 'Head of Digital Transformation']);
  });

  it('de-duplicates a role the catalog already covers', () => {
    const { filters } = translatePeopleQuery(
      query({ buyer: { titles: ['CTO'], freeTextTitles: ['cto'] } }),
    );
    expect(filters.personTitles).toEqual(['CTO']);
  });

  it('omits an empty filter rather than sending one that matches nothing', () => {
    const { filters } = translatePeopleQuery({ page: 1, perPage: 25 });
    expect(filters).toEqual({});
  });
});

describe('translatePeopleQuery - what it reports as unsupported', () => {
  it('names the departments Apollo has no equivalent for', () => {
    const { filters, unsupported } = translatePeopleQuery(
      query({ buyer: { departments: ['ENGINEERING', 'DATA', 'PROCUREMENT'] } }),
    );

    expect(filters.personDepartments).toEqual(['information_technology']);
    // Named specifically: "departments were not filtered" and "procurement was
    // not filtered" lead a caller to different decisions.
    expect(unsupported).toEqual(['buyer.departments: DATA, PROCUREMENT']);
  });

  it('reports nothing when every department translated', () => {
    const { unsupported } = translatePeopleQuery(
      query({ buyer: { departments: ['ENGINEERING', 'SALES'] } }),
    );
    expect(unsupported).toEqual([]);
  });
});

describe('ApolloPeopleService - one page per call', () => {
  it('sends the page and page size the caller asked for, and nothing else', async () => {
    const { client, calls } = stubClient({ people: [apolloPerson()] });
    await new ApolloPeopleService({ client }).searchPeople(query({ page: 3, perPage: 10 }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ page: 3, perPage: 10 });
  });

  it('returns the provider pagination so a caller can page without guessing', async () => {
    const { client } = stubClient({ people: [apolloPerson()] }, { totalEntries: 431, totalPages: 18 });
    const result = await new ApolloPeopleService({ client }).searchPeople(query({ page: 2 }));

    expect(result.pagination).toEqual({
      page: 2,
      perPage: 25,
      totalEntries: 431,
      totalPages: 18,
      hasMore: true,
    });
  });

  it('still returns the page when Apollo sends no pagination block', async () => {
    // Observed live: `mixed_people/api_search` answered 200 with no
    // `pagination`. The page and page size are known because we sent them; the
    // totals are not, and are left unknown rather than defaulted to zero.
    const { client } = stubClient({ people: [apolloPerson()] }, { omitPagination: true });
    const result = await new ApolloPeopleService({ client }).searchPeople(
      query({ page: 2, perPage: 25 }),
    );

    expect(result.people).toHaveLength(1);
    expect(result.pagination).toEqual({ page: 2, perPage: 25, hasMore: false });
  });

  it('infers that more pages exist from a full page, when no total was given', async () => {
    const people = Array.from({ length: 5 }, (_, index) =>
      apolloPerson({ id: `p${String(index)}`, linkedin_url: null }),
    );
    const { client } = stubClient({ people }, { omitPagination: true });
    const result = await new ApolloPeopleService({ client }).searchPeople(query({ perPage: 5 }));

    // A full page is plausibly not the last one. This is the only signal left
    // when the provider reports no totals, and the pager depends on it.
    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination).not.toHaveProperty('totalEntries');
  });

  it('judges "more pages" on provider rows, not on de-duplicated ones', async () => {
    // Two rows that collapse into one person. Apollo's paging is over its own
    // rows, so a page of 2 that merged to 1 is still a full Apollo page.
    const { client } = stubClient(
      {
        people: [
          apolloPerson({ id: 'p1', linkedin_url: 'https://www.linkedin.com/in/sanne-de-vries' }),
          apolloPerson({ id: 'p2', linkedin_url: 'http://nl.linkedin.com/in/sanne-de-vries/' }),
        ],
      },
      { omitPagination: true },
    );
    const result = await new ApolloPeopleService({ client }).searchPeople(query({ perPage: 2 }));

    expect(result.people).toHaveLength(1);
    expect(result.pagination.hasMore).toBe(true);
  });

  it('normalizes database people and CRM contacts together', async () => {
    const { client } = stubClient({
      people: [apolloPerson({ id: 'p1' })],
      contacts: [apolloPerson({ id: 'c1', linkedin_url: null })],
    });
    const result = await new ApolloPeopleService({ client }).searchPeople(query());

    expect(result.people.map((person) => person.rawSourceRef)).toEqual([
      'apollo:person:p1',
      'apollo:person:c1',
    ]);
  });

  it('collapses one person who appears in both lists', async () => {
    const duplicate = apolloPerson({ id: 'p1' });
    const { client } = stubClient({ people: [duplicate], contacts: [duplicate] });
    const result = await new ApolloPeopleService({ client }).searchPeople(query());

    expect(result.people).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('merges two records of the same person on their LinkedIn profile', async () => {
    // Different Apollo ids, one profile. The URLs differ only in ways that do
    // not change which profile they point at.
    const { client } = stubClient({
      people: [
        apolloPerson({ id: 'p1', linkedin_url: 'https://www.linkedin.com/in/sanne-de-vries' }),
        apolloPerson({ id: 'p2', linkedin_url: 'http://nl.linkedin.com/in/sanne-de-vries/?trk=x' }),
      ],
    });
    const result = await new ApolloPeopleService({ client }).searchPeople(query());

    expect(result.people).toHaveLength(1);
    expect(result.people[0]?.providerRefs.map((ref) => ref.externalId)).toEqual(['p1', 'p2']);
  });

  it('reports unsupported filters on the result', async () => {
    const { client } = stubClient({ people: [] });
    const result = await new ApolloPeopleService({ client }).searchPeople(
      query({ buyer: { departments: ['DATA'] } }),
    );

    expect(result.unsupportedFilters).toEqual(['buyer.departments: DATA']);
  });

  it('propagates a provider failure instead of returning a shorter list', async () => {
    const { client } = stubClient(new ApolloRateLimitError('rate limited', 30));
    await expect(new ApolloPeopleService({ client }).searchPeople(query())).rejects.toBeInstanceOf(
      ApolloRateLimitError,
    );
  });
});

describe('ApolloPeopleService - health', () => {
  it('reports availability without claiming the key can search people', async () => {
    const { client } = stubClient({ people: [] });
    const health = await new ApolloPeopleService({ client }).peopleHealthCheck();

    expect(health.available).toBe(true);
    // Apollo only reveals whether a key's scope covers people search by
    // refusing the search, so a healthy probe must not imply more than it knows.
    expect(health.detail).toContain('people search');
  });

  it('reports a missing credential as a result rather than throwing', async () => {
    const client = {
      describe: () => ({ id: 'apollo', version: 'v1', maxPageSize: 100, available: false }),
      authHealth: () => Promise.reject(new ApolloNotConfiguredError('APOLLO_API_KEY is not configured.')),
    } as unknown as ApolloClient;

    const health = await new ApolloPeopleService({ client }).peopleHealthCheck();
    expect(health.available).toBe(false);
    expect(health.detail).toBe('APOLLO_API_KEY is not configured.');
  });
});
