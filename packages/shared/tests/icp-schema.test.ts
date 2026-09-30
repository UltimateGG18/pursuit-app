import { describe, expect, it } from 'vitest';
import {
  createEmptyIcpConfig,
  createExampleIcpConfig,
  createIcpRequestSchema,
  icpConfigSchema,
  listIcpQuerySchema,
  zodErrorToDetails,
  type IcpConfig,
} from '../src/index.js';

/** Deep clone so a test mutation cannot leak into the next test. */
function example(): IcpConfig {
  return structuredClone(createExampleIcpConfig());
}

function pathsOf(config: unknown): string[] {
  const parsed = icpConfigSchema.safeParse(config);
  if (parsed.success) return [];
  return zodErrorToDetails(parsed.error).map((detail) => detail.path);
}

function messagesFor(config: unknown, path: string): string[] {
  const parsed = icpConfigSchema.safeParse(config);
  if (parsed.success) return [];
  return zodErrorToDetails(parsed.error)
    .filter((detail) => detail.path === path)
    .map((detail) => detail.message);
}

describe('icpConfigSchema - happy path', () => {
  it('accepts the example configuration', () => {
    const parsed = icpConfigSchema.safeParse(example());
    expect(parsed.success).toBe(true);
  });

  it('applies defaults for omitted optional sections', () => {
    const config = example() as Record<string, unknown>;
    delete config.scoringWeights;
    delete config.schemaVersion;
    const parsed = icpConfigSchema.safeParse(config);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.schemaVersion).toBe('icp.v1');
    expect(parsed.data.scoringWeights.ICP_FIT).toBe(20);
  });

  it('rejects the empty draft the form starts from', () => {
    const parsed = icpConfigSchema.safeParse(createEmptyIcpConfig());
    expect(parsed.success).toBe(false);
  });
});

describe('icpConfigSchema - required fields', () => {
  it('reports a missing ICP name', () => {
    const config = example();
    config.basicProfile.name = '';
    expect(messagesFor(config, 'basicProfile.name')).toContain('Name must be at least 3 characters');
  });

  it('reports every empty required option list once', () => {
    const config = example();
    config.geography.includedCountries = [];
    config.companyProfile.industries = [];
    config.servicesFit.serviceOfferings = [];
    config.businessProblems.problems = [];
    config.targetBuyer.seniorities = [];
    config.evidenceDiscovery.allowedSourceTypes = [];

    const paths = pathsOf(config);
    expect(paths).toEqual(
      expect.arrayContaining([
        'geography.includedCountries',
        'companyProfile.industries',
        'servicesFit.serviceOfferings',
        'businessProblems.problems',
        'targetBuyer.seniorities',
        'evidenceDiscovery.allowedSourceTypes',
      ]),
    );
  });

  it('requires at least one must-have rule', () => {
    const config = example();
    config.mustNiceExclude.mustHave = [];
    expect(messagesFor(config, 'mustNiceExclude.mustHave')).toContain(
      'Define at least one must-have rule; must-have rules are the hard filters',
    );
  });

  it('requires at least one trigger', () => {
    const config = example();
    config.triggersIntent.triggers = [];
    expect(messagesFor(config, 'triggersIntent.triggers')).toContain('Define at least one trigger');
  });
});

