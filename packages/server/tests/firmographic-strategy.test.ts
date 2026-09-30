import { describe, expect, it, vi } from 'vitest';
import {
  createExampleIcpConfig,
  type CompanyDiscoveryProvider,
  type DiscoveryQuery,
  type DiscoverySearchResult,
  type IcpConfig,
} from '@pursuit/shared';
import { FirmographicDiscoveryStrategy } from '../src/modules/discovery/discovery-strategy.js';

/** A provider that records the query it was handed and returns nothing. */
function recordingProvider() {
  const queries: DiscoveryQuery[] = [];
  const provider: CompanyDiscoveryProvider = {
    describe: () => ({
      id: 'stub',
      displayName: 'Stub',
      version: '1',
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
    search: vi.fn((query: DiscoveryQuery): Promise<DiscoverySearchResult> => {
      queries.push(query);
      return Promise.resolve({ candidates: [], pagesFetched: 1, duplicatesRemoved: 0 });
    }),
  };
  return { provider, queries };
}

function config(mutate: (config: IcpConfig) => void = () => undefined): IcpConfig {
  const value = structuredClone(createExampleIcpConfig());
  mutate(value);
  return value;
}

function buildQuery(icp: IcpConfig, limit = 25, cursor?: string): DiscoveryQuery {
  const { provider } = recordingProvider();
  return new FirmographicDiscoveryStrategy(provider).buildQuery({
    config: icp,
    limit,
    ...(cursor !== undefined ? { cursor } : {}),
  });
}

describe('FirmographicDiscoveryStrategy - translating ICP criteria into a query', () => {
  it('identifies itself as the P0 firmographic strategy', () => {
    const { provider } = recordingProvider();
    expect(new FirmographicDiscoveryStrategy(provider).strategy).toBe('FIRMOGRAPHIC');
  });

  it('carries the ICP geography onto the query', () => {
    const icp = config((value) => {
      value.geography.includedCountries = ['NL', 'BE'];
      value.geography.excludedCountries = ['LU'];
      value.geography.regions = ['BENELUX'];
    });

    expect(buildQuery(icp).geography).toEqual({
      countries: ['NL', 'BE'],
      excludedCountries: ['LU'],
      regions: ['BENELUX'],
    });
  });

  it('carries the ICP company profile onto the query', () => {
    const icp = config((value) => {
      value.companyProfile.industries = ['SOFTWARE_SAAS', 'IT_SERVICES'];
      value.companyProfile.excludedIndustries = ['NONPROFIT'];
      value.companyProfile.employeeRange = { min: 50, max: 500 };
      value.companyProfile.companyTypes = ['PE_BACKED'];
      value.companyProfile.maturityStages = ['SCALE_UP'];
    });

    expect(buildQuery(icp).companyProfile).toEqual({
      industries: ['SOFTWARE_SAAS', 'IT_SERVICES'],
      excludedIndustries: ['NONPROFIT'],
      employeeMin: 50,
      employeeMax: 500,
      companyTypes: ['PE_BACKED'],
      maturity: ['SCALE_UP'],
    });
  });

  it('omits an employee bound the ICP did not set, rather than inventing one', () => {
    // A fabricated bound would be indistinguishable from the user's own choice.
    const onlyMin = buildQuery(config((value) => (value.companyProfile.employeeRange = { min: 25 })));
    expect(onlyMin.companyProfile?.employeeMin).toBe(25);
    expect('employeeMax' in (onlyMin.companyProfile ?? {})).toBe(false);

    const neither = buildQuery(config((value) => (value.companyProfile.employeeRange = {})));
    expect('employeeMin' in (neither.companyProfile ?? {})).toBe(false);
    expect('employeeMax' in (neither.companyProfile ?? {})).toBe(false);
  });

  it('omits an empty optional list rather than sending an empty filter', () => {
    const query = buildQuery(
      config((value) => {
        value.geography.excludedCountries = [];
        value.geography.regions = [];
        value.companyProfile.excludedIndustries = [];
        value.companyProfile.companyTypes = [];
        value.companyProfile.maturityStages = [];
        value.technology.requiredTechnologies = [];
        value.technology.preferredTechnologies = [];
      }),
    );

    expect(Object.keys(query.geography ?? {})).toEqual(['countries']);
    expect(Object.keys(query.companyProfile ?? {})).toContain('industries');
    expect('technology' in query).toBe(false);
  });

  it('carries the ICP technology preferences when there are any', () => {
    const icp = config((value) => {
      value.technology.requiredTechnologies = ['DOTNET'];
      value.technology.preferredTechnologies = ['KUBERNETES'];
      value.technology.excludedTechnologies = [];
    });

    expect(buildQuery(icp).technology).toEqual({
      requiredTechnologies: ['DOTNET'],
      preferredTechnologies: ['KUBERNETES'],
    });
  });

  it('passes the caller\'s limit and cursor through', () => {
    const query = buildQuery(config(), 50, '3');
    expect(query.limit).toBe(50);
    expect(query.cursor).toBe('3');
  });

  it('omits the cursor when there is none', () => {
    expect('cursor' in buildQuery(config())).toBe(false);
  });
});

describe('FirmographicDiscoveryStrategy - what it leaves out of the query', () => {
  it('does not push must-have rules, exclusions or triggers into the provider query', () => {
    /**
     * These are filters and signals, applied after normalization so a company
     * with unknown data can be handled deliberately rather than never
     * retrieved. Pushing them into a recall query trades recall for a filter
     * the pipeline applies anyway - invisibly, against whatever subset the
     * provider happens to support.
     */
    const query = buildQuery(config()) as Record<string, unknown>;

    for (const absent of [
      'mustHave',
      'mustNiceExclude',
      'exclusions',
      'niceToHave',
      'triggers',
      'triggersIntent',
      'targetBuyer',
      'scoringWeights',
      'evidenceDiscovery',
      'businessProblems',
      'servicesFit',
    ]) {
      expect(absent in query).toBe(false);
    }
  });

  it('produces a query whose only keys are the discovery contract\'s', () => {
    expect(Object.keys(buildQuery(config())).sort()).toEqual(
      ['companyProfile', 'geography', 'limit', 'technology'].sort(),
    );
  });
});

describe('FirmographicDiscoveryStrategy - execution', () => {
  it('runs the query it built through the provider port', async () => {
    const { provider, queries } = recordingProvider();
    const strategy = new FirmographicDiscoveryStrategy(provider);
    const icp = config();

    const run = await strategy.discover({ config: icp, limit: 10 });

    expect(run.strategy).toBe('FIRMOGRAPHIC');
    expect(queries).toHaveLength(1);
    // The executed query is reported verbatim, so a run is auditable.
    expect(run.query).toEqual(queries[0]);
    expect(run.query).toEqual(strategy.buildQuery({ config: icp, limit: 10 }));
  });
});
