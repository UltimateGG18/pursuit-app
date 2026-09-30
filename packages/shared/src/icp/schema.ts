import { z } from 'zod';
import {
  ICP_OBJECTIVES,
  ICP_PRIORITIES,
  ICP_STATUSES,
  LANGUAGES,
} from './catalogs/basic.js';
import { COUNTRIES, LOCATION_SCOPES, REGIONS } from './catalogs/geography.js';
import {
  BUSINESS_MODELS,
  COMPANY_TYPES,
  CURRENCIES,
  INDUSTRIES,
  MATURITY_STAGES,
} from './catalogs/company.js';
import {
  CLOUD_PROVIDERS,
  LEGACY_INDICATORS,
  TECHNOLOGIES,
  TECHNOLOGY_MATURITIES,
} from './catalogs/technology.js';
import {
  BUYING_INDICATORS,
  DEAL_SIZE_BANDS,
  ENGAGEMENT_MODELS,
  OUTSOURCING_POSTURES,
  SERVICE_OFFERINGS,
} from './catalogs/services.js';
import {
  BUSINESS_PROBLEMS,
  CAPACITY_GAP_INDICATORS,
  COMPLIANCE_FRAMEWORKS,
} from './catalogs/problems.js';
import {
  SIGNAL_DECAY_CLASSES,
  SIGNAL_POLARITIES,
  TRIGGER_LOOKBACK_DAYS_MAX,
  TRIGGER_LOOKBACK_DAYS_MIN,
  TRIGGER_RELEVANCE_MAX,
  TRIGGER_RELEVANCE_MIN,
  TRIGGER_TYPES,
} from './catalogs/signals.js';
import {
  BUYER_ROLES,
  DEPARTMENTS,
  MIN_CONTACTS_PER_ACCOUNT_MAX,
  MIN_CONTACTS_PER_ACCOUNT_MIN,
  REACHABILITY_REQUIREMENTS,
  SENIORITIES,
  TARGET_TITLES,
} from './catalogs/buyer.js';
import {
  CORROBORATION_MAX,
  CORROBORATION_MIN,
  DISCOVERY_STRATEGIES,
  EVIDENCE_DIRECTNESS_LEVELS,
  EVIDENCE_FRESHNESS_DAYS_MAX,
  EVIDENCE_FRESHNESS_DAYS_MIN,
  KEYWORD_GROUP_TERM_MAX,
  SOURCE_RELIABILITIES,
  SOURCE_TYPES,
} from './catalogs/evidence.js';
import { icpHardRuleSchema, icpNiceToHaveRuleSchema } from './rule-schema.js';
import { operandKindForOperator } from './rule-fields.js';

/**
 * Version of the ICP configuration contract. Stored with every persisted
 * profile so future schema changes can be migrated deterministically.
 */
export const ICP_SCHEMA_VERSION = 'icp.v1';

const MAX_RULES_PER_BUCKET = 50;

function custom(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

/** Reports the values present in both lists, used for include/exclude conflicts. */
function overlap<T extends string>(a: readonly T[], b: readonly T[]): T[] {
  const right = new Set(b);
  return [...new Set(a.filter((value) => right.has(value)))];
}

function enumList<T extends readonly [string, ...string[]]>(values: T) {
  return z.array(z.enum(values));
}

// ---------------------------------------------------------------------------
// Section 1 - Basic Profile
// ---------------------------------------------------------------------------

export const basicProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, 'Name must be at least 3 characters')
      .max(120, 'Name must be at most 120 characters'),
    description: z.string().trim().max(2000).optional(),
    objective: z.enum(ICP_OBJECTIVES, {
      errorMap: () => ({ message: 'Select the commercial objective for this ICP' }),
    }),
    priority: z.enum(ICP_PRIORITIES, {
      errorMap: () => ({ message: 'Select a priority' }),
    }),
    languages: enumList(LANGUAGES)
      .min(1, 'Select at least one operating language')
      .max(LANGUAGES.length),
  })
  .strict();

// ---------------------------------------------------------------------------
// Section 2 - Geography
// ---------------------------------------------------------------------------

