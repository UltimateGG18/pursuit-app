import { describe, expect, it, vi } from 'vitest';
import {
  createExampleIcpConfig,
  icpSlug,
  type DiscoveryRunDto,
  type IcpConfig,
} from '@pursuit/shared';
import { buildApp } from '../src/app.js';
import { loadEnvOrThrow } from '../src/config/env.js';
import { ApolloClient } from '../src/modules/apollo/apollo-client.js';
import { ApolloService } from '../src/modules/apollo/apollo-service.js';
import { InMemoryIcpRepository } from '../src/modules/icp/in-memory-icp-repository.js';
import { InMemoryIcpAnalysisRepository } from '../src/modules/icp/in-memory-icp-analysis-repository.js';
import { apolloJsonResponse, apolloOrganization, apolloSearchResponse } from './apollo-fixtures.js';
import { parseBody } from './helpers.js';

/**
 * The whole vertical slice, wired the way production wires it:
 *
 *   ICP / criteria
 *        -> POST /api/icps/:id/discover
 *        -> DiscoveryService
 *        -> FirmographicDiscoveryStrategy
 *        -> ApolloService
 *        -> ApolloClient
 *        -> (mocked transport)
 *        -> Apollo DTO -> Zod -> ApolloNormalizer -> CompanyCandidate[]
 *
 * Only the transport is a stub. Every other component is the real one - the
 * real client with its real Zod validation, the real normalizer, the real
 * service, the real Fastify app and error handler - because the property under
 * test is that these pieces compose, and substituting one of them would test
 * the substitute instead.
 *
 * **No live Apollo call is made here, or anywhere in the test suite.** The
 * fixtures are shaped to Apollo's documented organization search contract.
 */

/** Not a credential. */
const API_KEY = 'test-apollo-key';

interface Harness {
  app: Awaited<ReturnType<typeof buildApp>>;
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  icpId: string;
}

async function harness(
  pages: Response[],
  mutate: (config: IcpConfig) => void = () => undefined,
): Promise<Harness> {
  const env = loadEnvOrThrow({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    LOG_LEVEL: 'silent',
    DISCOVERY_PROVIDER: 'apollo',
    APOLLO_API_KEY: API_KEY,
  });

  const fetchMock = vi.fn<typeof fetch>();
  for (const page of pages) fetchMock.mockResolvedValueOnce(page);

  const icpRepository = new InMemoryIcpRepository();
  const config = structuredClone(createExampleIcpConfig());
  mutate(config);
  const record = await icpRepository.create({
    name: config.basicProfile.name,
    slug: icpSlug(config),
    description: null,
    status: 'ACTIVE',
    schemaVersion: config.schemaVersion,
    config,
    submittedConfig: config,
    scoringWeights: config.scoringWeights,
    createdBy: null,
    changeReason: null,
  });

  // The real adapter chain, with only the socket replaced.
  const app = await buildApp({
    env,
    icpRepository,
    analysisRepository: new InMemoryIcpAnalysisRepository(),
    discoveryProvider: new ApolloService({
      client: new ApolloClient({
        apiKey: env.APOLLO_API_KEY,
        baseUrl: env.APOLLO_BASE_URL,
        timeoutMs: env.APOLLO_TIMEOUT_MS,
        maxAttempts: env.APOLLO_MAX_ATTEMPTS,
        retryBaseDelayMs: 0,
        fetchImpl: fetchMock,
        sleepImpl: () => Promise.resolve(),
      }),
      maxPagesPerSearch: env.APOLLO_MAX_PAGES_PER_SEARCH,
    }),
  });
  await app.ready();

  return { app, fetchMock, icpId: record.id };
}

/**
 * The URL of one recorded fetch call. `fetch`'s first argument is a
 * `RequestInfo | URL` union; the client always passes a string.
 */
function requestedUrl(context: Harness, call = 0): string {
  const target = context.fetchMock.mock.calls[call]?.[0];
  return typeof target === 'string' ? target : '';
}

function discover(context: Harness, payload: object = {}) {
  return context.app.inject({
    method: 'POST',
    url: `/api/icps/${context.icpId}/discover`,
    payload,
  });
}

