import { DEFAULT_SCORING_WEIGHTS, ICP_SCHEMA_VERSION, type IcpConfig } from './schema.js';

/**
 * An empty but structurally complete configuration. The ICP form starts from
 * this draft: every section is present, required option lists start empty and
 * are rejected by `icpConfigSchema` until the user fills them in.
 */
export function createEmptyIcpConfig(): IcpConfig {
  return {
    schemaVersion: ICP_SCHEMA_VERSION,
    basicProfile: {
      name: '',
      objective: 'NEW_LOGO_ACQUISITION',
      priority: 'P0',
      languages: [],
    },
    geography: {
      regions: [],
      includedCountries: [],
      excludedCountries: [],
      locationScope: 'HEADQUARTERS_ONLY',
    },
    companyProfile: {
      industries: [],
      excludedIndustries: [],
      employeeRange: {},
      revenueRange: { currency: 'EUR' },
      companyTypes: [],
      businessModels: [],
      maturityStages: [],
    },
    technology: {
      requiredTechnologies: [],
      preferredTechnologies: [],
      excludedTechnologies: [],
      technologyMaturities: [],
      cloudProviders: [],
      legacyIndicators: [],
    },
    servicesFit: {
      serviceOfferings: [],
      engagementModels: [],
      dealSizeBand: 'FROM_150K_TO_500K',
      outsourcingPosture: 'UNKNOWN',
      buyingIndicators: [],
    },
    businessProblems: {
      problems: [],
      priorityProblems: [],
      capacityGapIndicators: [],
      complianceFrameworks: [],
    },
    mustNiceExclude: {
      mustHave: [],
      niceToHave: [],
      exclusions: [],
    },
    triggersIntent: {
      triggers: [],
      excludedTriggerTypes: [],
      minimumSignalCount: 1,
      signalFreshnessWindowDays: 180,
      requireStructuralSignal: false,
    },
    targetBuyer: {
      seniorities: [],
      departments: [],
      titles: [],
      buyerRoles: [],
      reachabilityRequirement: 'INFLUENCER_ACCEPTED',
      minimumContactsPerAccount: 1,
    },
    evidenceDiscovery: {
      discoveryStrategies: ['FIRMOGRAPHIC'],
      lookAlikeAccounts: [],
      suppressedAccounts: [],
      keywordGroups: [],
      allowedSourceTypes: ['COMPANY_WEBSITE'],
      minimumSourceReliability: 'MEDIUM',
      requiredDirectness: 'INDIRECT',
      evidenceFreshnessDays: 365,
      minimumCorroborationCount: 1,
    },
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
  };
}

/**
 * A complete, valid configuration. Used by the form's "Load example" action and
 * as the fixture for schema, API and UI tests.
 */
