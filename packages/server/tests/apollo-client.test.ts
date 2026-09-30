import { describe, expect, it, vi } from 'vitest';
import {
  APOLLO_MAX_PAGE,
  APOLLO_MAX_PAGE_SIZE,
  ApolloClient,
  type ApolloLogger,
} from '../src/modules/apollo/apollo-client.js';
import {
  ApolloAuthenticationError,
  ApolloNetworkError,
  ApolloNotConfiguredError,
  ApolloProviderError,
  ApolloRateLimitError,
  ApolloTimeoutError,
  ApolloValidationError,
} from '../src/modules/apollo/apollo-errors.js';
import {
  apolloErrorResponse,
  apolloJsonResponse,
  apolloOrganization,
  apolloSearchResponse,
} from './apollo-fixtures.js';

const BASE_URL = 'https://api.apollo.io';
const SEARCH_URL = 'https://api.apollo.io/api/v1/mixed_companies/search';
/** Not a credential. Asserted against, so it must be a recognisable literal. */
const API_KEY = 'test-apollo-key';

function client(
  fetchImpl: typeof fetch,
  overrides: {
    apiKey?: string;
    timeoutMs?: number;
    maxAttempts?: number;
    retryBaseDelayMs?: number;
    logger?: ApolloLogger;
  } = {},
) {
  return new ApolloClient({
    apiKey: overrides.apiKey ?? API_KEY,
    baseUrl: BASE_URL,
    timeoutMs: overrides.timeoutMs ?? 5000,
    // One attempt by default, so a test asserting a failure asserts exactly one
    // call. The retry has its own tests, which opt in.
    maxAttempts: overrides.maxAttempts ?? 1,
    retryBaseDelayMs: overrides.retryBaseDelayMs ?? 0,
    ...(overrides.logger ? { logger: overrides.logger } : {}),
    fetchImpl,
    // Backoff is asserted through the sleep calls, never actually waited on.
    sleepImpl: () => Promise.resolve(),
  });
}

function searchParams(page = 1, perPage = 25) {
  return { organizationLocations: ['Netherlands'], page, perPage };
}

/**
 * The URL of one recorded fetch call.
 *
 * `fetch`'s first argument is a `RequestInfo | URL` union; the client always
 * passes a string, so anything else is reported as an empty URL rather than
 * stringified into `[object Object]`.
 */
function requestedUrl(fetchMock: { mock: { calls: unknown[][] } }, call = 0): string {
  const target = fetchMock.mock.calls[call]?.[0];
  return typeof target === 'string' ? target : '';
}

function requestInit(fetchMock: { mock: { calls: unknown[][] } }, call = 0): RequestInit {
  return (fetchMock.mock.calls[call]?.[1] as RequestInit | undefined) ?? {};
}

describe('ApolloClient - successful request', () => {
  it('posts to the documented organization search endpoint with the key in a header', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloJsonResponse(apolloSearchResponse([apolloOrganization()])));

    const result = await client(fetchMock).searchOrganizations(searchParams());

    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]?.id).toBe('5f2a1b3c4d5e6f7a8b9c0d1e');
    expect(result.pagination.total_entries).toBe(1);

    const init = requestInit(fetchMock);
    expect(init.method).toBe('POST');
    expect(requestedUrl(fetchMock).startsWith(SEARCH_URL)).toBe(true);

    // The credential travels in `x-api-key` and nowhere else.
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(API_KEY);
    expect(requestedUrl(fetchMock)).not.toContain(API_KEY);
  });

  it('sends Apollo filters as repeated query parameters, not in the body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloJsonResponse(apolloSearchResponse([])));

    await client(fetchMock).searchOrganizations({
      organizationLocations: ['Netherlands', 'Germany'],
      organizationNotLocations: ['Belgium'],
      organizationNumEmployeesRanges: ['50,500'],
      qOrganizationKeywordTags: ['software', 'saas'],
      page: 2,
      perPage: 50,
    });

    const url = new URL(requestedUrl(fetchMock));
    expect(url.searchParams.getAll('organization_locations[]')).toEqual([
      'Netherlands',
      'Germany',
    ]);
    expect(url.searchParams.getAll('organization_not_locations[]')).toEqual(['Belgium']);
    expect(url.searchParams.getAll('organization_num_employees_ranges[]')).toEqual(['50,500']);
    expect(url.searchParams.getAll('q_organization_keyword_tags[]')).toEqual(['software', 'saas']);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('per_page')).toBe('50');

    // The filters are in the URL per Apollo's documented convention; the body
    // is an empty JSON object, so no filter is sent twice.
    expect(requestInit(fetchMock).body).toBe('{}');
  });

  it('omits an empty filter entirely rather than sending a parameter matching nothing', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloJsonResponse(apolloSearchResponse([])));

    await client(fetchMock).searchOrganizations({
      organizationLocations: [],
      qOrganizationKeywordTags: ['   '],
      page: 1,
      perPage: 25,
    });

    const url = new URL(requestedUrl(fetchMock));
    expect(url.searchParams.has('organization_locations[]')).toBe(false);
    expect(url.searchParams.has('q_organization_keyword_tags[]')).toBe(false);
  });
});

