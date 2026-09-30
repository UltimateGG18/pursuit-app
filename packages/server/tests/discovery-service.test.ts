import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DiscoveryRateLimitError,
  DiscoveryStrategyUnsupportedError,
  createExampleIcpConfig,
  icpSlug,
  type CompanyCandidate,
  type CompanyDiscoveryProvider,
  type DiscoveryQuery,
  type DiscoverySearchResult,
  type DiscoveryStrategy,
  type IcpConfig,
} from '@pursuit/shared';
import { AppError } from '../src/shared/errors.js';
import { DiscoveryService } from '../src/modules/discovery/discovery-service.js';
import {
  FirmographicDiscoveryStrategy,
  type CompanyDiscoveryStrategy,
  type DiscoveryStrategyContext,
  type DiscoveryStrategyRun,
} from '../src/modules/discovery/discovery-strategy.js';
import { InMemoryIcpRepository } from '../src/modules/icp/in-memory-icp-repository.js';

function candidate(id: string, domain?: string): CompanyCandidate {
  return {
    providerRefs: [{ provider: 'stub', externalId: id }],
    name: `Company ${id}`,
    ...(domain !== undefined ? { domain } : {}),
    rawSourceRef: `stub:organization:${id}`,
  };
}

function stubProvider(
  result: DiscoverySearchResult | Error,
): { provider: CompanyDiscoveryProvider; queries: DiscoveryQuery[] } {
  const queries: DiscoveryQuery[] = [];
  return {
    queries,
    provider: {
      describe: () => ({
        id: 'stub',
        displayName: 'Stub provider',
        version: 'v9',
        maxPageSize: 100,
        available: true,
      }),
      healthCheck: () =>
        Promise.resolve({
          available: true,
          provider: 'stub',
          checkedAt: new Date().toISOString(),
          detail: 'ok',
        }),
      search: (query) => {
        queries.push(query);
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
    },
  };
}

/** A second strategy, so cross-strategy merging can be tested. */
function fakeStrategy(
  name: DiscoveryStrategy,
  candidates: CompanyCandidate[],
): CompanyDiscoveryStrategy {
  const query: DiscoveryQuery = { limit: 10 };
  return {
    strategy: name,
    buildQuery: () => query,
    discover: (_context: DiscoveryStrategyContext): Promise<DiscoveryStrategyRun> =>
      Promise.resolve({
        strategy: name,
        query,
        result: { candidates, pagesFetched: 1, duplicatesRemoved: 0 },
      }),
  };
}

async function seedIcp(
  repository: InMemoryIcpRepository,
  mutate: (config: IcpConfig) => void = () => undefined,
): Promise<{ id: string; version: number; config: IcpConfig }> {
  const config = structuredClone(createExampleIcpConfig());
  mutate(config);
  const record = await repository.create({
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
  return { id: record.id, version: record.version, config };
}

describe('DiscoveryService - orchestration', () => {
  it('calls the provider only through the strategy abstraction', async () => {
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository);
    const { provider, queries } = stubProvider({
      candidates: [candidate('a', 'a.example')],
      pagesFetched: 1,
      duplicatesRemoved: 0,
    });
    const strategy = new FirmographicDiscoveryStrategy(provider);
    const discover = vi.spyOn(strategy, 'discover');

    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [strategy],
    });
    const run = await service.discoverForIcp(icp.id, { limit: 10 });

    expect(discover).toHaveBeenCalledTimes(1);
    expect(queries).toHaveLength(1);
    expect(run.candidates).toHaveLength(1);
  });

  it('returns normalized candidates and an auditable meta block', async () => {
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository);
    const { provider } = stubProvider({
      candidates: [candidate('a', 'a.example'), candidate('b', 'b.example')],
      pagesFetched: 2,
      duplicatesRemoved: 1,
      totalAvailable: 412,
      nextCursor: '3',
      unsupportedFilters: ['companyProfile.companyTypes'],
    });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    const run = await service.discoverForIcp(icp.id, { limit: 10 });

    expect(run.meta.icpId).toBe(icp.id);
    expect(run.meta.icpVersion).toBe(icp.version);
    expect(run.meta.strategies).toEqual(['FIRMOGRAPHIC']);
    expect(run.meta.provider).toBe('stub');
    expect(run.meta.providerVersion).toBe('v9');
    expect(run.meta.queryVersion).toBe('discovery-query.v1');
    expect(run.meta.requestedLimit).toBe(10);
    expect(run.meta.returned).toBe(2);
    expect(run.meta.duplicatesRemoved).toBe(1);
    expect(run.meta.pagesFetched).toBe(2);
    expect(run.meta.totalAvailable).toBe(412);
    expect(run.meta.nextCursor).toBe('3');
    // What the provider could not filter on is reported, never hidden.
    expect(run.meta.unsupportedFilters).toEqual(['companyProfile.companyTypes']);
    expect(run.meta.durationMs).toBeGreaterThanOrEqual(0);
    // The executed query is reported, so a result is reproducible.
    expect(run.meta.query.geography?.countries).toEqual(icp.config.geography.includedCountries);
  });

  it('caps the result at the requested limit', async () => {
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository);
    const { provider } = stubProvider({
      candidates: ['a', 'b', 'c', 'd'].map((id) => candidate(id, `${id}.example`)),
      pagesFetched: 1,
      duplicatesRemoved: 0,
    });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    const run = await service.discoverForIcp(icp.id, { limit: 2 });
    expect(run.candidates).toHaveLength(2);
  });

  it('reports a missing ICP as NOT_FOUND', async () => {
    const repository = new InMemoryIcpRepository();
    const { provider } = stubProvider({ candidates: [], pagesFetched: 0, duplicatesRemoved: 0 });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    const error = await service
      .discoverForIcp('11111111-1111-4111-8111-111111111111', { limit: 10 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('NOT_FOUND');
  });
});

