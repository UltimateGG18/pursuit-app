import { LANGUAGES } from './catalogs/basic.js';
import { COUNTRIES, REGIONS } from './catalogs/geography.js';
import {
  BUSINESS_MODELS,
  COMPANY_TYPES,
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
  ENGAGEMENT_MODELS,
  SERVICE_OFFERINGS,
} from './catalogs/services.js';
import {
  BUSINESS_PROBLEMS,
  CAPACITY_GAP_INDICATORS,
  COMPLIANCE_FRAMEWORKS,
} from './catalogs/problems.js';
import { TRIGGER_TYPES } from './catalogs/signals.js';
import { BUYER_ROLES, DEPARTMENTS, SENIORITIES, TARGET_TITLES } from './catalogs/buyer.js';
import { DISCOVERY_STRATEGIES, SOURCE_TYPES } from './catalogs/evidence.js';
import { canonicalizeEnumList, slugify, trimOrUndefined, uniqueStrings } from '../util/collections.js';
import type { AccountReference, IcpConfig, KeywordGroup } from './schema.js';
import type { IcpRule } from './rule-schema.js';
import { operandKindForOperator } from './rule-fields.js';

function newRuleId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Deterministic-enough fallback for runtimes without WebCrypto.
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Strips value slots the operator does not use and assigns a stable id, so the
 * stored rule is exactly the rule the engine will evaluate later.
 */
function normalizeRule(rule: IcpRule): IcpRule {
  const kind = operandKindForOperator(rule.operator);
  const normalized: IcpRule = {
    id: rule.id ?? newRuleId(),
    field: rule.field,
    operator: rule.operator,
    unknownHandling: rule.unknownHandling,
  };

  if (kind === 'SINGLE') {
    normalized.value = typeof rule.value === 'string' ? rule.value.trim() : rule.value;
  } else if (kind === 'LIST') {
    normalized.values = uniqueStrings((rule.values ?? []).map(String)).sort();
  } else if (kind === 'RANGE' && rule.range) {
    normalized.range = { min: rule.range.min, max: rule.range.max };
  }

  if (rule.weight !== undefined) normalized.weight = rule.weight;
  const note = trimOrUndefined(rule.note);
  if (note) normalized.note = note;

  return normalized;
}