describe('ApolloClient - configuration', () => {
  it('reports a missing key without attempting a request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const apollo = client(fetchMock, { apiKey: '   ' });

    expect(apollo.isConfigured()).toBe(false);
    expect(apollo.describe().available).toBe(false);
    await expect(apollo.searchOrganizations(searchParams())).rejects.toBeInstanceOf(
      ApolloNotConfiguredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a page size above Apollo\'s documented maximum before spending a request', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      client(fetchMock).searchOrganizations(searchParams(1, APOLLO_MAX_PAGE_SIZE + 1)),
    ).rejects.toBeInstanceOf(ApolloValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a page beyond Apollo\'s display ceiling', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      client(fetchMock).searchOrganizations(searchParams(APOLLO_MAX_PAGE + 1)),
    ).rejects.toBeInstanceOf(ApolloValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ApolloClient - transport failures', () => {
  it('reports a timeout when the request exceeds the budget', async () => {
    // Resolves only when the caller aborts, which is what a hung socket does.
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    await expect(
      client(fetchMock, { timeoutMs: 5 }).searchOrganizations(searchParams()),
    ).rejects.toBeInstanceOf(ApolloTimeoutError);
  });

  it('reports a network failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(client(fetchMock).searchOrganizations(searchParams())).rejects.toBeInstanceOf(
      ApolloNetworkError,
    );
  });
});

describe('ApolloClient - retry', () => {
  it('retries a 5xx and returns the eventual success', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apolloErrorResponse(503, 'Service Unavailable'))
      .mockResolvedValueOnce(apolloJsonResponse(apolloSearchResponse([apolloOrganization()])));

    const result = await client(fetchMock, { maxAttempts: 2 }).searchOrganizations(searchParams());

    expect(result.organizations).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network failure and surfaces it when every attempt fails', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      client(fetchMock, { maxAttempts: 3 }).searchOrganizations(searchParams()),
    ).rejects.toBeInstanceOf(ApolloNetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces the provider error when every 5xx attempt fails', async () => {
    // A fresh Response per call, because a body can only be read once and real
    // fetch hands back a new one each time.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(apolloErrorResponse(500, 'Internal Server Error')));

    await expect(
      client(fetchMock, { maxAttempts: 2 }).searchOrganizations(searchParams()),
    ).rejects.toBeInstanceOf(ApolloProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable 4xx', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloErrorResponse(422, 'Unprocessable Entity'));

    await expect(
      client(fetchMock, { maxAttempts: 3 }).searchOrganizations(searchParams()),
    ).rejects.toBeInstanceOf(ApolloValidationError);
    // The request we built is not acceptable; asking again cannot change that.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry an authentication failure', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloErrorResponse(401, 'Unauthorized'));

    await expect(
      client(fetchMock, { maxAttempts: 3 }).searchOrganizations(searchParams()),
    ).rejects.toBeInstanceOf(ApolloAuthenticationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a rate limit, so an exhausted window is not made worse', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloErrorResponse(429, 'Rate limit exceeded'));

    await expect(
      client(fetchMock, { maxAttempts: 3 }).searchOrganizations(searchParams()),
    ).rejects.toBeInstanceOf(ApolloRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ApolloClient - error mapping', () => {
  it('maps a 403 API_INACCESSIBLE to an authentication failure naming the endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      apolloErrorResponse(
        403,
        'This API key is not authorized to access api/v1/mixed_companies/search.',
        'API_INACCESSIBLE',
      ),
    );

    const error = await client(fetchMock)
      .searchOrganizations(searchParams())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApolloAuthenticationError);
    expect((error as Error).message).toContain('/api/v1/mixed_companies/search');
    // Apollo's own explanation is forwarded: it is the actionable part.
    expect((error as Error).message).toContain('API_INACCESSIBLE');
  });

  it('carries the retry-after Apollo reported on a rate limit', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        apolloErrorResponse(429, 'Rate limit exceeded', 'RATE_LIMITED', { 'retry-after': '42' }),
      );

    const error = await client(fetchMock)
      .searchOrganizations(searchParams())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApolloRateLimitError);
    expect((error as ApolloRateLimitError).retryAfterSeconds).toBe(42);
  });

  it('reports a non-JSON body without pretending it was a payload', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html><body>Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const error = await client(fetchMock)
      .searchOrganizations(searchParams())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApolloProviderError);
    expect((error as Error).message).toContain('502');
  });
});

