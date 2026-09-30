import { describe, expect, it } from 'vitest';
import {
  DiscoveryAuthenticationError,
  DiscoveryInvalidResponseError,
  DiscoveryProviderNotConfiguredError,
  DiscoveryRateLimitError,
  DiscoveryTimeoutError,
  NullPeopleDiscoveryProvider,
  type PeopleDiscoveryProvider,
  type PeopleSearchResult,
  type PersonCandidate,
  type ProspectRunDto,
} from '@pursuit/shared';
import { createBody, createTestApp, detailPaths, parseBody } from './helpers.js';

/**
 * `POST /api/icps/:id/prospects` end to end.
 *
 * Drives the real Fastify app - routes, validation, error handler and response
 * envelope - against a stubbed people provider, so the HTTP contract is tested
 * without an Apollo credential.
 */

const PERSON: PersonCandidate = {
  providerRefs: [{ provider: 'apollo', externalId: '6a1b2c3d4e5f60718293a4b5' }],
  name: 'Sanne de Vries',
  firstName: 'Sanne',
  lastName: 'de Vries',
  title: 'Chief Technology Officer',
  seniority: 'c_suite',
  department: 'information_technology',
  location: 'Utrecht, Utrecht, Netherlands',
  linkedinUrl: 'https://www.linkedin.com/in/sanne-de-vries',
  emailStatus: 'verified',
  company: {
    externalId: '5f2a1b3c4d5e6f7a8b9c0d1e',
    name: 'Voorbeeld Software B.V.',
    domain: 'voorbeeld-software.nl',
    industry: 'information technology & services',
    employeeCount: 240,
  },
  rawSourceRef: 'apollo:person:6a1b2c3d4e5f60718293a4b5',
};

function provider(result: PeopleSearchResult | Error): PeopleDiscoveryProvider {
  return {
    describePeople: () => ({
      id: 'apollo',
      displayName: 'Apollo people search (API v1)',
      version: 'v1',
      maxPageSize: 100,
      available: true,
    }),
    peopleHealthCheck: () =>
      Promise.resolve({
        available: true,
        provider: 'apollo',
        checkedAt: new Date().toISOString(),
        detail: 'Apollo API reachable.',
      }),
    searchPeople: () =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  };
}

function okProvider(
  people: PersonCandidate[] = [PERSON],
  pagination: Partial<PeopleSearchResult['pagination']> = {},
): PeopleDiscoveryProvider {
  return provider({
    people,
    pagination: {
      page: 1,
      perPage: 25,
      totalEntries: people.length,
      totalPages: 1,
      hasMore: false,
      ...pagination,
    },
    duplicatesRemoved: 0,
  });
}

async function seedIcp(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  name = 'Prospect Target ICP',
): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/icps', payload: createBody(name) });
  expect(response.statusCode).toBe(201);
  return parseBody<{ id: string }>(response.payload).data?.id ?? '';
}

describe('POST /api/icps/:id/prospects - success', () => {
  it('returns normalized people in the standard envelope', async () => {
    const { app } = await createTestApp({ peopleProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/prospects` });
    const body = parseBody<ProspectRunDto>(response.payload);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.people).toHaveLength(1);
    expect(body.data?.people[0]?.name).toBe('Sanne de Vries');
  });

  it('accepts an empty body: the ICP already says who to look for', async () => {
    const { app } = await createTestApp({ peopleProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/prospects`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
  });

  it('reports the query that was executed, and it is provider-neutral', async () => {
    const { app } = await createTestApp({ peopleProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/prospects` });
    const meta = parseBody<ProspectRunDto>(response.payload).data?.meta;

    expect(meta?.icpId).toBe(id);
    expect(meta?.icpVersion).toBe(1);
    expect(meta?.queryVersion).toBe('people-query.v1');
    // Catalog vocabulary, never a provider's own words. `c_suite` here would
    // mean Apollo had leaked through the port.
    expect(meta?.query.buyer?.seniorities).toContain('C_LEVEL');
    expect(JSON.stringify(meta?.query)).not.toContain('c_suite');
  });

  it('passes the requested page through to the provider', async () => {
    const { app } = await createTestApp({
      peopleProvider: okProvider([PERSON], { page: 3, totalEntries: 80, totalPages: 4 }),
    });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/prospects`,
      payload: { page: 3, perPage: 25 },
    });
    const data = parseBody<ProspectRunDto>(response.payload).data;

    expect(data?.meta.query.page).toBe(3);
    expect(data?.pagination).toEqual({
      page: 3,
      perPage: 25,
      totalEntries: 80,
      totalPages: 4,
      hasMore: false,
    });
  });

  it('returns an empty list as a successful search, not an error', async () => {
    const { app } = await createTestApp({ peopleProvider: okProvider([]) });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/prospects` });
    const body = parseBody<ProspectRunDto>(response.payload);

    // "No one matched" is a result the caller has to be able to tell apart from
    // "the search failed", so it is a 200 with an empty list and live meta.
    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.people).toEqual([]);
    expect(body.data?.meta.returned).toBe(0);
  });

  it('forwards the filters the provider could not apply', async () => {
    const { app } = await createTestApp({
      peopleProvider: provider({
        people: [],
        pagination: { page: 1, perPage: 25, totalEntries: 0, totalPages: 0, hasMore: false },
        duplicatesRemoved: 0,
        unsupportedFilters: ['buyer.departments: DATA'],
      }),
    });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/prospects` });
    expect(parseBody<ProspectRunDto>(response.payload).data?.meta.unsupportedFilters).toEqual([
      'buyer.departments: DATA',
    ]);
  });
});

