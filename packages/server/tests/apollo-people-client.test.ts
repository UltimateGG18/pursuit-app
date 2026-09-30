import { describe, expect, it, vi } from 'vitest';
import {
  APOLLO_MAX_PAGE,
  APOLLO_MAX_PAGE_SIZE,
  ApolloClient,
  type ApolloLogger,
  type ApolloPeopleSearchParams,
} from '../src/modules/apollo/apollo-client.js';
import {
  ApolloAuthenticationError,
  ApolloNotConfiguredError,
  ApolloProviderError,
  ApolloRateLimitError,
  ApolloValidationError,
} from '../src/modules/apollo/apollo-errors.js';
import { apolloErrorResponse, apolloJsonResponse } from './apollo-fixtures.js';
import {
  apolloPeopleResponse,
  apolloPerson,
  type ApolloPersonFixture,
} from './apollo-people-fixtures.js';

/**
 * The people search transport.
 *
 * Asserts the three things only this layer can get wrong: where the credential
 * travels, where the filters travel, and how a non-2xx becomes a typed error.
 * Query translation is the service's job and has its own suite.
 */

const BASE_URL = 'https://api.apollo.io';
const PEOPLE_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search';
/** Not a credential. Asserted against, so it must be a recognisable literal. */
const API_KEY = 'test-apollo-key';

function client(
  fetchImpl: typeof fetch,
  overrides: { apiKey?: string; logger?: ApolloLogger } = {},
) {
  return new ApolloClient({
    apiKey: overrides.apiKey ?? API_KEY,
    baseUrl: BASE_URL,
    timeoutMs: 5000,
    // One attempt, so a test asserting a failure asserts exactly one call.
    maxAttempts: 1,
    retryBaseDelayMs: 0,
    ...(overrides.logger ? { logger: overrides.logger } : {}),
    fetchImpl,
    sleepImpl: () => Promise.resolve(),
  });
}

function peopleParams(overrides: Partial<ApolloPeopleSearchParams> = {}): ApolloPeopleSearchParams {
  return {
    personTitles: ['CTO'],
    personSeniorities: ['c_suite'],
    organizationLocations: ['Netherlands'],
    page: 1,
    perPage: 25,
    ...overrides,
  };
}

/**
 * A `fetch` stub that records what it was called with.
 *
 * Declared with fetch's own parameters rather than as a bare `vi.fn(() => ...)`
 * so `mock.calls` is typed as the arguments the client actually passes - which
 * is the whole point of the mock, since every assertion below is about the URL,
 * the headers or the body.
 */
function fetchStub(respond: () => Response) {
  // Declared with `fetch`'s own parameter types so the stub is assignable to
  // `typeof fetch` without a cast, and so `mock.calls` is typed.
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(respond()),
  );
}

type FetchStub = ReturnType<typeof fetchStub>;

/**
 * The URL of one recorded call. The client always passes a string, so anything
 * else is reported as an empty URL rather than stringified into
 * `[object Object]` - which would make a failed assertion unreadable.
 */
function requestedUrl(fetchMock: FetchStub, call = 0): string {
  const target = fetchMock.mock.calls[call]?.[0];
  return typeof target === 'string' ? target : '';
}

function requestInit(fetchMock: FetchStub, call = 0): RequestInit {
  return fetchMock.mock.calls[call]?.[1] ?? {};
}