describe('ApolloClient - response validation', () => {
  it('rejects a 200 whose payload is not an organization search response', async () => {
    // `pagination` missing entirely: not a search response, whatever else it is.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloJsonResponse({ organizations: [] }));

    const error = await client(fetchMock)
      .searchOrganizations(searchParams())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApolloValidationError);
    // The failing field is named, so an operator can see what changed.
    expect((error as ApolloValidationError).details.map((detail) => detail.path)).toContain(
      'apollo.pagination',
    );
  });

  it('rejects an organization with no id rather than normalizing it', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      apolloJsonResponse({
        organizations: [{ name: 'No Id B.V.' }],
        pagination: { page: 1, per_page: 25, total_entries: 1, total_pages: 1 },
      }),
    );

    await expect(client(fetchMock).searchOrganizations(searchParams())).rejects.toBeInstanceOf(
      ApolloValidationError,
    );
  });

  it('accepts an organization carrying unknown fields, and strips them', async () => {
    // Apollo adds response fields without notice; a new one must not be an outage.
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      apolloJsonResponse(
        apolloSearchResponse([
          { ...apolloOrganization(), some_new_apollo_field: 'surprise' } as never,
        ]),
      ),
    );

    const result = await client(fetchMock).searchOrganizations(searchParams());

    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]).not.toHaveProperty('some_new_apollo_field');
  });

  it('treats a null organizations array as an empty page', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      apolloJsonResponse({
        organizations: null,
        pagination: { page: 1, per_page: 25, total_entries: 0, total_pages: 0 },
      }),
    );

    const result = await client(fetchMock).searchOrganizations(searchParams());
    expect(result.organizations).toEqual([]);
  });
});

describe('ApolloClient - logging', () => {
  it('logs the status and Apollo request ids, and never the API key', async () => {
    const entries: object[] = [];
    const logger: ApolloLogger = {
      debug: (payload) => entries.push(payload),
      warn: (payload) => entries.push(payload),
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      apolloJsonResponse(apolloSearchResponse([apolloOrganization()]), 200, {
        'x-request-id': '29f28a62-f454-4075-a829-8db0dabf7867',
        'x-http-request-id': '8319047334718566467',
        'x-minute-requests-left': '48',
      }),
    );

    await client(fetchMock, { logger }).searchOrganizations(searchParams());

    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(entry.status).toBe(200);
    expect(entry.path).toBe('/api/v1/mixed_companies/search');
    expect(entry.requestId).toBe('29f28a62-f454-4075-a829-8db0dabf7867');
    expect(entry.httpRequestId).toBe('8319047334718566467');
    expect(entry.minuteRequestsLeft).toBe('48');

    // The whole log, serialized, must not contain the credential - nor the
    // query string, which is where the filters live.
    expect(JSON.stringify(entries)).not.toContain(API_KEY);
    expect(JSON.stringify(entries)).not.toContain('organization_locations');
  });

  it('never puts the API key in an error message', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloErrorResponse(401, 'Unauthorized', 'UNAUTHORIZED'));

    const error = await client(fetchMock)
      .searchOrganizations(searchParams())
      .catch((caught: unknown) => caught);

    expect((error as Error).message).not.toContain(API_KEY);
    // It names the *setting* to fix, which is the actionable half.
    expect((error as Error).message).toContain('APOLLO_API_KEY');
  });
});

describe('ApolloClient - auth health', () => {
  it('reports a healthy, logged-in key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloJsonResponse({ healthy: true, is_logged_in: true }));

    await expect(client(fetchMock).authHealth()).resolves.toEqual({
      healthy: true,
      loggedIn: true,
    });
    expect(requestedUrl(fetchMock)).toBe('https://api.apollo.io/api/v1/auth/health');
    expect(requestInit(fetchMock).method).toBe('GET');
  });

  it('surfaces a rejected key as an authentication failure', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apolloErrorResponse(401, 'Unauthorized'));

    await expect(client(fetchMock).authHealth()).rejects.toBeInstanceOf(ApolloAuthenticationError);
  });
});
