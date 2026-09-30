import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryQuery } from '@pursuit/shared';
import {
  APOLLO_MAX_PAGE_SIZE,
  type ApolloClient,
  type ApolloOrganizationSearchParams,
} from '../src/modules/apollo/apollo-client.js';
import {
  ApolloRateLimitError,
  ApolloValidationError,
} from '../src/modules/apollo/apollo-errors.js';
import { ApolloService, parseCursor, translateQuery } from '../src/modules/apollo/apollo-service.js';
import {
  apolloOrganization,
  apolloSearchResponse,
  type ApolloOrganizationFixture,
} from './apollo-fixtures.js';

/**
 * A stubbed `ApolloClient`.
 *
 * The service is tested against the client *interface* rather than against a
 * fetch mock, because pagination, page sizing and de-duplication are the
 * service's own logic and asserting them through HTTP would test the wrong
 * seam. The client's own behaviour has its own suite.
 */
function stubClient(
  pages: (ApolloOrganizationFixture[] | Error)[],
  pagination: { totalEntries?: number; totalPages?: number } = {},
) {
  const calls: ApolloOrganizationSearchParams[] = [];
  const searchOrganizations = vi.fn(async (params: ApolloOrganizationSearchParams) => {
    calls.push(params);
    const page = pages[params.page - 1];
    if (page instanceof Error) throw page;
    const organizations = page ?? [];
    return await Promise.resolve(
      apolloSearchResponse(organizations, {
        page: params.page,
        per_page: params.perPage,
        total_entries: pagination.totalEntries ?? organizations.length,
        total_pages: pagination.totalPages ?? pages.length,
      }),
    );
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
    searchOrganizations,
  } as unknown as ApolloClient;

  return { client, calls, searchOrganizations };
}

function service(client: ApolloClient, maxPagesPerSearch = 5) {
  return new ApolloService({ client, maxPagesPerSearch });
}

/** N distinct organizations, so a page is full of different companies. */
function organizations(count: number, prefix = 'org'): ApolloOrganizationFixture[] {
  return Array.from({ length: count }, (_value, index) =>
    apolloOrganization({
      id: `${prefix}-${String(index)}`,
      name: `Company ${prefix}-${String(index)}`,
      primary_domain: `${prefix}-${String(index)}.example`,
      website_url: `https://${prefix}-${String(index)}.example`,
    }),
  );
}

const BASE_QUERY: DiscoveryQuery = {
  geography: { countries: ['NL'] },
  companyProfile: { industries: ['SOFTWARE_SAAS'] },
};

describe('ApolloService - query translation', () => {
  it('translates countries, exclusions, industries and employee bounds', () => {
    const { filters } = translateQuery({
      geography: { countries: ['NL', 'DE'], excludedCountries: ['BE'] },
      companyProfile: { industries: ['SOFTWARE_SAAS'], employeeMin: 50, employeeMax: 500 },
    });

    expect(filters.organizationLocations).toEqual(['Netherlands', 'Germany']);
    expect(filters.organizationNotLocations).toEqual(['Belgium']);
    expect(filters.organizationNumEmployeesRanges).toEqual(['50,500']);
    expect(filters.qOrganizationKeywordTags).toContain('software');
  });

  it('keeps an open employee bound one-sided instead of capping it', () => {
    expect(
      translateQuery({ companyProfile: { industries: [], employeeMin: 500 } }).filters
        .organizationNumEmployeesRanges,
    ).toEqual(['500,1000000']);
    expect(
      translateQuery({ companyProfile: { industries: [], employeeMax: 500 } }).filters
        .organizationNumEmployeesRanges,
    ).toEqual(['1,500']);
  });

  it('sends no employee filter when neither bound is set', () => {
    expect(
      translateQuery({ companyProfile: { industries: ['SOFTWARE_SAAS'] } }).filters
        .organizationNumEmployeesRanges,
    ).toBeUndefined();
  });

  it('names the filters Apollo cannot express rather than dropping them silently', () => {
    const { filters, unsupported } = translateQuery({
      geography: { countries: ['NL'], regions: ['BENELUX'] },
      companyProfile: {
        industries: ['SOFTWARE_SAAS'],
        excludedIndustries: ['NONPROFIT'],
        companyTypes: ['PE_BACKED'],
        maturity: ['SCALE_UP'],
      },
      technology: { requiredTechnologies: ['KUBERNETES'] },
    });

    expect(unsupported).toEqual([
      'geography.regions',
      'companyProfile.excludedIndustries',
      'companyProfile.companyTypes',
      'companyProfile.maturity',
      'technology.requiredTechnologies',
    ]);
    // And nothing invented in their place - notably no guessed technology uid.
    expect(Object.keys(filters).sort()).toEqual([
      'organizationLocations',
      'qOrganizationKeywordTags',
    ]);
  });

  it('skips a value outside the catalog instead of forwarding it', () => {
    // Only reachable through a bug, and a bare `XX` sent to Apollo would return
    // nothing with no explanation.
    expect(
      translateQuery({ geography: { countries: ['NL', 'XX'] } }).filters.organizationLocations,
    ).toEqual(['Netherlands']);
  });
});

describe('ApolloService - pagination', () => {
  it('walks pages until the caller\'s limit is met', async () => {
    const { client, calls } = stubClient(
      [organizations(2, 'a'), organizations(2, 'b'), organizations(2, 'c')],
      { totalEntries: 6, totalPages: 3 },
    );

    const result = await service(client).search({ ...BASE_QUERY, limit: 5 });

    expect(result.candidates).toHaveLength(5);
    expect(result.pagesFetched).toBe(3);
    expect(calls.map((call) => call.page)).toEqual([1, 2, 3]);
    expect(result.totalAvailable).toBe(6);
  });

  it('merges multiple pages into one ordered result', async () => {
    const { client } = stubClient([organizations(2, 'a'), organizations(2, 'b')], {
      totalEntries: 4,
      totalPages: 2,
    });

    const result = await service(client).search({ ...BASE_QUERY, limit: 4 });

    expect(result.candidates.map((candidate) => candidate.domain)).toEqual([
      'a-0.example',
      'a-1.example',
      'b-0.example',
      'b-1.example',
    ]);
  });

  it('stops when Apollo reports no further pages', async () => {
    const { client, calls } = stubClient([organizations(2, 'a')], {
      totalEntries: 2,
      totalPages: 1,
    });

    const result = await service(client).search({ ...BASE_QUERY, limit: 100 });

    expect(calls).toHaveLength(1);
    expect(result.candidates).toHaveLength(2);
    // Apollo is exhausted, so there is nothing to continue from.
    expect(result.nextCursor).toBeUndefined();
  });

  it('stops on an empty page even when Apollo claims more pages', async () => {
    // A stale total would otherwise walk to the page ceiling.
    const { client, calls } = stubClient([organizations(1, 'a'), []], {
      totalEntries: 500,
      totalPages: 50,
    });

    const result = await service(client).search({ ...BASE_QUERY, limit: 100 });

    expect(calls).toHaveLength(2);
    expect(result.candidates).toHaveLength(1);
  });

  it('stops at the page ceiling regardless of the caller\'s limit', async () => {
    const { client, calls } = stubClient(
      Array.from({ length: 10 }, (_value, index) => organizations(2, `p${String(index)}`)),
      { totalEntries: 1000, totalPages: 10 },
    );

    const result = await service(client, 3).search({ ...BASE_QUERY, limit: 200 });

    // A credit per page, so the ceiling is a spend control, not a suggestion.
    expect(calls).toHaveLength(3);
    expect(result.pagesFetched).toBe(3);
    expect(result.candidates).toHaveLength(6);
  });

  it('offers a cursor when it stopped early and Apollo still has pages', async () => {
    const { client } = stubClient(
      Array.from({ length: 10 }, (_value, index) => organizations(2, `p${String(index)}`)),
      { totalEntries: 1000, totalPages: 10 },
    );

    const result = await service(client, 2).search({ ...BASE_QUERY, limit: 200 });

    expect(result.nextCursor).toBe('3');
  });

  it('resumes from a cursor', async () => {
    const { client, calls } = stubClient(
      [organizations(1, 'a'), organizations(1, 'b'), organizations(1, 'c')],
      { totalEntries: 3, totalPages: 3 },
    );

    const result = await service(client).search({ ...BASE_QUERY, limit: 10, cursor: '2' });

    expect(calls.map((call) => call.page)).toEqual([2, 3]);
    expect(result.candidates.map((candidate) => candidate.domain)).toEqual([
      'b-0.example',
      'c-0.example',
    ]);
  });

  it('rejects a malformed cursor rather than silently restarting', () => {
    // Restarting would hand back page 1 and look like Apollo ran out.
    expect(() => parseCursor('not-a-page')).toThrow(ApolloValidationError);
    expect(() => parseCursor('0')).toThrow(ApolloValidationError);
    expect(() => parseCursor('1.5')).toThrow(ApolloValidationError);
    expect(parseCursor(undefined)).toBe(1);
    expect(parseCursor('7')).toBe(7);
  });
});

describe('ApolloService - page size', () => {
  it('asks for only what is still wanted, so a small limit costs a small page', async () => {
    const { client, calls } = stubClient([organizations(5, 'a')], {
      totalEntries: 100,
      totalPages: 4,
    });

    await service(client).search({ ...BASE_QUERY, limit: 5 });

    expect(calls[0]?.perPage).toBe(5);
  });

  it('never asks for more than Apollo\'s documented maximum', async () => {
    const { client, calls } = stubClient([organizations(100, 'a'), organizations(100, 'b')], {
      totalEntries: 1000,
      totalPages: 10,
    });

    await service(client).search({ ...BASE_QUERY, limit: 200 });

    for (const call of calls) expect(call.perPage).toBeLessThanOrEqual(APOLLO_MAX_PAGE_SIZE);
    expect(calls[0]?.perPage).toBe(APOLLO_MAX_PAGE_SIZE);
  });

  it('sends the translated filters on every page', async () => {
    const { client, calls } = stubClient([organizations(1, 'a'), organizations(1, 'b')], {
      totalEntries: 2,
      totalPages: 2,
    });

    await service(client).search({
      geography: { countries: ['NL'] },
      companyProfile: { industries: ['SOFTWARE_SAAS'], employeeMin: 10, employeeMax: 100 },
      limit: 2,
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.organizationLocations).toEqual(['Netherlands']);
      expect(call.organizationNumEmployeesRanges).toEqual(['10,100']);
    }
  });
});

describe('ApolloService - deduplication', () => {
  it('collapses the same company returned on two pages', async () => {
    const duplicate = apolloOrganization({ id: 'dup-1', primary_domain: 'dup.example' });
    const { client } = stubClient(
      [[duplicate, ...organizations(1, 'a')], [duplicate]],
      { totalEntries: 3, totalPages: 2 },
    );

    const result = await service(client).search({ ...BASE_QUERY, limit: 10 });

    expect(result.candidates).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('de-duplicates on the normalized domain, not the raw spelling', async () => {
    const { client } = stubClient(
      [
        [
          apolloOrganization({ id: 'a', primary_domain: 'Example.COM', name: 'Example' }),
          apolloOrganization({ id: 'b', primary_domain: 'www.example.com', name: 'Example Ltd' }),
        ],
      ],
      { totalEntries: 2, totalPages: 1 },
    );

    const result = await service(client).search({ ...BASE_QUERY, limit: 10 });

    expect(result.candidates).toHaveLength(1);
    // Both provider references survive, so entity resolution loses nothing.
    expect(result.candidates[0]?.providerRefs).toEqual([
      { provider: 'apollo', externalId: 'a' },
      { provider: 'apollo', externalId: 'b' },
    ]);
  });

  it('de-duplicates on the provider id when there is no domain', async () => {
    const { client } = stubClient(
      [[{ id: 'same' }, { id: 'same' }, { id: 'other' }]],
      { totalEntries: 3, totalPages: 1 },
    );

    const result = await service(client).search({ ...BASE_QUERY, limit: 10 });

    expect(result.candidates).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('keeps two genuinely different companies apart', async () => {
    const { client } = stubClient([organizations(3, 'a')], { totalEntries: 3, totalPages: 1 });

    const result = await service(client).search({ ...BASE_QUERY, limit: 10 });

    expect(result.candidates).toHaveLength(3);
    expect(result.duplicatesRemoved).toBe(0);
  });
});

describe('ApolloService - error propagation', () => {
  it('propagates a rate limit rather than returning a short result', async () => {
    const { client } = stubClient([new ApolloRateLimitError('rate limited', 30)]);

    await expect(service(client).search({ ...BASE_QUERY, limit: 10 })).rejects.toBeInstanceOf(
      ApolloRateLimitError,
    );
  });

  it('propagates a failure on a later page rather than truncating silently', async () => {
    // A partial page-2 failure presented as a complete result is how a recall
    // stage loses companies invisibly.
    const { client } = stubClient(
      [organizations(2, 'a'), new ApolloValidationError('bad payload')],
      { totalEntries: 10, totalPages: 5 },
    );

    await expect(service(client).search({ ...BASE_QUERY, limit: 10 })).rejects.toBeInstanceOf(
      ApolloValidationError,
    );
  });
});

describe('ApolloService - descriptor and health', () => {
  it('describes itself through the client, with Apollo\'s page ceiling', () => {
    const { client } = stubClient([[]]);
    const descriptor = service(client).describe();

    expect(descriptor.id).toBe('apollo');
    expect(descriptor.maxPageSize).toBe(APOLLO_MAX_PAGE_SIZE);
    expect(descriptor.available).toBe(true);
  });

  it('reports a healthy key without claiming the search scope works', async () => {
    const { client } = stubClient([[]]);
    const health = await service(client).healthCheck();

    expect(health.available).toBe(true);
    expect(health.provider).toBe('apollo');
    // Apollo only reveals endpoint scope by refusing the search, so the health
    // detail must not imply discovery will succeed.
    expect(health.detail).toContain('scope');
  });
});

describe('ApolloService - what it deliberately does not do', () => {
  it('returns every company Apollo gave, applying no ICP judgement', async () => {
    // A sparse company, an out-of-country company and a tiny company all
    // survive: filtering is a later stage, and this one must not pre-empt it.
    const { client } = stubClient(
      [
        [
          apolloOrganization({ id: 'rich' }),
          { id: 'sparse' },
          apolloOrganization({
            id: 'elsewhere',
            country: 'Japan',
            primary_domain: 'elsewhere.example',
            estimated_num_employees: 2,
          }),
        ],
      ],
      { totalEntries: 3, totalPages: 1 },
    );

    const result = await service(client).search({
      geography: { countries: ['NL'] },
      companyProfile: { industries: ['SOFTWARE_SAAS'], employeeMin: 100 },
      limit: 10,
    });

    expect(result.candidates).toHaveLength(3);
    for (const candidate of result.candidates) {
      const record = candidate as unknown as Record<string, unknown>;
      expect('score' in record).toBe(false);
      expect('rejectionReason' in record).toBe(false);
    }
  });
});