describe('DiscoveryService - strategy selection', () => {
  it('runs the strategies the ICP configured, when they exist', async () => {
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository, (config) => {
      config.evidenceDiscovery.discoveryStrategies = ['FIRMOGRAPHIC'];
    });
    const { provider } = stubProvider({ candidates: [], pagesFetched: 1, duplicatesRemoved: 0 });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    const run = await service.discoverForIcp(icp.id, { limit: 10 });
    expect(run.meta.strategies).toEqual(['FIRMOGRAPHIC']);
  });

  it('runs only the implemented strategies when an ICP also asks for others', async () => {
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository, (config) => {
      config.evidenceDiscovery.discoveryStrategies = ['FIRMOGRAPHIC', 'SIGNAL_FIRST'];
      config.evidenceDiscovery.keywordGroups = [];
    });
    const { provider } = stubProvider({ candidates: [], pagesFetched: 1, duplicatesRemoved: 0 });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    const run = await service.discoverForIcp(icp.id, { limit: 10 });
    // A valid configuration for a system being built incrementally.
    expect(run.meta.strategies).toEqual(['FIRMOGRAPHIC']);
  });

  it('refuses rather than silently narrowing when no requested strategy exists', async () => {
    // An ICP asking only for SEMANTIC that quietly ran firmographic discovery
    // would look like a working search returning poor results.
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository);
    const { provider } = stubProvider({ candidates: [], pagesFetched: 0, duplicatesRemoved: 0 });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    const error = await service
      .discoverForIcp(icp.id, { limit: 10, strategies: ['SEMANTIC', 'LOOK_ALIKE'] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DiscoveryStrategyUnsupportedError);
    expect((error as Error).message).toContain('SEMANTIC');
    expect((error as Error).message).toContain('FIRMOGRAPHIC');
  });

  it('honours an explicit strategy override', async () => {
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository, (config) => {
      config.evidenceDiscovery.discoveryStrategies = ['FIRMOGRAPHIC', 'SIGNAL_FIRST'];
    });
    const { provider } = stubProvider({ candidates: [], pagesFetched: 1, duplicatesRemoved: 0 });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    const run = await service.discoverForIcp(icp.id, {
      limit: 10,
      strategies: ['FIRMOGRAPHIC'],
    });
    expect(run.meta.strategies).toEqual(['FIRMOGRAPHIC']);
  });
});