function normalizeAccounts(accounts: readonly AccountReference[]): AccountReference[] {
  const byId = new Map<string, AccountReference>();
  for (const account of accounts) {
    const id = account.id.trim();
    if (byId.has(id)) continue;
    const domain = trimOrUndefined(account.domain)?.toLowerCase();
    byId.set(id, {
      id,
      name: account.name.trim(),
      ...(domain ? { domain } : {}),
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeKeywordGroups(groups: readonly KeywordGroup[]): KeywordGroup[] {
  const byLabel = new Map<string, KeywordGroup>();
  for (const group of groups) {
    const label = group.label.trim();
    const key = label.toLowerCase();
    if (byLabel.has(key)) continue;
    const terms = uniqueStrings(group.terms.map((term) => term.trim().toLowerCase())).sort();
    byLabel.set(key, { label, terms });
  }
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Canonicalizes a validated ICP configuration: option lists are de-duplicated
 * and ordered by their catalog, strings are trimmed, empty optionals are
 * dropped and every rule gets an id. The original submitted payload is stored
 * separately, so normalization never destroys what the user sent.
 */
export function normalizeIcpConfig(config: IcpConfig): IcpConfig {
  const description = trimOrUndefined(config.basicProfile.description);

  const triggerOrder = new Map<string, number>(TRIGGER_TYPES.map((type, index) => [type, index]));

  return {
    schemaVersion: config.schemaVersion,
    basicProfile: {
      name: config.basicProfile.name.trim().replace(/\s+/g, ' '),
      ...(description ? { description } : {}),
      objective: config.basicProfile.objective,
      priority: config.basicProfile.priority,
      languages: canonicalizeEnumList(config.basicProfile.languages, LANGUAGES),
    },
    geography: {
      regions: canonicalizeEnumList(config.geography.regions, REGIONS),
      includedCountries: canonicalizeEnumList(config.geography.includedCountries, COUNTRIES),
      excludedCountries: canonicalizeEnumList(config.geography.excludedCountries, COUNTRIES),
      locationScope: config.geography.locationScope,
    },
    companyProfile: {
      industries: canonicalizeEnumList(config.companyProfile.industries, INDUSTRIES),
      excludedIndustries: canonicalizeEnumList(config.companyProfile.excludedIndustries, INDUSTRIES),
      employeeRange: config.companyProfile.employeeRange,
      revenueRange: config.companyProfile.revenueRange,
      companyTypes: canonicalizeEnumList(config.companyProfile.companyTypes, COMPANY_TYPES),
      businessModels: canonicalizeEnumList(config.companyProfile.businessModels, BUSINESS_MODELS),
      maturityStages: canonicalizeEnumList(config.companyProfile.maturityStages, MATURITY_STAGES),
    },
    technology: {
      requiredTechnologies: canonicalizeEnumList(config.technology.requiredTechnologies, TECHNOLOGIES),
      preferredTechnologies: canonicalizeEnumList(config.technology.preferredTechnologies, TECHNOLOGIES),
      excludedTechnologies: canonicalizeEnumList(config.technology.excludedTechnologies, TECHNOLOGIES),
      technologyMaturities: canonicalizeEnumList(
        config.technology.technologyMaturities,
        TECHNOLOGY_MATURITIES,
      ),
      cloudProviders: canonicalizeEnumList(config.technology.cloudProviders, CLOUD_PROVIDERS),
      legacyIndicators: canonicalizeEnumList(config.technology.legacyIndicators, LEGACY_INDICATORS),
    },
    servicesFit: {
      serviceOfferings: canonicalizeEnumList(config.servicesFit.serviceOfferings, SERVICE_OFFERINGS),
      engagementModels: canonicalizeEnumList(config.servicesFit.engagementModels, ENGAGEMENT_MODELS),
      dealSizeBand: config.servicesFit.dealSizeBand,
      outsourcingPosture: config.servicesFit.outsourcingPosture,
      buyingIndicators: canonicalizeEnumList(config.servicesFit.buyingIndicators, BUYING_INDICATORS),
    },
    businessProblems: {
      problems: canonicalizeEnumList(config.businessProblems.problems, BUSINESS_PROBLEMS),
      priorityProblems: canonicalizeEnumList(config.businessProblems.priorityProblems, BUSINESS_PROBLEMS),
      capacityGapIndicators: canonicalizeEnumList(
        config.businessProblems.capacityGapIndicators,
        CAPACITY_GAP_INDICATORS,
      ),
      complianceFrameworks: canonicalizeEnumList(
        config.businessProblems.complianceFrameworks,
        COMPLIANCE_FRAMEWORKS,
      ),
    },
    mustNiceExclude: {
      mustHave: config.mustNiceExclude.mustHave.map(normalizeRule),
      niceToHave: config.mustNiceExclude.niceToHave.map(normalizeRule),
      exclusions: config.mustNiceExclude.exclusions.map(normalizeRule),
    },
    triggersIntent: {
      triggers: [...config.triggersIntent.triggers].sort(
        (a, b) => (triggerOrder.get(a.type) ?? 0) - (triggerOrder.get(b.type) ?? 0),
      ),
      excludedTriggerTypes: canonicalizeEnumList(
        config.triggersIntent.excludedTriggerTypes,
        TRIGGER_TYPES,
      ),
      minimumSignalCount: config.triggersIntent.minimumSignalCount,
      signalFreshnessWindowDays: config.triggersIntent.signalFreshnessWindowDays,
      requireStructuralSignal: config.triggersIntent.requireStructuralSignal,
    },
    targetBuyer: {
      seniorities: canonicalizeEnumList(config.targetBuyer.seniorities, SENIORITIES),
      departments: canonicalizeEnumList(config.targetBuyer.departments, DEPARTMENTS),
      titles: canonicalizeEnumList(config.targetBuyer.titles, TARGET_TITLES),
      buyerRoles: canonicalizeEnumList(config.targetBuyer.buyerRoles, BUYER_ROLES),
      reachabilityRequirement: config.targetBuyer.reachabilityRequirement,
      minimumContactsPerAccount: config.targetBuyer.minimumContactsPerAccount,
    },
    evidenceDiscovery: {
      discoveryStrategies: canonicalizeEnumList(
        config.evidenceDiscovery.discoveryStrategies,
        DISCOVERY_STRATEGIES,
      ),
      lookAlikeAccounts: normalizeAccounts(config.evidenceDiscovery.lookAlikeAccounts),
      suppressedAccounts: normalizeAccounts(config.evidenceDiscovery.suppressedAccounts),
      keywordGroups: normalizeKeywordGroups(config.evidenceDiscovery.keywordGroups),
      allowedSourceTypes: canonicalizeEnumList(config.evidenceDiscovery.allowedSourceTypes, SOURCE_TYPES),
      minimumSourceReliability: config.evidenceDiscovery.minimumSourceReliability,
      requiredDirectness: config.evidenceDiscovery.requiredDirectness,
      evidenceFreshnessDays: config.evidenceDiscovery.evidenceFreshnessDays,
      minimumCorroborationCount: config.evidenceDiscovery.minimumCorroborationCount,
    },
    scoringWeights: config.scoringWeights,
  };
}

/** Lookup key derived from the ICP name; used to detect duplicate profiles. */
export function icpSlug(config: IcpConfig): string {
  return slugify(config.basicProfile.name);
}
