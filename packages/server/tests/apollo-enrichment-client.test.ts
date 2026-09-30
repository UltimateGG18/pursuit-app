import { describe, expect, it, vi } from 'vitest';
import {
  APOLLO_BULK_MATCH_MAX,
  ApolloClient,
  type ApolloLogger,
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
  apolloBulkMatchResponse,
  apolloEnrichedPerson,
} from './apollo-enrichment-fixtures.js';

/**
 * The enrichment transport.
 *
 * Asserts the four things only this layer can get wrong: where the credential
 * travels, where the identifiers travel, which reveal flags are sent, and how a
 * non-2xx becomes a typed error. Deciding *who* to enrich and what to do with a
 * failure belongs to the service above and has its own suite.
 */

const BASE_URL = 'https://api.apollo.io';
const MATCH_URL = 'https://api.apollo.io/api/v1/people/match';
const BULK_URL = 'https://api.apollo.io/api/v1/people/bulk_match';
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

function fetchStub(respond: () => Response) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(respond()),
  );
}

type FetchStub = ReturnType<typeof fetchStub>;

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

function bulkOk() {
  return apolloJsonResponse(apolloBulkMatchResponse([apolloEnrichedPerson()]));
}

describe('ApolloClient.matchPerson', () => {
  it('posts to the documented people enrichment endpoint', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse({ person: apolloEnrichedPerson() }),
    );
    await client(fetchMock).matchPerson({ id: '6a1b2c3d4e5f60718293a4b5' });

    expect(requestedUrl(fetchMock)).toBe(MATCH_URL);
    expect(requestInit(fetchMock).method).toBe('POST');
  });

  it('sends the credential in the x-api-key header and nowhere else', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse({ person: apolloEnrichedPerson() }),
    );
    await client(fetchMock).matchPerson({ id: 'abc123' });

    const headers = requestInit(fetchMock).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(API_KEY);
    expect(requestedUrl(fetchMock)).not.toContain(API_KEY);
    expect(JSON.stringify(requestBody(fetchMock))).not.toContain(API_KEY);
  });

  it('sends the person id under Apollo\'s own key name', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse({ person: apolloEnrichedPerson() }),
    );
    await client(fetchMock).matchPerson({ id: '6a1b2c3d4e5f60718293a4b5' });

    expect(requestBody(fetchMock)).toEqual({ id: '6a1b2c3d4e5f60718293a4b5' });
  });

  it('accepts a 200 that carries no person, because that is a no-match', async () => {
    const fetchMock = fetchStub(() => apolloJsonResponse({}));
    const result = await client(fetchMock).matchPerson({ id: 'unknown-person' });

    // Not a validation error: Apollo answering "I cannot identify them" is a
    // result the caller has to be able to read as NO_MATCH.
    expect(result.person).toBeUndefined();
  });

  it('parses the email and phone numbers the search endpoint never returns', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse({ person: apolloEnrichedPerson() }),
    );
    const result = await client(fetchMock).matchPerson({ id: 'abc123' });

    expect(result.person?.email).toBe('sanne.de.vries@example.com');
    expect(result.person?.phone_numbers?.[0]?.sanitized_number).toBe('+31205550142');
  });
});

describe('ApolloClient - enrichment request flags', () => {
  it('omits the reveal flags entirely when phone reveal is off', async () => {
    const fetchMock = fetchStub(() => bulkOk());
    await client(fetchMock).bulkMatchPeople([{ id: 'abc123' }], {
      revealPhoneNumbers: false,
    });

    const body = requestBody(fetchMock);
    expect(body['reveal_phone_number']).toBeUndefined();
    expect(body['poll_only']).toBeUndefined();
  });

  it('sends poll_only alongside reveal_phone_number, because there is no webhook', async () => {
    const fetchMock = fetchStub(() => bulkOk());
    await client(fetchMock).bulkMatchPeople([{ id: 'abc123' }], {
      revealPhoneNumbers: true,
      pollOnly: true,
    });

    const body = requestBody(fetchMock);
    expect(body['reveal_phone_number']).toBe(true);
    // Apollo requires a webhook_url for an async reveal unless the request is
    // poll-only, and this application has no webhook receiver to give it.
    expect(body['poll_only']).toBe(true);
    expect(body['webhook_url']).toBeUndefined();
  });

  it('never asks for personal email addresses', async () => {
    const fetchMock = fetchStub(() => bulkOk());
    await client(fetchMock).bulkMatchPeople([{ id: 'abc123' }], {
      revealPhoneNumbers: true,
    });

    // A different consent question with a different legal basis. A flag that is
    // absent cannot be turned on by accident later.
    expect(requestBody(fetchMock)['reveal_personal_emails']).toBeUndefined();
  });

  it('omits empty identifiers rather than sending blank strings', async () => {
    const fetchMock = fetchStub(() => bulkOk());
    await client(fetchMock).bulkMatchPeople([{ id: 'abc123', firstName: '   ' }], {
      revealPhoneNumbers: false,
    });

    const details = requestBody(fetchMock)['details'] as Record<string, unknown>[];
    expect(details[0]).toEqual({ id: 'abc123' });
  });
});