describe('integration: ICP -> discovery -> Apollo -> CompanyCandidate[]', () => {
  it('turns a stored ICP into normalized candidates end to end', async () => {
    const context = await harness([
      apolloJsonResponse(
        apolloSearchResponse(
          [
            apolloOrganization(),
            apolloOrganization({
              id: 'org-2',
              name: 'Tweede Bedrijf N.V.',
              primary_domain: 'tweede.nl',
              website_url: 'tweede.nl',
              country: 'Netherlands',
              city: 'Rotterdam',
              state: null,
              estimated_num_employees: 80,
              technology_names: null,
            }),
          ],
          { total_entries: 2, total_pages: 1 },
        ),
      ),
    ]);

    const response = await discover(context, { limit: 10 });

    expect(response.statusCode).toBe(200);
    const run = parseBody<DiscoveryRunDto>(response.payload).data;
    expect(run?.candidates).toHaveLength(2);

    expect(run?.candidates[0]).toEqual({
      providerRefs: [{ provider: 'apollo', externalId: '5f2a1b3c4d5e6f7a8b9c0d1e' }],
      name: 'Voorbeeld Software B.V.',
      domain: 'voorbeeld-software.nl',
      country: 'NL',
      industry: 'information technology & services',
      employeeCount: 240,
      website: 'http://www.voorbeeld-software.nl/',
      technologies: ['Microsoft Azure', 'Kubernetes', 'Salesforce'],
      locations: ['Amsterdam, North Holland, Netherlands'],
      rawSourceRef: 'apollo:organization:5f2a1b3c4d5e6f7a8b9c0d1e',
    });

    // The second company had a null state and no technologies: those stay
    // unknown rather than becoming empty values.
    expect(run?.candidates[1]).toEqual({
      providerRefs: [{ provider: 'apollo', externalId: 'org-2' }],
      name: 'Tweede Bedrijf N.V.',
      domain: 'tweede.nl',
      country: 'NL',
      industry: 'information technology & services',
      employeeCount: 80,
      website: 'https://tweede.nl/',
      locations: ['Rotterdam, Netherlands'],
      rawSourceRef: 'apollo:organization:org-2',
    });
  });

  it('sends the ICP criteria to Apollo as its own documented filters', async () => {
    const context = await harness(
      [apolloJsonResponse(apolloSearchResponse([apolloOrganization()]))],
      (config) => {
        config.geography.includedCountries = ['NL', 'DE'];
        config.geography.excludedCountries = ['BE'];
        config.companyProfile.industries = ['SOFTWARE_SAAS'];
        config.companyProfile.excludedIndustries = [];
        config.companyProfile.employeeRange = { min: 100, max: 1000 };
      },
    );

    await discover(context, { limit: 10 });

    const url = new URL(requestedUrl(context));
    expect(url.pathname).toBe('/api/v1/mixed_companies/search');
    // Internal ISO-2 codes became Apollo place names at the adapter boundary.
    expect(url.searchParams.getAll('organization_locations[]')).toEqual([
      'Netherlands',
      'Germany',
    ]);
    expect(url.searchParams.getAll('organization_not_locations[]')).toEqual(['Belgium']);
    expect(url.searchParams.getAll('organization_num_employees_ranges[]')).toEqual(['100,1000']);
    expect(url.searchParams.getAll('q_organization_keyword_tags[]')).toContain('software');
  });

  it('walks Apollo pages and merges them into one candidate list', async () => {
    const context = await harness([
      apolloJsonResponse(
        apolloSearchResponse(
          [apolloOrganization({ id: 'p1', primary_domain: 'p1.example' })],
          { page: 1, total_entries: 2, total_pages: 2 },
        ),
      ),
      apolloJsonResponse(
        apolloSearchResponse(
          [apolloOrganization({ id: 'p2', primary_domain: 'p2.example' })],
          { page: 2, total_entries: 2, total_pages: 2 },
        ),
      ),
    ]);

    const response = await discover(context, { limit: 10 });
    const run = parseBody<DiscoveryRunDto>(response.payload).data;

    expect(context.fetchMock).toHaveBeenCalledTimes(2);
    expect(run?.candidates.map((candidate) => candidate.domain)).toEqual([
      'p1.example',
      'p2.example',
    ]);
    expect(run?.meta.pagesFetched).toBe(2);
  });

  it('collapses a company Apollo returned on two pages, keeping both references', async () => {
    const duplicate = apolloOrganization({ id: 'dup-a', primary_domain: 'Shared.Example' });
    const sameCompany = apolloOrganization({ id: 'dup-b', primary_domain: 'www.shared.example' });

    const context = await harness([
      apolloJsonResponse(
        apolloSearchResponse([duplicate], { page: 1, total_entries: 2, total_pages: 2 }),
      ),
      apolloJsonResponse(
        apolloSearchResponse([sameCompany], { page: 2, total_entries: 2, total_pages: 2 }),
      ),
    ]);

    const response = await discover(context, { limit: 10 });
    const run = parseBody<DiscoveryRunDto>(response.payload).data;

    expect(run?.candidates).toHaveLength(1);
    expect(run?.candidates[0]?.providerRefs).toEqual([
      { provider: 'apollo', externalId: 'dup-a' },
      { provider: 'apollo', externalId: 'dup-b' },
    ]);
    expect(run?.meta.duplicatesRemoved).toBe(1);
  });

  it('no Apollo response field reaches the domain model', async () => {
    // The property the plan is most explicit about, asserted on the wire.
    const context = await harness([
      apolloJsonResponse(
        apolloSearchResponse([
          apolloOrganization(),
          // Including fields the DTO accepts but the candidate has no place for.
          apolloOrganization({
            id: 'extra',
            primary_domain: 'extra.example',
            keywords: ['leaky', 'keyword'],
            short_description: 'Should not appear in the domain model.',
            founded_year: 1999,
            postal_code: '1011 AB',
            street_address: 'Damrak 1',
            linkedin_url: 'https://www.linkedin.com/company/extra',
          }),
        ]),
      ),
    ]);

    const response = await discover(context, { limit: 10 });
    const run = parseBody<DiscoveryRunDto>(response.payload).data;

    // 1. No Apollo field *name* survives anywhere in the payload.
    for (const apolloField of [
      'estimated_num_employees',
      'primary_domain',
      'website_url',
      'technology_names',
      'short_description',
      'founded_year',
      'postal_code',
      'street_address',
      'linkedin_url',
      'keywords',
      'organizations',
      'accounts',
      'pagination',
      'per_page',
      'total_entries',
      'total_pages',
    ]) {
      expect(response.payload).not.toContain(apolloField);
    }

    // 2. No Apollo field *value* the contract has no home for leaks either.
    expect(response.payload).not.toContain('Should not appear in the domain model.');
    expect(response.payload).not.toContain('leaky');
    expect(response.payload).not.toContain('Damrak 1');

    // 3. Every candidate key is exactly one from the neutral contract.
    const allowed = new Set([
      'providerRefs',
      'name',
      'domain',
      'country',
      'industry',
      'employeeCount',
      'website',
      'technologies',
      'locations',
      'contacts',
      'rawSourceRef',
    ]);
    for (const candidate of run?.candidates ?? []) {
      for (const key of Object.keys(candidate)) expect(allowed.has(key)).toBe(true);
    }
  });

  it('rejects an Apollo contract change instead of returning half-built companies', async () => {
    // A response missing `pagination` is not an organization search response,
    // whatever else it is. Nothing from it is normalized.
    const context = await harness([apolloJsonResponse({ organizations: [apolloOrganization()] })]);

    const response = await discover(context, { limit: 10 });

    expect(response.statusCode).toBe(502);
    const body = parseBody(response.payload);
    expect(body.error?.code).toBe('DISCOVERY_PROVIDER_INVALID_RESPONSE');
    expect(body.data).toBeNull();
  });

  it('surfaces an Apollo scope refusal as a named, credential-free failure', async () => {
    // Exactly the 403 the supplied API key returns today for this endpoint.
    const context = await harness([
      apolloJsonResponse(
        {
          error:
            'This API key is not authorized to access api/v1/mixed_companies/search. Request an API key from your administrator that includes this endpoint in its configured scope.',
          error_code: 'API_INACCESSIBLE',
        },
        403,
      ),
    ]);

    const response = await discover(context, { limit: 10 });

    expect(response.statusCode).toBe(503);
    const body = parseBody(response.payload);
    expect(body.error?.code).toBe('DISCOVERY_PROVIDER_UNAVAILABLE');
    // Says what to fix, without echoing Apollo's raw body or the credential.
    expect(body.error?.message).toContain('credential');
    expect(response.payload).not.toContain(API_KEY);
  });

  it('reports the whole run without scoring, filtering or ranking anything', async () => {
    const context = await harness(
      [
        apolloJsonResponse(
          apolloSearchResponse(
            [
              // Deliberately outside the ICP's geography and headcount floor.
              apolloOrganization({
                id: 'mismatch',
                name: 'Elsewhere Micro Ltd',
                primary_domain: 'elsewhere.example',
                website_url: 'https://elsewhere.example',
                country: 'Japan',
                city: 'Tokyo',
                state: null,
                estimated_num_employees: 4,
              }),
            ],
            { total_entries: 1, total_pages: 1 },
          ),
        ),
      ],
      (config) => {
        config.geography.includedCountries = ['NL'];
        config.companyProfile.employeeRange = { min: 500, max: 5000 };
      },
    );

    const response = await discover(context, { limit: 10 });
    const run = parseBody<DiscoveryRunDto>(response.payload).data;

    // Recall-first: the mismatch is returned, so the later hard-filter stage
    // can reject it *with a recorded reason* into the cold pool.
    expect(run?.candidates).toHaveLength(1);
    expect(run?.candidates[0]?.country).toBe('JP');
    expect(run?.candidates[0]?.employeeCount).toBe(4);

    // And nothing in the response pretends otherwise.
    for (const forbidden of [
      'score',
      'band',
      'confidence',
      'rejectionReason',
      'suppressed',
      'qualified',
      'rank',
      'signals',
      'evidence',
    ]) {
      expect(response.payload).not.toContain(forbidden);
    }
  });
});