function requestBody(fetchMock: FetchStub, call = 0): Record<string, unknown> {
  const raw = requestInit(fetchMock, call).body;
  return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function okResponse() {
  return apolloJsonResponse(apolloPeopleResponse([apolloPerson()]));
}

describe('ApolloClient.searchPeople - the request', () => {
  it('posts to the documented people search endpoint', async () => {
    const fetchMock = fetchStub(() => okResponse());
    await client(fetchMock).searchPeople(peopleParams());

    expect(requestedUrl(fetchMock)).toBe(PEOPLE_URL);
    expect(requestInit(fetchMock).method).toBe('POST');
  });

  it('sends the credential in the x-api-key header and nowhere else', async () => {
    const fetchMock = fetchStub(() => okResponse());
    await client(fetchMock).searchPeople(peopleParams());

    const headers = requestInit(fetchMock).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(API_KEY);
    // Never in the URL, where it would land in every access log along the path,
    // and never in the body.
    expect(requestedUrl(fetchMock)).not.toContain(API_KEY);
    expect(JSON.stringify(requestBody(fetchMock))).not.toContain(API_KEY);
  });

  it('sends the filters as a JSON body under Apollo\'s own names', async () => {
    const fetchMock = fetchStub(() => okResponse());
    await client(fetchMock).searchPeople(
      peopleParams({
        personTitles: ['CTO', 'VP IT'],
        personSeniorities: ['c_suite'],
        personDepartments: ['information_technology'],
        organizationLocations: ['Netherlands'],
        organizationNotLocations: ['Belgium'],
        organizationNumEmployeesRanges: ['50,500'],
        qOrganizationKeywordTags: ['software'],
        page: 2,
        perPage: 10,
      }),
    );

    const headers = requestInit(fetchMock).headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(requestBody(fetchMock)).toEqual({
      person_titles: ['CTO', 'VP IT'],
      person_seniorities: ['c_suite'],
      person_department_or_subdepartments: ['information_technology'],
      organization_locations: ['Netherlands'],
      organization_not_locations: ['Belgium'],
      organization_num_employees_ranges: ['50,500'],
      q_organization_keyword_tags: ['software'],
      page: 2,
      per_page: 10,
    });
  });

  it('omits an empty filter entirely rather than sending an empty array', async () => {
    const fetchMock = fetchStub(() => okResponse());
    await client(fetchMock).searchPeople(
      peopleParams({ personTitles: [], personSeniorities: undefined, organizationLocations: [] }),
    );

    // `person_titles: []` is a filter matching nothing; sending no key means
    // "do not filter on title". The difference is every lead or none.
    const body = requestBody(fetchMock);
    expect(body).not.toHaveProperty('person_titles');
    expect(body).not.toHaveProperty('person_seniorities');
    expect(body).not.toHaveProperty('organization_locations');
    expect(body).toEqual({ page: 1, per_page: 25 });
  });

  it('refuses to spend a request on a page size Apollo would silently trim', async () => {
    const fetchMock = fetchStub(() => okResponse());

    await expect(
      client(fetchMock).searchPeople(
        peopleParams({ perPage: APOLLO_MAX_PAGE_SIZE + 1 }),
      ),
    ).rejects.toBeInstanceOf(ApolloValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a page beyond the display ceiling', async () => {
    const fetchMock = fetchStub(() => okResponse());

    await expect(
      client(fetchMock).searchPeople(
        peopleParams({ page: APOLLO_MAX_PAGE + 1 }),
      ),
    ).rejects.toBeInstanceOf(ApolloValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not attempt a request with no credential configured', async () => {
    const fetchMock = fetchStub(() => okResponse());

    await expect(
      client(fetchMock, { apiKey: '   ' }).searchPeople(peopleParams()),
    ).rejects.toBeInstanceOf(ApolloNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ApolloClient.searchPeople - the response', () => {
  it('validates the payload and returns it', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse(
        apolloPeopleResponse([apolloPerson()], {
          pagination: { page: 1, per_page: 25, total_entries: 431, total_pages: 18 },
        }),
      ),
    );

    const response = await client(fetchMock).searchPeople(peopleParams());
    expect(response.people).toHaveLength(1);
    expect(response.pagination?.total_entries).toBe(431);
  });

  it('rejects a 200 whose body is not a people search response', async () => {
    // The gate that keeps unvalidated external data out of the domain: an
    // unusable payload is reported, never coerced into valid-looking people.
    //
    // This matters more, not less, now that every field is optional: without
    // the envelope check, an error body or a response from another endpoint
    // would validate into "0 people found" - indistinguishable from a
    // successful search that matched nobody, so a broken integration would
    // look like a narrow ICP.
    const fetchMock = fetchStub(() => apolloJsonResponse({ unexpected: true }));

    await expect(
      client(fetchMock).searchPeople(peopleParams()),
    ).rejects.toBeInstanceOf(ApolloValidationError);
  });

  it('rejects an Apollo error envelope returned with a 200', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse({ error: 'Something went wrong', error_code: 'UNKNOWN' }),
    );

    await expect(
      client(fetchMock).searchPeople(peopleParams()),
    ).rejects.toBeInstanceOf(ApolloValidationError);
  });

  it('accepts a response with people but no pagination block', async () => {
    // Observed live. Requiring `pagination` discarded a usable page of leads
    // over a field carrying no lead data.
    const body = apolloPeopleResponse([apolloPerson()]);
    delete (body as { pagination?: unknown }).pagination;
    const fetchMock = fetchStub(() => apolloJsonResponse(body));

    const response = await client(fetchMock).searchPeople(peopleParams());
    expect(response.people).toHaveLength(1);
    expect(response.pagination).toBeUndefined();
  });

  it('logs the keys Apollo actually sent when a payload fails validation', async () => {
    // A schema failure otherwise says only which field was missing, which
    // cannot distinguish "Apollo dropped a field" from "this is not that kind
    // of response at all" - and the two have different fixes.
    const logger: ApolloLogger = { debug: vi.fn(), warn: vi.fn() };
    const fetchMock = fetchStub(() =>
      apolloJsonResponse({ error: 'nope', error_code: 'UNKNOWN' }),
    );

    await client(fetchMock, { logger }).searchPeople(peopleParams()).catch(() => undefined);

    const entries = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
      JSON.stringify(call[0]),
    );
    const validationEntry = entries.find((entry) => entry.includes('responseKeys')) ?? '';
    expect(validationEntry).toContain('error_code');
    // Key names are structure, not content: no value is ever logged.
    expect(validationEntry).not.toContain('nope');
    expect(validationEntry).not.toContain(API_KEY);
  });

  it('tolerates a response carrying neither list', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse({
        pagination: { page: 1, per_page: 25, total_entries: 0, total_pages: 0 },
      }),
    );

    const response = await client(fetchMock).searchPeople(peopleParams());
    expect(response.people).toEqual([]);
    expect(response.contacts).toEqual([]);
  });

  it('ignores a response field Apollo added without notice', async () => {
    const payload = {
      ...apolloPeopleResponse([{ ...apolloPerson(), brand_new_field: 'x' } as ApolloPersonFixture]),
      breadcrumbs: [{ label: 'anything' }],
    };
    const fetchMock = fetchStub(() => apolloJsonResponse(payload));

    const response = await client(fetchMock).searchPeople(peopleParams());
    expect(response.people).toHaveLength(1);
  });
});