export const geographySchema = z
  .object({
    regions: enumList(REGIONS).max(REGIONS.length).default([]),
    includedCountries: enumList(COUNTRIES)
      .min(1, 'Select at least one target country')
      .max(COUNTRIES.length),
    excludedCountries: enumList(COUNTRIES).max(COUNTRIES.length).default([]),
    locationScope: z.enum(LOCATION_SCOPES, {
      errorMap: () => ({ message: 'Select which company location must match' }),
    }),
  })
  .strict()
  .superRefine((section, ctx) => {
    const conflicts = overlap(section.includedCountries, section.excludedCountries);
    if (conflicts.length > 0) {
      custom(
        ctx,
        ['excludedCountries'],
        `Cannot be both included and excluded: ${conflicts.join(', ')}`,
      );
    }
  });

// ---------------------------------------------------------------------------
// Section 3 - Company Profile
// ---------------------------------------------------------------------------

const employeeRangeSchema = z
  .object({
    min: z.number().int().min(0).max(1000000).optional(),
    max: z.number().int().min(0).max(1000000).optional(),
  })
  .strict()
  .superRefine((range, ctx) => {
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
      custom(ctx, ['max'], 'Maximum employee count must be greater than or equal to the minimum');
    }
  });

const revenueRangeSchema = z
  .object({
    min: z.number().min(0).max(100000000000).optional(),
    max: z.number().min(0).max(100000000000).optional(),
    currency: z.enum(CURRENCIES).default('EUR'),
  })
  .strict()
  .superRefine((range, ctx) => {
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
      custom(ctx, ['max'], 'Maximum revenue must be greater than or equal to the minimum');
    }
  });

export const companyProfileSchema = z
  .object({
    industries: enumList(INDUSTRIES).min(1, 'Select at least one target industry').max(INDUSTRIES.length),
    excludedIndustries: enumList(INDUSTRIES).max(INDUSTRIES.length).default([]),
    employeeRange: employeeRangeSchema.default({}),
    revenueRange: revenueRangeSchema.default({ currency: 'EUR' }),
    companyTypes: enumList(COMPANY_TYPES).max(COMPANY_TYPES.length).default([]),
    businessModels: enumList(BUSINESS_MODELS)
      .min(1, 'Select at least one business model')
      .max(BUSINESS_MODELS.length),
    maturityStages: enumList(MATURITY_STAGES).max(MATURITY_STAGES.length).default([]),
  })
  .strict()
  .superRefine((section, ctx) => {
    const conflicts = overlap(section.industries, section.excludedIndustries);
    if (conflicts.length > 0) {
      custom(
        ctx,
        ['excludedIndustries'],
        `Cannot be both targeted and excluded: ${conflicts.join(', ')}`,
      );
    }
  });

// ---------------------------------------------------------------------------
// Section 4 - Technology
// ---------------------------------------------------------------------------

export const technologySchema = z
  .object({
    requiredTechnologies: enumList(TECHNOLOGIES).max(TECHNOLOGIES.length).default([]),
    preferredTechnologies: enumList(TECHNOLOGIES).max(TECHNOLOGIES.length).default([]),
    excludedTechnologies: enumList(TECHNOLOGIES).max(TECHNOLOGIES.length).default([]),
    technologyMaturities: enumList(TECHNOLOGY_MATURITIES).max(TECHNOLOGY_MATURITIES.length).default([]),
    cloudProviders: enumList(CLOUD_PROVIDERS).max(CLOUD_PROVIDERS.length).default([]),
    legacyIndicators: enumList(LEGACY_INDICATORS).max(LEGACY_INDICATORS.length).default([]),
  })
  .strict()
  .superRefine((section, ctx) => {
    const requiredConflicts = overlap(section.requiredTechnologies, section.excludedTechnologies);
    if (requiredConflicts.length > 0) {
      custom(
        ctx,
        ['excludedTechnologies'],
        `Cannot be both required and excluded: ${requiredConflicts.join(', ')}`,
      );
    }
    const preferredConflicts = overlap(section.preferredTechnologies, section.excludedTechnologies);
    if (preferredConflicts.length > 0) {
      custom(
        ctx,
        ['excludedTechnologies'],
        `Cannot be both preferred and excluded: ${preferredConflicts.join(', ')}`,
      );
    }
  });

// ---------------------------------------------------------------------------
// Section 5 - Services & Fit
// ---------------------------------------------------------------------------