describe('ApolloClient.bulkMatchPeople', () => {
  it('posts to the documented bulk enrichment endpoint', async () => {
    const fetchMock = fetchStub(() => bulkOk());
    await client(fetchMock).bulkMatchPeople([{ id: 'abc123' }], {
      revealPhoneNumbers: false,
    });

    expect(requestedUrl(fetchMock)).toBe(BULK_URL);
    expect(requestInit(fetchMock).method).toBe('POST');
  });

  it('sends every person under the details array, in order', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse(apolloBulkMatchResponse([apolloEnrichedPerson(), null])),
    );
    await client(fetchMock).bulkMatchPeople(
      [{ id: 'first' }, { linkedinUrl: 'https://www.linkedin.com/in/second' }],
      { revealPhoneNumbers: false },
    );

    expect(requestBody(fetchMock)['details']).toEqual([
      { id: 'first' },
      { linkedin_url: 'https://www.linkedin.com/in/second' },
    ]);
  });

  it('accepts a batch of exactly the documented maximum', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse(
        apolloBulkMatchResponse(Array.from({ length: APOLLO_BULK_MATCH_MAX }, () => null)),
      ),
    );
    const people = Array.from({ length: APOLLO_BULK_MATCH_MAX }, (_, index) => ({
      id: `person-${String(index)}`,
    }));

    await expect(
      client(fetchMock).bulkMatchPeople(people, { revealPhoneNumbers: false }),
    ).resolves.toBeDefined();
  });

  it('refuses an oversized batch before the request is spent', async () => {
    const fetchMock = fetchStub(() => bulkOk());
    const people = Array.from({ length: APOLLO_BULK_MATCH_MAX + 1 }, (_, index) => ({
      id: `person-${String(index)}`,
    }));

    // Apollo answers an oversized batch by enriching its own maximum, so a
    // caller that believed otherwise would silently lose the remainder while
    // being billed for what did land.
    await expect(
      client(fetchMock).bulkMatchPeople(people, { revealPhoneNumbers: false }),
    ).rejects.toBeInstanceOf(ApolloValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty batch without spending a request', async () => {
    const fetchMock = fetchStub(() => bulkOk());

    await expect(
      client(fetchMock).bulkMatchPeople([], { revealPhoneNumbers: false }),
    ).rejects.toBeInstanceOf(ApolloValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves nulls in the matches array, because the join is positional', async () => {
    const fetchMock = fetchStub(() =>
      apolloJsonResponse(
        apolloBulkMatchResponse([null, apolloEnrichedPerson({ id: 'second' })]),
      ),
    );
    const result = await client(fetchMock).bulkMatchPeople([{ id: 'a' }, { id: 'b' }], {
      revealPhoneNumbers: false,
    });

    // Dropping the null would attribute the second person's contact details to
    // the first - the single worst thing this stage could do.
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toBeNull();
    expect(result.matches[1]?.id).toBe('second');
  });

  it('rejects a payload that is not an enrichment response at all', async () => {
    const fetchMock = fetchStub(() => apolloJsonResponse({ organizations: [] }));

    // Every field is optional, so without the envelope gate this would validate
    // as "nobody was enriched" - a broken integration that looks like a
    // provider with no data.
    await expect(
      client(fetchMock).bulkMatchPeople([{ id: 'abc' }], { revealPhoneNumbers: false }),
    ).rejects.toBeInstanceOf(ApolloValidationError);
  });
});

describe('ApolloClient - enrichment failures', () => {
  it('reports a missing credential without making a request', async () => {
    const fetchMock = fetchStub(() => bulkOk());

    await expect(
      client(fetchMock, { apiKey: '' }).bulkMatchPeople([{ id: 'abc' }], {
        revealPhoneNumbers: false,
      }),
    ).rejects.toBeInstanceOf(ApolloNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 401 onto an authentication error', async () => {
    const fetchMock = fetchStub(() => apolloErrorResponse(401, 'Unauthorized'));

    await expect(
      client(fetchMock).bulkMatchPeople([{ id: 'abc' }], { revealPhoneNumbers: false }),
    ).rejects.toBeInstanceOf(ApolloAuthenticationError);
  });

  it('maps a 403 scope refusal onto an authentication error, naming the endpoint', async () => {
    const fetchMock = fetchStub(() =>
      apolloErrorResponse(403, 'This API key is not authorized', 'API_INACCESSIBLE'),
    );

    // Apollo is up and the key is valid; its plan simply does not include
    // enrichment. The repair is in the Apollo console, not in a retry.
    await expect(
      client(fetchMock).bulkMatchPeople([{ id: 'abc' }], { revealPhoneNumbers: false }),
    ).rejects.toMatchObject({
      name: 'ApolloAuthenticationError',
      message: expect.stringContaining('/api/v1/people/bulk_match') as unknown as string,
    });
  });

  it('maps 429 onto a rate limit error and does not retry it', async () => {
    const fetchMock = fetchStub(() => apolloErrorResponse(429, 'Too many requests'));

    await expect(
      client(fetchMock).bulkMatchPeople([{ id: 'abc' }], { revealPhoneNumbers: false }),
    ).rejects.toBeInstanceOf(ApolloRateLimitError);
    // Hammering an exhausted window makes it worse and buys nothing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 500 onto a provider error', async () => {
    const fetchMock = fetchStub(() => apolloErrorResponse(500, 'Internal error'));

    await expect(
      client(fetchMock).bulkMatchPeople([{ id: 'abc' }], { revealPhoneNumbers: false }),
    ).rejects.toBeInstanceOf(ApolloProviderError);
  });

  it('never logs a contact detail or the credential', async () => {
    const logged: object[] = [];
    const logger: ApolloLogger = {
      debug: (payload) => logged.push(payload),
      warn: (payload) => logged.push(payload),
    };
    const fetchMock = fetchStub(() => bulkOk());

    await client(fetchMock, { logger }).bulkMatchPeople([{ id: 'abc123' }], {
      revealPhoneNumbers: true,
    });

    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain('sanne.de.vries@example.com');
    expect(serialized).not.toContain('+31205550142');
  });
});