describe('ApolloClient.searchPeople - failures', () => {
  it('maps 401 onto an authentication error', async () => {
    const fetchMock = fetchStub(() => apolloErrorResponse(401, 'Unauthorized', 'UNAUTHORIZED'));

    await expect(
      client(fetchMock).searchPeople(peopleParams()),
    ).rejects.toBeInstanceOf(ApolloAuthenticationError);
  });

  it('maps a 403 scope refusal onto an authentication error naming the endpoint', async () => {
    // Apollo's 403 for a key whose scope excludes people search. The repair is
    // in the Apollo console, not a retry, so the endpoint has to be named.
    const fetchMock = fetchStub(() =>
      apolloErrorResponse(
        403,
        'This API key is not authorized to access api/v1/mixed_people/api_search',
        'API_INACCESSIBLE',
      ),
    );

    const error = await client(fetchMock)
      .searchPeople(peopleParams())
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApolloAuthenticationError);
    expect((error as Error).message).toContain('/api/v1/mixed_people/api_search');
    expect((error as Error).message).not.toContain(API_KEY);
  });

  it('maps 429 onto a rate limit error carrying retry-after', async () => {
    const fetchMock = fetchStub(() =>
      apolloErrorResponse(429, 'Rate limit exceeded', undefined, { 'retry-after': '30' }),
    );

    const error = await client(fetchMock)
      .searchPeople(peopleParams())
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApolloRateLimitError);
    expect((error as ApolloRateLimitError).retryAfterSeconds).toBe(30);
  });

  it('maps 500 onto provider unavailability', async () => {
    const fetchMock = fetchStub(() => apolloErrorResponse(500, 'Internal error'));

    await expect(
      client(fetchMock).searchPeople(peopleParams()),
    ).rejects.toBeInstanceOf(ApolloProviderError);
  });

  it('logs the exchange without the credential or the filters', async () => {
    const logger: ApolloLogger = { debug: vi.fn(), warn: vi.fn() };
    const fetchMock = fetchStub(() =>
      apolloJsonResponse(apolloPeopleResponse([apolloPerson()]), 200, { 'x-request-id': 'req-1' }),
    );

    await client(fetchMock, { logger }).searchPeople(peopleParams());

    const entry = JSON.stringify((logger.debug as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(entry).toContain('/api/v1/mixed_people/api_search');
    expect(entry).toContain('req-1');
    // Neither the key nor anything about who was searched for.
    expect(entry).not.toContain(API_KEY);
    expect(entry).not.toContain('CTO');
  });
});