export const servicesFitSchema = z
  .object({
    serviceOfferings: enumList(SERVICE_OFFERINGS)
      .min(1, 'Select at least one service offering')
      .max(SERVICE_OFFERINGS.length),
    engagementModels: enumList(ENGAGEMENT_MODELS)
      .min(1, 'Select at least one engagement model')
      .max(ENGAGEMENT_MODELS.length),
    dealSizeBand: z.enum(DEAL_SIZE_BANDS, {
      errorMap: () => ({ message: 'Select the expected deal size band' }),
    }),
    outsourcingPosture: z.enum(OUTSOURCING_POSTURES).default('UNKNOWN'),
    buyingIndicators: enumList(BUYING_INDICATORS).max(BUYING_INDICATORS.length).default([]),
  })
  .strict();

// ---------------------------------------------------------------------------
// Section 6 - Business Problems
// ---------------------------------------------------------------------------

export const businessProblemsSchema = z
  .object({
    problems: enumList(BUSINESS_PROBLEMS)
      .min(1, 'Select at least one business problem')
      .max(BUSINESS_PROBLEMS.length),
    priorityProblems: enumList(BUSINESS_PROBLEMS).max(3, 'Pick at most three priority problems').default([]),
    capacityGapIndicators: enumList(CAPACITY_GAP_INDICATORS)
      .max(CAPACITY_GAP_INDICATORS.length)
      .default([]),
    complianceFrameworks: enumList(COMPLIANCE_FRAMEWORKS).max(COMPLIANCE_FRAMEWORKS.length).default([]),
  })
  .strict()
  .superRefine((section, ctx) => {
    const selected = new Set<string>(section.problems);
    const orphans = section.priorityProblems.filter((problem) => !selected.has(problem));
    if (orphans.length > 0) {
      custom(
        ctx,
        ['priorityProblems'],
        `Priority problems must also be selected as business problems: ${orphans.join(', ')}`,
      );
    }
  });

// ---------------------------------------------------------------------------
// Section 7 - Must / Nice / Exclude
// ---------------------------------------------------------------------------

/** Identity of a rule, used to detect a rule appearing in two buckets. */
function ruleIdentity(rule: {
  field: string;
  operator: string;
  value?: unknown;
  values?: unknown[];
  range?: { min: number; max: number };
}): string {
  const operand =
    rule.values !== undefined
      ? [...rule.values].map(String).sort().join('|')
      : rule.range !== undefined
        ? `${rule.range.min}..${rule.range.max}`
        : String(rule.value);
  return `${rule.field}::${rule.operator}::${operand}`;
}

export const mustNiceExcludeSchema = z
  .object({
    mustHave: z
      .array(icpHardRuleSchema)
      .min(1, 'Define at least one must-have rule; must-have rules are the hard filters')
      .max(MAX_RULES_PER_BUCKET),
    niceToHave: z.array(icpNiceToHaveRuleSchema).max(MAX_RULES_PER_BUCKET).default([]),
    exclusions: z.array(icpHardRuleSchema).max(MAX_RULES_PER_BUCKET).default([]),
  })
  .strict()
  .superRefine((section, ctx) => {
    const mustIdentities = new Map<string, number>();
    section.mustHave.forEach((rule, index) => {
      const identity = ruleIdentity(rule);
      if (mustIdentities.has(identity)) {
        custom(ctx, ['mustHave', index], 'Duplicate must-have rule');
      } else {
        mustIdentities.set(identity, index);
      }
    });

    section.exclusions.forEach((rule, index) => {
      const identity = ruleIdentity(rule);
      if (mustIdentities.has(identity)) {
        custom(
          ctx,
          ['exclusions', index],
          'This rule is already a must-have rule, so it can never be satisfied',
        );
      }
    });

    const niceIdentities = new Set<string>();
    section.niceToHave.forEach((rule, index) => {
      const identity = ruleIdentity(rule);
      if (niceIdentities.has(identity)) {
        custom(ctx, ['niceToHave', index], 'Duplicate nice-to-have rule');
      }
      niceIdentities.add(identity);
    });
  });

// ---------------------------------------------------------------------------
// Section 8 - Triggers & Intent
// ---------------------------------------------------------------------------

export const triggerSchema = z
  .object({
    type: z.enum(TRIGGER_TYPES, {
      errorMap: () => ({ message: 'Select a trigger type' }),
    }),
    polarity: z.enum(SIGNAL_POLARITIES).default('POSITIVE'),
    decayClass: z.enum(SIGNAL_DECAY_CLASSES).default('TRANSIENT'),
    relevance: z
      .number()
      .int()
      .min(TRIGGER_RELEVANCE_MIN, `Relevance must be at least ${TRIGGER_RELEVANCE_MIN}`)
      .max(TRIGGER_RELEVANCE_MAX, `Relevance must be at most ${TRIGGER_RELEVANCE_MAX}`),
    lookbackDays: z
      .number()
      .int()
      .min(TRIGGER_LOOKBACK_DAYS_MIN, `Lookback must be at least ${TRIGGER_LOOKBACK_DAYS_MIN} days`)
      .max(TRIGGER_LOOKBACK_DAYS_MAX, `Lookback must be at most ${TRIGGER_LOOKBACK_DAYS_MAX} days`),
  })
  .strict();

