import { describe, expect, it } from 'vitest';
import {
  DiscoveryInvalidResponseError,
  DiscoveryProviderNotConfiguredError,
  DiscoveryRateLimitError,
  DiscoveryTimeoutError,
  NullDiscoveryProvider,
  type CompanyCandidate,
  type CompanyDiscoveryProvider,
  type DiscoveryRunDto,
  type DiscoverySearchResult,
} from '@pursuit/shared';
import { createBody, createTestApp, detailPaths, parseBody } from './helpers.js';

const CANDIDATE: CompanyCandidate = {
  providerRefs: [{ provider: 'apollo', externalId: '5f2a1b3c4d5e6f7a8b9c0d1e' }],
  name: 'Voorbeeld Software B.V.',
  domain: 'voorbeeld-software.nl',
  country: 'NL',
  industry: 'information technology & services',
  employeeCount: 240,
  website: 'https://voorbeeld-software.nl/',
  technologies: ['Microsoft Azure'],
  locations: ['Amsterdam, North Holland, Netherlands'],
  rawSourceRef: 'apollo:organization:5f2a1b3c4d5e6f7a8b9c0d1e',
};

function provider(result: DiscoverySearchResult | Error): CompanyDiscoveryProvider {
  return {
    describe: () => ({
      id: 'apollo',
      displayName: 'Apollo organization search (API v1)',
      version: 'v1',
      maxPageSize: 100,
      available: true,
    }),
    healthCheck: () =>
      Promise.resolve({
        available: true,
        provider: 'apollo',
        checkedAt: new Date().toISOString(),
        detail: 'Apollo API reachable.',
      }),
    search: () =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  };
}

function okProvider(candidates: CompanyCandidate[] = [CANDIDATE]): CompanyDiscoveryProvider {
  return provider({ candidates, pagesFetched: 1, duplicatesRemoved: 0 });
}

/** Creates an ICP through the real API, then returns its id. */
async function seedIcp(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  name = 'Discovery Target ICP',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/icps',
    payload: createBody(name),
  });
  expect(response.statusCode).toBe(201);
  return parseBody<{ id: string }>(response.payload).data?.id ?? '';
}