describe('POST /api/icps/:id/prospects - validation', () => {
  it('rejects a page size above the contract ceiling', async () => {
    const { app } = await createTestApp({ peopleProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/prospects`,
      payload: { perPage: 5000 },
    });

    expect(response.statusCode).toBe(400);
    expect(detailPaths(parseBody(response.payload))).toContain('perPage');
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    const { app } = await createTestApp({ peopleProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/prospects`,
      payload: { personTitles: ['CTO'] },
    });

    // A filter override the API does not support must fail, not be silently
    // dropped into a search the caller believes was narrowed.
    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-UUID ICP id', async () => {
    const { app } = await createTestApp({ peopleProvider: okProvider() });
    const response = await app.inject({ method: 'POST', url: '/api/icps/not-a-uuid/prospects' });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for an ICP that does not exist', async () => {
    const { app } = await createTestApp({ peopleProvider: okProvider() });
    const response = await app.inject({
      method: 'POST',
      url: '/api/icps/11111111-2222-3333-4444-555555555555/prospects',
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for an analysis that does not belong to this ICP', async () => {
    const { app } = await createTestApp({ peopleProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/prospects`,
      payload: { analysisId: '11111111-2222-3333-4444-555555555555' },
    });

    // Naming an analysis that is not there is a request error, not a silently
    // narrower search than the caller asked for.
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/icps/:id/prospects - provider failures', () => {
  async function failsWith(error: Error): Promise<{ status: number; code: string; message: string }> {
    const { app } = await createTestApp({ peopleProvider: provider(error) });
    const id = await seedIcp(app);
    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/prospects` });
    const body = parseBody(response.payload);
    return {
      status: response.statusCode,
      code: body.error?.code ?? '',
      message: body.error?.message ?? '',
    };
  }

  it('reports a missing credential as a named configuration problem', async () => {
    const result = await failsWith(
      new DiscoveryProviderNotConfiguredError(
        'apollo',
        'APOLLO_API_KEY is not configured. Add it to packages/server/.env and restart the API.',
      ),
    );

    expect(result.status).toBe(503);
    expect(result.code).toBe('DISCOVERY_PROVIDER_UNAVAILABLE');
    // A configuration mistake is only fixable if it is named.
    expect(result.message).toContain('APOLLO_API_KEY');
  });

  it('reports a rejected credential as unavailability, not as a 401 on our API', async () => {
    const result = await failsWith(
      new DiscoveryAuthenticationError('apollo', 'Apollo rejected the configured key (HTTP 401)'),
    );

    // The caller is authenticated; our upstream is not.
    expect(result.status).toBe(503);
    expect(result.code).toBe('DISCOVERY_PROVIDER_UNAVAILABLE');
    expect(result.message).toContain('credential');
  });

  it('passes a rate limit through as 429 with the wait', async () => {
    const result = await failsWith(new DiscoveryRateLimitError('apollo', 'rate limited', 30));

    expect(result.status).toBe(429);
    expect(result.code).toBe('DISCOVERY_PROVIDER_RATE_LIMITED');
    expect(result.message).toContain('30s');
  });

  it('reports a timeout as 504', async () => {
    const result = await failsWith(new DiscoveryTimeoutError('apollo', 10000));
    expect(result.status).toBe(504);
    expect(result.code).toBe('DISCOVERY_PROVIDER_TIMEOUT');
  });

  it('reports an unreadable provider payload as 502', async () => {
    const result = await failsWith(
      new DiscoveryInvalidResponseError('apollo', 'The Apollo people search response did not match'),
    );
    expect(result.status).toBe(502);
    expect(result.code).toBe('DISCOVERY_PROVIDER_INVALID_RESPONSE');
  });

  it("never forwards the provider's own message to the client", async () => {
    const result = await failsWith(
      new DiscoveryRateLimitError(
        'apollo',
        'https://api.apollo.io/api/v1/mixed_people/api_search returned 429 for key sk-secret',
      ),
    );

    expect(result.message).not.toContain('api.apollo.io');
    expect(result.message).not.toContain('sk-secret');
  });
});

describe('prospect search with no provider configured', () => {
  it('boots, serves ICPs, and reports only the prospect endpoint as unavailable', async () => {
    const { app } = await createTestApp({ peopleProvider: new NullPeopleDiscoveryProvider() });
    const id = await seedIcp(app);

    // The ICP itself keeps working - "the system works with no data provider
    // configured" has to be enforceable, not aspirational.
    expect((await app.inject({ method: 'GET', url: `/api/icps/${id}` })).statusCode).toBe(200);

    const health = await app.inject({ method: 'GET', url: '/api/prospects/health' });
    expect(parseBody<{ available: boolean }>(health.payload).data?.available).toBe(false);

    const search = await app.inject({ method: 'POST', url: `/api/icps/${id}/prospects` });
    expect(search.statusCode).toBe(503);
    expect(parseBody(search.payload).error?.message).toContain('DISCOVERY_PROVIDER');
  });
});