export const triggersIntentSchema = z
  .object({
    triggers: z.array(triggerSchema).min(1, 'Define at least one trigger').max(TRIGGER_TYPES.length),
    excludedTriggerTypes: enumList(TRIGGER_TYPES).max(TRIGGER_TYPES.length).default([]),
    minimumSignalCount: z.number().int().min(0).max(10).default(1),
    signalFreshnessWindowDays: z
      .number()
      .int()
      .min(TRIGGER_LOOKBACK_DAYS_MIN)
      .max(TRIGGER_LOOKBACK_DAYS_MAX)
      .default(180),
    requireStructuralSignal: z.boolean().default(false),
  })
  .strict()
  .superRefine((section, ctx) => {
    const seen = new Set<string>();
    section.triggers.forEach((trigger, index) => {
      if (seen.has(trigger.type)) {
        custom(ctx, ['triggers', index, 'type'], `Trigger "${trigger.type}" is configured twice`);
      }
      seen.add(trigger.type);
    });

    const conflicts = section.excludedTriggerTypes.filter((type) => seen.has(type));
    if (conflicts.length > 0) {
      custom(
        ctx,
        ['excludedTriggerTypes'],
        `Cannot be both configured and excluded: ${conflicts.join(', ')}`,
      );
    }

    if (section.minimumSignalCount > section.triggers.length) {
      custom(
        ctx,
        ['minimumSignalCount'],
        'Minimum signal count cannot exceed the number of configured triggers',
      );
    }

    if (
      section.requireStructuralSignal &&
      !section.triggers.some((trigger) => trigger.decayClass === 'STRUCTURAL')
    ) {
      custom(
        ctx,
        ['requireStructuralSignal'],
        'At least one trigger must be marked structural when a structural signal is required',
      );
    }
  });

// ---------------------------------------------------------------------------
// Section 9 - Target Buyer
// ---------------------------------------------------------------------------

export const targetBuyerSchema = z
  .object({
    seniorities: enumList(SENIORITIES).min(1, 'Select at least one seniority').max(SENIORITIES.length),
    departments: enumList(DEPARTMENTS).min(1, 'Select at least one department').max(DEPARTMENTS.length),
    titles: enumList(TARGET_TITLES).max(TARGET_TITLES.length).default([]),
    buyerRoles: enumList(BUYER_ROLES).max(BUYER_ROLES.length).default([]),
    reachabilityRequirement: z.enum(REACHABILITY_REQUIREMENTS).default('INFLUENCER_ACCEPTED'),
    minimumContactsPerAccount: z
      .number()
      .int()
      .min(MIN_CONTACTS_PER_ACCOUNT_MIN)
      .max(MIN_CONTACTS_PER_ACCOUNT_MAX)
      .default(1),
  })
  .strict()
  .superRefine((section, ctx) => {
    if (section.reachabilityRequirement === 'DECISION_MAKER_REQUIRED') {
      if (!section.buyerRoles.includes('DECISION_MAKER')) {
        custom(
          ctx,
          ['buyerRoles'],
          'Add the decision maker role when a reachable decision maker is required',
        );
      }
      if (section.minimumContactsPerAccount < 1) {
        custom(
          ctx,
          ['minimumContactsPerAccount'],
          'At least one contact is required when a decision maker must be reachable',
        );
      }
    }
  });

// ---------------------------------------------------------------------------
// Section 10 - Evidence & Discovery
// ---------------------------------------------------------------------------

/**
 * Reference to a CRM/provider account. Day 1 uses a placeholder selector; the
 * shape is already the one the Apollo/CRM integration will produce.
 */
export const accountReferenceSchema = z
  .object({
    id: z.string().trim().min(1, 'Account id is required').max(64),
    name: z.string().trim().min(1, 'Account name is required').max(200),
    domain: z.string().trim().max(255).optional(),
  })
  .strict();