describe('POST /api/icps/:id/discover - success', () => {
  it('returns normalized candidates in the standard envelope', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/discover`,
      payload: { limit: 5 },
    });

    expect(response.statusCode).toBe(200);
    const body = parseBody<DiscoveryRunDto>(response.payload);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();

    const candidates = body.data?.candidates ?? [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(CANDIDATE);
  });

  it('returns the run meta needed to reproduce the search', async () => {
    const { app } = await createTestApp({
      discoveryProvider: provider({
        candidates: [CANDIDATE],
        pagesFetched: 2,
        duplicatesRemoved: 3,
        totalAvailable: 918,
        nextCursor: '3',
      }),
    });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/discover`,
      payload: { limit: 5 },
    });

    const meta = parseBody<DiscoveryRunDto>(response.payload).data?.meta;
    expect(meta?.icpId).toBe(id);
    expect(meta?.icpVersion).toBe(1);
    expect(meta?.provider).toBe('apollo');
    expect(meta?.strategies).toEqual(['FIRMOGRAPHIC']);
    expect(meta?.requestedLimit).toBe(5);
    expect(meta?.returned).toBe(1);
    expect(meta?.duplicatesRemoved).toBe(3);
    expect(meta?.pagesFetched).toBe(2);
    expect(meta?.totalAvailable).toBe(918);
    expect(meta?.nextCursor).toBe('3');
    // The provider-neutral query, so a client can see what was actually asked.
    expect(meta?.query.geography?.countries?.length).toBeGreaterThan(0);
  });

  it('accepts a request with no body at all', async () => {
    // The ICP already says what to look for.
    const { app } = await createTestApp({ discoveryProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/discover` });

    expect(response.statusCode).toBe(200);
    expect(parseBody<DiscoveryRunDto>(response.payload).data?.meta.requestedLimit).toBe(25);
  });

  it('returns an empty candidate list rather than a 404 when nothing matches', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider([]) });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/discover` });

    expect(response.statusCode).toBe(200);
    expect(parseBody<DiscoveryRunDto>(response.payload).data?.candidates).toEqual([]);
  });

  it('exposes no Apollo field name anywhere in the response', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/discover` });

    for (const leaked of [
      'estimated_num_employees',
      'primary_domain',
      'website_url',
      'technology_names',
      'organizations',
      'per_page',
      'total_entries',
      'q_organization_keyword_tags',
    ]) {
      expect(response.payload).not.toContain(leaked);
    }
  });
});

describe('POST /api/icps/:id/discover - validation', () => {
  it('rejects a non-UUID ICP id', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });

    const response = await app.inject({ method: 'POST', url: '/api/icps/not-a-uuid/discover' });

    expect(response.statusCode).toBe(400);
    const body = parseBody(response.payload);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(detailPaths(body)).toContain('id');
  });

  it('rejects a limit outside the contract', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/discover`,
      payload: { limit: 5000 },
    });

    expect(response.statusCode).toBe(400);
    expect(detailPaths(parseBody(response.payload))).toContain('limit');
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/discover`,
      payload: { limit: 5, minimumScore: 80 },
    });

    // A silently ignored `minimumScore` would look like scoring was applied.
    expect(response.statusCode).toBe(400);
    expect(parseBody(response.payload).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown strategy name', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/discover`,
      payload: { strategies: ['TELEPATHY'] },
    });

    expect(response.statusCode).toBe(400);
    expect(parseBody(response.payload).error?.code).toBe('VALIDATION_ERROR');
  });

  it('reports a request for an unimplemented strategy as a bad request', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });
    const id = await seedIcp(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/icps/${id}/discover`,
      payload: { strategies: ['SEMANTIC'] },
    });

    expect(response.statusCode).toBe(400);
    const body = parseBody(response.payload);
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toContain('SEMANTIC');
  });

  it('returns NOT_FOUND for an unknown ICP', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });

    const response = await app.inject({
      method: 'POST',
      url: '/api/icps/11111111-1111-4111-8111-111111111111/discover',
    });

    expect(response.statusCode).toBe(404);
    expect(parseBody(response.payload).error?.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/icps/:id/discover - provider failures', () => {
  it('maps a rate limit to 429 and passes on the retry advice', async () => {
    const { app } = await createTestApp({
      discoveryProvider: provider(new DiscoveryRateLimitError('apollo', 'rate limited', 42)),
    });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/discover` });

    expect(response.statusCode).toBe(429);
    const body = parseBody(response.payload);
    expect(body.error?.code).toBe('DISCOVERY_PROVIDER_RATE_LIMITED');
    expect(body.error?.message).toContain('42s');
  });

  it('maps a timeout to 504', async () => {
    const { app } = await createTestApp({
      discoveryProvider: provider(new DiscoveryTimeoutError('apollo', 10000)),
    });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/discover` });

    expect(response.statusCode).toBe(504);
    expect(parseBody(response.payload).error?.code).toBe('DISCOVERY_PROVIDER_TIMEOUT');
  });

  it('maps an unreadable provider payload to 502', async () => {
    const { app } = await createTestApp({
      discoveryProvider: provider(
        new DiscoveryInvalidResponseError('apollo', 'contract mismatch', [
          { path: 'apollo.pagination', message: 'Required' },
        ]),
      ),
    });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/discover` });

    expect(response.statusCode).toBe(502);
    const body = parseBody(response.payload);
    expect(body.error?.code).toBe('DISCOVERY_PROVIDER_INVALID_RESPONSE');
    // The failing field survives, so an operator can see what changed.
    expect(detailPaths(body)).toContain('apollo.pagination');
  });

  it('names the missing setting when no provider is configured', async () => {
    // `DISCOVERY_PROVIDER` defaults to `none`, so this is the default install.
    const { app } = await createTestApp();
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/discover` });

    expect(response.statusCode).toBe(503);
    const body = parseBody(response.payload);
    expect(body.error?.code).toBe('DISCOVERY_PROVIDER_UNAVAILABLE');
    expect(body.error?.message).toContain('DISCOVERY_PROVIDER');
    expect(body.error?.message).toContain('APOLLO_API_KEY');
  });

  it('reports a rejected credential as unavailable, naming the credential', async () => {
    const { app } = await createTestApp({
      discoveryProvider: provider(
        new DiscoveryProviderNotConfiguredError(
          'apollo',
          'APOLLO_API_KEY is not configured. Add it to packages/server/.env and restart the API.',
        ),
      ),
    });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/discover` });

    expect(response.statusCode).toBe(503);
    expect(parseBody(response.payload).error?.message).toContain('APOLLO_API_KEY');
  });

  it('never leaks a provider credential into an error response', async () => {
    const { app } = await createTestApp({
      discoveryProvider: provider(
        new DiscoveryRateLimitError('apollo', 'x-api-key=super-secret-value rejected', 5),
      ),
    });
    const id = await seedIcp(app);

    const response = await app.inject({ method: 'POST', url: `/api/icps/${id}/discover` });

    // The provider's own words stay in the server log; the client gets our copy.
    expect(response.payload).not.toContain('super-secret-value');
    expect(response.payload).not.toContain('x-api-key');
  });
});

describe('GET /api/discovery/health', () => {
  it('reports the configured provider', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });

    const response = await app.inject({ method: 'GET', url: '/api/discovery/health' });

    expect(response.statusCode).toBe(200);
    const body = parseBody<{ available: boolean; provider: string }>(response.payload);
    expect(body.data?.available).toBe(true);
    expect(body.data?.provider).toBe('apollo');
  });

  it('reports unavailability instead of failing when nothing is configured', async () => {
    const { app } = await createTestApp({ discoveryProvider: new NullDiscoveryProvider() });

    const response = await app.inject({ method: 'GET', url: '/api/discovery/health' });

    // A health probe must be total: an unconfigured provider is a result.
    expect(response.statusCode).toBe(200);
    expect(parseBody<{ available: boolean }>(response.payload).data?.available).toBe(false);
  });
});

describe('GET /health', () => {
  it('reports the discovery provider alongside the model provider', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });

    const response = await app.inject({ method: 'GET', url: '/health' });

    const body = parseBody<{
      discoveryProvider: { id: string; maxPageSize: number };
      discoveryQueryVersion: string;
      modelProvider: { id: string };
    }>(response.payload);

    expect(body.data?.discoveryProvider.id).toBe('apollo');
    expect(body.data?.discoveryProvider.maxPageSize).toBe(100);
    expect(body.data?.discoveryQueryVersion).toBe('discovery-query.v1');
    // The existing model reporting is untouched.
    expect(body.data?.modelProvider.id).toBe('none');
  });
});

describe('existing ICP endpoints keep working with discovery wired in', () => {
  it('still creates, reads and lists ICPs', async () => {
    const { app } = await createTestApp({ discoveryProvider: okProvider() });
    const id = await seedIcp(app, 'Untouched ICP');

    const read = await app.inject({ method: 'GET', url: `/api/icps/${id}` });
    expect(read.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/icps' });
    expect(list.statusCode).toBe(200);
    expect(parseBody<{ total: number }>(list.payload).data?.total).toBe(1);
  });
});