describe('DiscoveryService - merging', () => {
  it('de-duplicates across strategies and merges provider references', async () => {
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository, (config) => {
      config.evidenceDiscovery.discoveryStrategies = ['FIRMOGRAPHIC', 'SIGNAL_FIRST'];
    });
    const { provider } = stubProvider({
      candidates: [candidate('a', 'shared.example')],
      pagesFetched: 1,
      duplicatesRemoved: 0,
    });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [
        new FirmographicDiscoveryStrategy(provider),
        // The same company found a second way: the expected case.
        fakeStrategy('SIGNAL_FIRST', [
          {
            providerRefs: [{ provider: 'stub', externalId: 'b' }],
            name: 'Shared Company',
            domain: 'shared.example',
            rawSourceRef: 'stub:organization:b',
          },
        ]),
      ],
    });

    const run = await service.discoverForIcp(icp.id, { limit: 10 });

    expect(run.candidates).toHaveLength(1);
    expect(run.candidates[0]?.providerRefs).toEqual([
      { provider: 'stub', externalId: 'a' },
      { provider: 'stub', externalId: 'b' },
    ]);
    expect(run.meta.duplicatesRemoved).toBe(1);
    expect(run.meta.strategies).toEqual(['FIRMOGRAPHIC', 'SIGNAL_FIRST']);
  });
});

describe('DiscoveryService - failure handling', () => {
  it('propagates a provider failure rather than returning a partial result', async () => {
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository);
    const { provider } = stubProvider(
      new DiscoveryRateLimitError('stub', 'rate limited', 30),
    );
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    await expect(service.discoverForIcp(icp.id, { limit: 10 })).rejects.toBeInstanceOf(
      DiscoveryRateLimitError,
    );
  });
});

describe('DiscoveryService - what it deliberately does not do', () => {
  it('adds no score, band, confidence or candidate state to a candidate', async () => {
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository);
    const { provider } = stubProvider({
      candidates: [candidate('a', 'a.example')],
      pagesFetched: 1,
      duplicatesRemoved: 0,
    });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    const run = await service.discoverForIcp(icp.id, { limit: 10 });
    const record = run.candidates[0] as unknown as Record<string, unknown>;

    for (const forbidden of [
      'score',
      'finalScore',
      'rawScore',
      'band',
      'confidence',
      'penalty',
      'rejectionReason',
      'state',
      'suppressed',
      'qualified',
      'signals',
      'evidence',
    ]) {
      expect(forbidden in record).toBe(false);
    }
  });

  it('does not apply the ICP\'s hard must-have rules to the returned candidates', async () => {
    /**
     * The example ICP requires companies in its target geography with a
     * headcount floor. A candidate breaching both still comes back:
     * hard filtering is a later stage, and dropping it here would make the
     * cold pool - which has to record *why* a company was rejected -
     * impossible to build.
     */
    const repository = new InMemoryIcpRepository();
    const icp = await seedIcp(repository, (config) => {
      config.geography.includedCountries = ['NL'];
      config.companyProfile.employeeRange = { min: 500, max: 5000 };
    });
    const breachesEveryRule: CompanyCandidate = {
      providerRefs: [{ provider: 'stub', externalId: 'tiny' }],
      name: 'Tiny Elsewhere Ltd',
      domain: 'tiny.example',
      country: 'JP',
      employeeCount: 3,
      rawSourceRef: 'stub:organization:tiny',
    };
    const { provider } = stubProvider({
      candidates: [breachesEveryRule],
      pagesFetched: 1,
      duplicatesRemoved: 0,
    });
    const service = new DiscoveryService({
      icpRepository: repository,
      provider,
      strategies: [new FirmographicDiscoveryStrategy(provider)],
    });

    const run = await service.discoverForIcp(icp.id, { limit: 10 });
    expect(run.candidates).toHaveLength(1);
    expect(run.candidates[0]?.country).toBe('JP');
  });

  it('contains no provider HTTP code', () => {
    // A structural assertion, because this is the boundary the plan is most
    // explicit about: DiscoveryService must not own provider-specific HTTP.
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'modules', 'discovery', 'discovery-service.ts'),
      'utf8',
    );

    for (const forbidden of ['fetch(', 'apollo', 'Apollo', 'x-api-key', 'https://', 'axios']) {
      expect(source).not.toContain(forbidden);
    }
  });
});