export const keywordGroupSchema = z
  .object({
    label: z.string().trim().min(2, 'Give the keyword group a label').max(60),
    terms: z
      .array(z.string().trim().min(2, 'Terms must be at least 2 characters').max(60))
      .min(1, 'Add at least one term')
      .max(KEYWORD_GROUP_TERM_MAX),
  })
  .strict();

export const evidenceDiscoverySchema = z
  .object({
    discoveryStrategies: enumList(DISCOVERY_STRATEGIES)
      .min(1, 'Select at least one discovery strategy')
      .max(DISCOVERY_STRATEGIES.length),
    lookAlikeAccounts: z.array(accountReferenceSchema).max(50).default([]),
    suppressedAccounts: z.array(accountReferenceSchema).max(500).default([]),
    keywordGroups: z.array(keywordGroupSchema).max(20).default([]),
    allowedSourceTypes: enumList(SOURCE_TYPES)
      .min(1, 'Select at least one allowed source type')
      .max(SOURCE_TYPES.length),
    minimumSourceReliability: z.enum(SOURCE_RELIABILITIES).default('MEDIUM'),
    requiredDirectness: z.enum(EVIDENCE_DIRECTNESS_LEVELS).default('INDIRECT'),
    evidenceFreshnessDays: z
      .number()
      .int()
      .min(EVIDENCE_FRESHNESS_DAYS_MIN)
      .max(EVIDENCE_FRESHNESS_DAYS_MAX)
      .default(365),
    minimumCorroborationCount: z.number().int().min(CORROBORATION_MIN).max(CORROBORATION_MAX).default(1),
  })
  .strict()
  .superRefine((section, ctx) => {
    if (section.discoveryStrategies.includes('LOOK_ALIKE') && section.lookAlikeAccounts.length === 0) {
      custom(
        ctx,
        ['lookAlikeAccounts'],
        'Select at least one reference account for the look-alike strategy',
      );
    }
    if (section.discoveryStrategies.includes('SEMANTIC') && section.keywordGroups.length === 0) {
      custom(ctx, ['keywordGroups'], 'Add at least one keyword group for the semantic strategy');
    }

    const seenLookAlike = new Set<string>();
    section.lookAlikeAccounts.forEach((account, index) => {
      if (seenLookAlike.has(account.id)) {
        custom(ctx, ['lookAlikeAccounts', index, 'id'], 'Duplicate account');
      }
      seenLookAlike.add(account.id);
    });

    const seenSuppressed = new Set<string>();
    section.suppressedAccounts.forEach((account, index) => {
      if (seenSuppressed.has(account.id)) {
        custom(ctx, ['suppressedAccounts', index, 'id'], 'Duplicate account');
      }
      seenSuppressed.add(account.id);
    });

    const seenLabels = new Set<string>();
    section.keywordGroups.forEach((group, index) => {
      const key = group.label.toLowerCase();
      if (seenLabels.has(key)) {
        custom(ctx, ['keywordGroups', index, 'label'], 'Duplicate keyword group label');
      }
      seenLabels.add(key);
    });
  });

// ---------------------------------------------------------------------------
// Scoring weights (plan section 7). Not exposed in the Day 1 form; stored with
// every profile so a future score is reproducible from the criteria version.
// ---------------------------------------------------------------------------

export const SCORING_DIMENSIONS = [
  'ICP_FIT',
  'BUSINESS_FIT',
  'NEED',
  'INTENT',
  'TIMING',
  'OPPORTUNITY',
  'EVIDENCE',
] as const;
export type ScoringDimension = (typeof SCORING_DIMENSIONS)[number];

export const DEFAULT_SCORING_WEIGHTS: Readonly<Record<ScoringDimension, number>> = {
  ICP_FIT: 20,
  BUSINESS_FIT: 15,
  NEED: 20,
  INTENT: 20,
  TIMING: 10,
  OPPORTUNITY: 10,
  EVIDENCE: 5,
};

const weight = z.number().int().min(0).max(100);

export const scoringWeightsSchema = z
  .object({
    ICP_FIT: weight,
    BUSINESS_FIT: weight,
    NEED: weight,
    INTENT: weight,
    TIMING: weight,
    OPPORTUNITY: weight,
    EVIDENCE: weight,
  })
  .strict()
  .superRefine((weights, ctx) => {
    const total = SCORING_DIMENSIONS.reduce((sum, dimension) => sum + weights[dimension], 0);
    if (total !== 100) {
      custom(ctx, [], `Scoring weights must add up to 100 (currently ${total})`);
    }
  })
  .default(DEFAULT_SCORING_WEIGHTS);