export function createExampleIcpConfig(overrides?: { name?: string }): IcpConfig {
  return {
    schemaVersion: ICP_SCHEMA_VERSION,
    basicProfile: {
      name: overrides?.name ?? 'Benelux mid-market platform modernization',
      description:
        'Mid-market Benelux companies running a legacy platform with an active modernization need.',
      objective: 'NEW_LOGO_ACQUISITION',
      priority: 'P0',
      languages: ['NL', 'EN'],
    },
    geography: {
      regions: ['BENELUX'],
      includedCountries: ['NL', 'BE', 'LU'],
      excludedCountries: ['US'],
      locationScope: 'HEADQUARTERS_ONLY',
    },
    companyProfile: {
      industries: ['FINANCIAL_SERVICES', 'LOGISTICS_TRANSPORT', 'MANUFACTURING'],
      excludedIndustries: ['NONPROFIT'],
      employeeRange: { min: 200, max: 5000 },
      revenueRange: { min: 25000000, max: 750000000, currency: 'EUR' },
      companyTypes: ['PRIVATE', 'PE_BACKED'],
      businessModels: ['B2B_SERVICES', 'LOGISTICS'],
      maturityStages: ['ESTABLISHED', 'SCALE_UP'],
    },
    technology: {
      requiredTechnologies: ['DOTNET', 'SQL_SERVER'],
      preferredTechnologies: ['REACT', 'KUBERNETES'],
      excludedTechnologies: ['MENDIX'],
      technologyMaturities: ['LEGACY_ON_PREMISE', 'HYBRID'],
      cloudProviders: ['AZURE'],
      legacyIndicators: ['LEGACY_ERP', 'MONOLITHIC_ARCHITECTURE'],
    },
    servicesFit: {
      serviceOfferings: ['PLATFORM_MODERNIZATION', 'CLOUD_MIGRATION', 'CUSTOM_SOFTWARE_DEVELOPMENT'],
      engagementModels: ['DEDICATED_TEAM', 'FIXED_PRICE_PROJECT'],
      dealSizeBand: 'FROM_150K_TO_500K',
      outsourcingPosture: 'HYBRID',
      buyingIndicators: ['OUTSOURCING_HISTORY', 'DIGITAL_TRANSFORMATION_BUDGET'],
    },
    businessProblems: {
      problems: ['LEGACY_MODERNIZATION', 'SCALING_ENGINEERING_CAPACITY', 'INTEGRATION_COMPLEXITY'],
      priorityProblems: ['LEGACY_MODERNIZATION'],
      capacityGapIndicators: ['HIRING_GAP', 'DELIVERY_DELAYS'],
      complianceFrameworks: ['GDPR', 'NIS2'],
    },
    mustNiceExclude: {
      mustHave: [
        {
          id: 'must-country',
          field: 'company.country',
          operator: 'IN',
          values: ['NL', 'BE', 'LU'],
          unknownHandling: 'TREAT_AS_UNKNOWN',
        },
        {
          id: 'must-size',
          field: 'company.employeeCount',
          operator: 'GREATER_THAN_OR_EQUAL',
          value: 200,
          unknownHandling: 'TREAT_AS_UNKNOWN',
        },
      ],
      niceToHave: [
        {
          id: 'nice-legacy',
          field: 'technology.legacyIndicator',
          operator: 'EQUALS',
          value: 'LEGACY_ERP',
          unknownHandling: 'TREAT_AS_UNKNOWN',
          weight: 7,
        },
      ],
      exclusions: [
        {
          id: 'exclude-customer',
          field: 'account.isExistingCustomer',
          operator: 'EQUALS',
          value: true,
          unknownHandling: 'TREAT_AS_UNKNOWN',
        },
        {
          id: 'exclude-dnc',
          field: 'account.doNotContact',
          operator: 'EQUALS',
          value: true,
          unknownHandling: 'TREAT_AS_UNKNOWN',
        },
      ],
    },
    triggersIntent: {
      triggers: [
        {
          type: 'RECENT_HIRING',
          polarity: 'POSITIVE',
          decayClass: 'TRANSIENT',
          relevance: 8,
          lookbackDays: 90,
        },
        {
          type: 'TECHNOLOGY_MIGRATION',
          polarity: 'POSITIVE',
          decayClass: 'STRUCTURAL',
          relevance: 9,
          lookbackDays: 365,
        },
      ],
      excludedTriggerTypes: ['INSOLVENCY_RISK'],
      minimumSignalCount: 1,
      signalFreshnessWindowDays: 180,
      requireStructuralSignal: false,
    },
    targetBuyer: {
      seniorities: ['C_LEVEL', 'DIRECTOR'],
      departments: ['IT', 'ENGINEERING'],
      titles: ['CTO', 'CIO', 'DIRECTOR_OF_IT'],
      buyerRoles: ['DECISION_MAKER', 'TECHNICAL_EVALUATOR'],
      reachabilityRequirement: 'DECISION_MAKER_REQUIRED',
      minimumContactsPerAccount: 2,
    },
    evidenceDiscovery: {
      discoveryStrategies: ['FIRMOGRAPHIC', 'SIGNAL_FIRST'],
      lookAlikeAccounts: [],
      suppressedAccounts: [{ id: 'acc-1001', name: 'Existing Customer BV', domain: 'existing.nl' }],
      keywordGroups: [],
      allowedSourceTypes: ['COMPANY_WEBSITE', 'JOB_POSTING', 'NEWS_ARTICLE'],
      minimumSourceReliability: 'MEDIUM',
      requiredDirectness: 'INDIRECT',
      evidenceFreshnessDays: 365,
      minimumCorroborationCount: 2,
    },
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
  } satisfies IcpConfig;
}