describe('icpConfigSchema - enum values', () => {
  it('rejects a country outside the catalog', () => {
    const config = example() as unknown as { geography: { includedCountries: string[] } };
    config.geography.includedCountries = ['NL', 'ZZ'];
    expect(pathsOf(config)).toContain('geography.includedCountries[1]');
  });

  it('rejects an unknown objective', () => {
    const config = example() as unknown as { basicProfile: { objective: string } };
    config.basicProfile.objective = 'WORLD_DOMINATION';
    expect(messagesFor(config, 'basicProfile.objective')).toContain(
      'Select the commercial objective for this ICP',
    );
  });

  it('rejects unknown keys so typos are not silently stored', () => {
    const config = { ...example(), unexpectedSection: { foo: 1 } };
    expect(icpConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe('icpConfigSchema - ranges', () => {
  it('rejects an employee range where min exceeds max', () => {
    const config = example();
    config.companyProfile.employeeRange = { min: 5000, max: 200 };
    expect(messagesFor(config, 'companyProfile.employeeRange.max')).toContain(
      'Maximum employee count must be greater than or equal to the minimum',
    );
  });

  it('rejects a revenue range where min exceeds max', () => {
    const config = example();
    config.companyProfile.revenueRange = { min: 10, max: 1, currency: 'EUR' };
    expect(pathsOf(config)).toContain('companyProfile.revenueRange.max');
  });

  it('rejects trigger relevance outside 1..10', () => {
    const config = example();
    config.triggersIntent.triggers[0]!.relevance = 11;
    expect(messagesFor(config, 'triggersIntent.triggers[0].relevance')).toContain(
      'Relevance must be at most 10',
    );
  });

  it('rejects evidence freshness outside the allowed window', () => {
    const config = example();
    config.evidenceDiscovery.evidenceFreshnessDays = 2000;
    expect(pathsOf(config)).toContain('evidenceDiscovery.evidenceFreshnessDays');
  });

  it('accepts an open-ended employee range', () => {
    const config = example();
    config.companyProfile.employeeRange = { min: 50 };
    expect(icpConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe('icpConfigSchema - rule structure', () => {
  it('rejects an operator the field does not support', () => {
    const config = example();
    config.mustNiceExclude.mustHave = [
      { id: 'r1', field: 'company.country', operator: 'GREATER_THAN', value: 5, unknownHandling: 'TREAT_AS_UNKNOWN' },
    ];
    expect(messagesFor(config, 'mustNiceExclude.mustHave[0].operator')).toContain(
      'Operator "is greater than" cannot be used with Country',
    );
  });

  it('requires a value for a single-value operator', () => {
    const config = example();
    config.mustNiceExclude.mustHave = [
      { id: 'r1', field: 'company.industry', operator: 'EQUALS', unknownHandling: 'TREAT_AS_UNKNOWN' },
    ];
    expect(messagesFor(config, 'mustNiceExclude.mustHave[0].value')).toContain(
      'A value is required for operator "equals"',
    );
  });

  it('requires values for a list operator', () => {
    const config = example();
    config.mustNiceExclude.mustHave = [
      { id: 'r1', field: 'company.industry', operator: 'IN', unknownHandling: 'TREAT_AS_UNKNOWN' },
    ];
    expect(pathsOf(config)).toContain('mustNiceExclude.mustHave[0].values');
  });

  it('rejects a value outside the field option list', () => {
    const config = example();
    config.mustNiceExclude.mustHave = [
      {
        id: 'r1',
        field: 'company.industry',
        operator: 'EQUALS',
        value: 'SPACE_MINING',
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];
    expect(messagesFor(config, 'mustNiceExclude.mustHave[0].value')).toContain(
      '"SPACE_MINING" is not a valid option for Industry',
    );
  });

  it('rejects a value slot the operator does not use', () => {
    const config = example();
    config.mustNiceExclude.mustHave = [
      {
        id: 'r1',
        field: 'company.domain',
        operator: 'EXISTS',
        value: 'example.com',
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];
    expect(messagesFor(config, 'mustNiceExclude.mustHave[0].value')).toContain(
      '"value" is not allowed with operator "is known"',
    );
  });

  it('validates a BETWEEN range', () => {
    const config = example();
    config.mustNiceExclude.mustHave = [
      {
        id: 'r1',
        field: 'company.employeeCount',
        operator: 'BETWEEN',
        range: { min: 500, max: 100 },
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];
    expect(messagesFor(config, 'mustNiceExclude.mustHave[0].range.max')).toContain(
      'Maximum must be greater than or equal to minimum',
    );
  });

  it('enforces numeric field bounds inside a rule', () => {
    const config = example();
    config.mustNiceExclude.mustHave = [
      {
        id: 'r1',
        field: 'company.foundedYear',
        operator: 'GREATER_THAN',
        value: 3000,
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];
    expect(messagesFor(config, 'mustNiceExclude.mustHave[0].value')).toContain(
      'Founded year must be at most 2100',
    );
  });

  it('requires a weight on nice-to-have rules and forbids it on hard rules', () => {
    const config = example();
    config.mustNiceExclude.niceToHave = [
      {
        id: 'n1',
        field: 'technology.stack',
        operator: 'EQUALS',
        value: 'DOTNET',
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];
    config.mustNiceExclude.mustHave[0]!.weight = 5;

    const paths = pathsOf(config);
    expect(paths).toContain('mustNiceExclude.niceToHave[0].weight');
    expect(paths).toContain('mustNiceExclude.mustHave[0].weight');
  });

  it('defaults unknown handling to TREAT_AS_UNKNOWN', () => {
    const config = example() as unknown as {
      mustNiceExclude: { mustHave: Array<Record<string, unknown>> };
    };
    config.mustNiceExclude.mustHave = [
      { id: 'r1', field: 'company.industry', operator: 'EQUALS', value: 'MANUFACTURING' },
    ];
    const parsed = icpConfigSchema.safeParse(config);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.mustNiceExclude.mustHave[0]!.unknownHandling).toBe('TREAT_AS_UNKNOWN');
  });

  it('rejects a rule duplicated across must-have and exclusions', () => {
    const config = example();
    config.mustNiceExclude.exclusions = [structuredClone(config.mustNiceExclude.mustHave[0]!)];
    expect(messagesFor(config, 'mustNiceExclude.exclusions[0]')).toContain(
      'This rule is already a must-have rule, so it can never be satisfied',
    );
  });
});

describe('icpConfigSchema - cross-field and cross-section rules', () => {
  it('rejects a country that is both included and excluded', () => {
    const config = example();
    config.geography.excludedCountries = ['NL'];
    expect(messagesFor(config, 'geography.excludedCountries')).toContain(
      'Cannot be both included and excluded: NL',
    );
  });

  it('rejects a technology that is both required and excluded', () => {
    const config = example();
    config.technology.excludedTechnologies = ['DOTNET'];
    expect(messagesFor(config, 'technology.excludedTechnologies')).toContain(
      'Cannot be both required and excluded: DOTNET',
    );
  });

  it('requires priority problems to be selected problems', () => {
    const config = example();
    config.businessProblems.priorityProblems = ['SECURITY_GAPS'];
    expect(pathsOf(config)).toContain('businessProblems.priorityProblems');
  });

  it('rejects a duplicate trigger type', () => {
    const config = example();
    config.triggersIntent.triggers = [
      structuredClone(config.triggersIntent.triggers[0]!),
      structuredClone(config.triggersIntent.triggers[0]!),
    ];
    expect(pathsOf(config)).toContain('triggersIntent.triggers[1].type');
  });

  it('rejects a minimum signal count above the configured triggers', () => {
    const config = example();
    config.triggersIntent.minimumSignalCount = 9;
    expect(messagesFor(config, 'triggersIntent.minimumSignalCount')).toContain(
      'Minimum signal count cannot exceed the number of configured triggers',
    );
  });

  it('requires a structural trigger when one is demanded', () => {
    const config = example();
    config.triggersIntent.triggers = config.triggersIntent.triggers.map((trigger) => ({
      ...trigger,
      decayClass: 'TRANSIENT' as const,
    }));
    config.triggersIntent.requireStructuralSignal = true;
    expect(pathsOf(config)).toContain('triggersIntent.requireStructuralSignal');
  });

  it('requires the decision maker role when a decision maker must be reachable', () => {
    const config = example();
    config.targetBuyer.buyerRoles = ['INFLUENCER'];
    expect(messagesFor(config, 'targetBuyer.buyerRoles')).toContain(
      'Add the decision maker role when a reachable decision maker is required',
    );
  });

  it('requires reference accounts for the look-alike strategy', () => {
    const config = example();
    config.evidenceDiscovery.discoveryStrategies = ['FIRMOGRAPHIC', 'LOOK_ALIKE'];
    expect(messagesFor(config, 'evidenceDiscovery.lookAlikeAccounts')).toContain(
      'Select at least one reference account for the look-alike strategy',
    );
  });

  it('requires keyword groups for the semantic strategy', () => {
    const config = example();
    config.evidenceDiscovery.discoveryStrategies = ['FIRMOGRAPHIC', 'SEMANTIC'];
    expect(pathsOf(config)).toContain('evidenceDiscovery.keywordGroups');
  });

  it('rejects a must-have country rule outside the target geography', () => {
    const config = example();
    config.mustNiceExclude.mustHave = [
      {
        id: 'r1',
        field: 'company.country',
        operator: 'IN',
        values: ['NL', 'DE'],
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];
    expect(messagesFor(config, 'mustNiceExclude.mustHave[0]')).toContain(
      'Must-have country rule references countries outside the target geography: DE',
    );
  });

  it('rejects scoring weights that do not add up to 100', () => {
    const config = example();
    config.scoringWeights = {
      ICP_FIT: 50,
      BUSINESS_FIT: 15,
      NEED: 20,
      INTENT: 20,
      TIMING: 10,
      OPPORTUNITY: 10,
      EVIDENCE: 5,
    };
    expect(messagesFor(config, 'scoringWeights')).toContain(
      'Scoring weights must add up to 100 (currently 130)',
    );
  });
});

describe('request schemas', () => {
  it('accepts a create request and defaults the status to ACTIVE', () => {
    const parsed = createIcpRequestSchema.safeParse({ config: example() });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.status).toBe('ACTIVE');
  });

  it('prefixes nested config errors with the config path', () => {
    const config = example();
    config.basicProfile.name = 'x';
    const parsed = createIcpRequestSchema.safeParse({ config });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(zodErrorToDetails(parsed.error).map((detail) => detail.path)).toContain(
      'config.basicProfile.name',
    );
  });

  it('rejects a status a client may not set directly', () => {
    const parsed = createIcpRequestSchema.safeParse({ config: example(), status: 'ARCHIVED' });
    expect(parsed.success).toBe(false);
  });

  it('coerces list query parameters', () => {
    const parsed = listIcpQuerySchema.safeParse({ limit: '10', offset: '20' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({ limit: 10, offset: 20 });
  });

  it('rejects an out-of-range list limit', () => {
    expect(listIcpQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});