// ---------------------------------------------------------------------------
// Full ICP configuration
// ---------------------------------------------------------------------------

const icpConfigObjectSchema = z
  .object({
    schemaVersion: z.literal(ICP_SCHEMA_VERSION).default(ICP_SCHEMA_VERSION),
    basicProfile: basicProfileSchema,
    geography: geographySchema,
    companyProfile: companyProfileSchema,
    technology: technologySchema,
    servicesFit: servicesFitSchema,
    businessProblems: businessProblemsSchema,
    mustNiceExclude: mustNiceExcludeSchema,
    triggersIntent: triggersIntentSchema,
    targetBuyer: targetBuyerSchema,
    evidenceDiscovery: evidenceDiscoverySchema,
    scoringWeights: scoringWeightsSchema,
  })
  .strict();

type IcpConfigObject = z.output<typeof icpConfigObjectSchema>;

/**
 * Cross-section validation. A hard geography filter that references a country
 * outside the target set can never be satisfied, so it is reported instead of
 * being silently stored.
 */
function refineCrossSection(config: IcpConfigObject, ctx: z.RefinementCtx): void {
  const included = new Set<string>(config.geography.includedCountries);

  config.mustNiceExclude.mustHave.forEach((rule, index) => {
    if (rule.field !== 'company.country') return;
    const kind = operandKindForOperator(rule.operator);
    const referenced =
      kind === 'LIST' ? (rule.values ?? []).map(String) : kind === 'SINGLE' ? [String(rule.value)] : [];
    const positive = rule.operator === 'EQUALS' || rule.operator === 'IN';
    if (!positive || referenced.length === 0) return;

    const unreachable = referenced.filter((country) => !included.has(country));
    if (unreachable.length > 0) {
      custom(
        ctx,
        ['mustNiceExclude', 'mustHave', index],
        `Must-have country rule references countries outside the target geography: ${unreachable.join(', ')}`,
      );
    }
  });
}

export const icpConfigSchema = icpConfigObjectSchema.superRefine(refineCrossSection);

export type IcpConfigInput = z.input<typeof icpConfigSchema>;
export type IcpConfig = z.output<typeof icpConfigSchema>;

// ---------------------------------------------------------------------------
// API request schemas
// ---------------------------------------------------------------------------

/** Status a client may set. ARCHIVED is reached through DELETE, not through a write. */
export const writableIcpStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createIcpRequestSchema = z
  .object({
    status: writableIcpStatusSchema.default('ACTIVE'),
    createdBy: z.string().trim().min(1).max(120).optional(),
    changeReason: z.string().trim().max(280).optional(),
    config: icpConfigSchema,
  })
  .strict();

export const updateIcpRequestSchema = createIcpRequestSchema;

export const icpIdParamsSchema = z
  .object({
    id: z.string().uuid('An ICP id must be a UUID'),
  })
  .strict();

export const listIcpQuerySchema = z
  .object({
    status: z.enum(ICP_STATUSES).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type CreateIcpRequest = z.output<typeof createIcpRequestSchema>;
export type CreateIcpRequestInput = z.input<typeof createIcpRequestSchema>;
export type UpdateIcpRequest = z.output<typeof updateIcpRequestSchema>;
export type ListIcpQuery = z.output<typeof listIcpQuerySchema>;
export type ScoringWeights = z.output<typeof scoringWeightsSchema>;
export type AccountReference = z.output<typeof accountReferenceSchema>;
export type KeywordGroup = z.output<typeof keywordGroupSchema>;
export type IcpTrigger = z.output<typeof triggerSchema>;
export type BasicProfileSection = z.output<typeof basicProfileSchema>;
export type GeographySection = z.output<typeof geographySchema>;
export type CompanyProfileSection = z.output<typeof companyProfileSchema>;
export type TechnologySection = z.output<typeof technologySchema>;
export type ServicesFitSection = z.output<typeof servicesFitSchema>;
export type BusinessProblemsSection = z.output<typeof businessProblemsSchema>;
export type MustNiceExcludeSection = z.output<typeof mustNiceExcludeSchema>;
export type TriggersIntentSection = z.output<typeof triggersIntentSchema>;
export type TargetBuyerSection = z.output<typeof targetBuyerSchema>;
export type EvidenceDiscoverySection = z.output<typeof evidenceDiscoverySchema>;
