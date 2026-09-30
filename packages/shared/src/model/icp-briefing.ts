import {
  ICP_OBJECTIVE_OPTIONS,
  ICP_PRIORITY_OPTIONS,
  LANGUAGE_OPTIONS,
} from '../icp/catalogs/basic.js';
import {
  BUYER_ROLE_OPTIONS,
  DEPARTMENT_OPTIONS,
  REACHABILITY_REQUIREMENT_OPTIONS,
  SENIORITY_OPTIONS,
  TARGET_TITLE_OPTIONS,
} from '../icp/catalogs/buyer.js';
import {
  BUSINESS_MODEL_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  INDUSTRY_OPTIONS,
  MATURITY_STAGE_OPTIONS,
} from '../icp/catalogs/company.js';
import {
  DISCOVERY_STRATEGY_OPTIONS,
  EVIDENCE_DIRECTNESS_OPTIONS,
  SOURCE_RELIABILITY_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from '../icp/catalogs/evidence.js';
import {
  COUNTRY_OPTIONS,
  LOCATION_SCOPE_OPTIONS,
  REGION_OPTIONS,
} from '../icp/catalogs/geography.js';
import {
  BUSINESS_PROBLEM_OPTIONS,
  CAPACITY_GAP_INDICATOR_OPTIONS,
  COMPLIANCE_FRAMEWORK_OPTIONS,
} from '../icp/catalogs/problems.js';
import {
  BUYING_INDICATOR_OPTIONS,
  DEAL_SIZE_BAND_OPTIONS,
  ENGAGEMENT_MODEL_OPTIONS,
  OUTSOURCING_POSTURE_OPTIONS,
  SERVICE_OFFERING_OPTIONS,
} from '../icp/catalogs/services.js';
import {
  SIGNAL_DECAY_CLASS_OPTIONS,
  SIGNAL_POLARITY_OPTIONS,
  TRIGGER_TYPE_OPTIONS,
} from '../icp/catalogs/signals.js';
import {
  CLOUD_PROVIDER_OPTIONS,
  LEGACY_INDICATOR_OPTIONS,
  TECHNOLOGY_MATURITY_OPTIONS,
  TECHNOLOGY_OPTIONS,
} from '../icp/catalogs/technology.js';
import { describeRule } from '../icp/rule-schema.js';
import type { IcpConfig } from '../icp/schema.js';
import type { SelectOption } from '../util/options.js';

/**
 * The ICP, written out for a reader.
 *
 * This exists because of a specific, measured failure. The analysis used to be
 * handed the normalized configuration as JSON, which means the model saw
 * `"requiredTechnologies": ["NODEJS"]` and `"industries": ["SOFTWARE_SAAS"]` -
 * opaque codes with no meaning attached. Given codes, the best a model can
 * honestly do is repeat them, and it did: entries such as `{ label: "Node.js",
 * rationale: "technology.requiredTechnologies includes NODEJS" }` were not the
 * model failing to reason, they were the model having nothing to reason with.
 *
 * The catalogs already carry the human wording for every code, and the ICP
 * overview screen already renders it. This module does the same for the model,
 * so `LEGACY_ERP` arrives as "Legacy ERP", `FROM_150K_TO_500K` as "150k - 500k"
 * and a stored rule as "Country is any of NL, BE, LU".
 *
 * Two properties matter:
 *
 *  - **Derived, never authored.** The briefing is a pure function of the
 *    configuration, so the input snapshot stays the normalized ICP and a stored
 *    analysis remains reproducible: the same snapshot renders the same briefing.
 *  - **One source of truth for wording.** Labels come from the same catalogs the
 *    form writes and the overview reads, so no second copy of the wording can
 *    drift.
 *
 * The layout is not incidental either. Sections that have to be read *together*
 * to mean anything are adjacent - the modern stack next to the legacy
 * indicators, the problems next to the capacity gaps, the services next to the
 * engagement models - because the analysis this feeds is judged on cross-field
 * reasoning, and a briefing that scatters those fields invites the field-by-field
 * answer it is trying to replace.
 *
 * It does not interpret. Drawing the conclusions is the model's job; handing it
 * pre-drawn ones would make the analysis a template with a language model
 * attached.
 */

/** Label lookup over one of the shared option catalogs. */
function labeller<T extends string>(options: readonly SelectOption<T>[]): (value: T) => string {
  const map = new Map<string, string>(options.map((option) => [option.value, option.label]));
  return (value) => map.get(value) ?? value;
}

const label = {
  objective: labeller(ICP_OBJECTIVE_OPTIONS),
  priority: labeller(ICP_PRIORITY_OPTIONS),
  language: labeller(LANGUAGE_OPTIONS),
  region: labeller(REGION_OPTIONS),
  country: labeller(COUNTRY_OPTIONS),
  locationScope: labeller(LOCATION_SCOPE_OPTIONS),
  industry: labeller(INDUSTRY_OPTIONS),
  companyType: labeller(COMPANY_TYPE_OPTIONS),
  businessModel: labeller(BUSINESS_MODEL_OPTIONS),
  maturityStage: labeller(MATURITY_STAGE_OPTIONS),
  technology: labeller(TECHNOLOGY_OPTIONS),
  technologyMaturity: labeller(TECHNOLOGY_MATURITY_OPTIONS),
  cloudProvider: labeller(CLOUD_PROVIDER_OPTIONS),
  legacyIndicator: labeller(LEGACY_INDICATOR_OPTIONS),
  serviceOffering: labeller(SERVICE_OFFERING_OPTIONS),
  engagementModel: labeller(ENGAGEMENT_MODEL_OPTIONS),
  dealSizeBand: labeller(DEAL_SIZE_BAND_OPTIONS),
  outsourcingPosture: labeller(OUTSOURCING_POSTURE_OPTIONS),
  buyingIndicator: labeller(BUYING_INDICATOR_OPTIONS),
  businessProblem: labeller(BUSINESS_PROBLEM_OPTIONS),
  capacityGap: labeller(CAPACITY_GAP_INDICATOR_OPTIONS),
  complianceFramework: labeller(COMPLIANCE_FRAMEWORK_OPTIONS),
  triggerType: labeller(TRIGGER_TYPE_OPTIONS),
  polarity: labeller(SIGNAL_POLARITY_OPTIONS),
  decayClass: labeller(SIGNAL_DECAY_CLASS_OPTIONS),
  seniority: labeller(SENIORITY_OPTIONS),
  department: labeller(DEPARTMENT_OPTIONS),
  targetTitle: labeller(TARGET_TITLE_OPTIONS),
  buyerRole: labeller(BUYER_ROLE_OPTIONS),
  reachability: labeller(REACHABILITY_REQUIREMENT_OPTIONS),
  discoveryStrategy: labeller(DISCOVERY_STRATEGY_OPTIONS),
  sourceType: labeller(SOURCE_TYPE_OPTIONS),
  sourceReliability: labeller(SOURCE_RELIABILITY_OPTIONS),
  directness: labeller(EVIDENCE_DIRECTNESS_OPTIONS),
};

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Compact money, so 750000000 reads as 750M rather than as nine digits. */
function money(amount: number, currency: string): string {
  if (amount >= 1_000_000_000) return `${NUMBER.format(amount / 1_000_000_000)}B ${currency}`;
  if (amount >= 1_000_000) return `${NUMBER.format(amount / 1_000_000)}M ${currency}`;
  if (amount >= 1_000) return `${NUMBER.format(amount / 1_000)}k ${currency}`;
  return `${NUMBER.format(amount)} ${currency}`;
}

/** An unset bound means "no limit", which is not the same as zero. */
function range(
  min: number | undefined,
  max: number | undefined,
  format: (value: number) => string,
): string {
  if (min === undefined && max === undefined) return 'not restricted';
  if (min !== undefined && max !== undefined) return `${format(min)} to ${format(max)}`;
  if (min !== undefined) return `${format(min)} or more`;
  return `up to ${format(max ?? 0)}`;
}

/** One `key: value` line, dropped entirely when the value is empty. */
type Line = readonly [string, string];

function list<T extends string>(values: readonly T[], toLabel: (value: T) => string): string {
  return values.map(toLabel).join(', ');
}

function section(title: string, lines: readonly (Line | null)[]): string | null {
  const rendered = lines
    .filter((line): line is Line => line !== null && line[1].trim().length > 0)
    .map(([key, value]) => `  ${key}: ${value}`);

  // A section every line of which is empty says nothing, and an empty heading
  // reads to a model as a dimension it should invent content for.
  return rendered.length === 0 ? null : [title, ...rendered].join('\n');
}

/** A line that disappears when the underlying list is empty. */
function optional<T extends string>(
  key: string,
  values: readonly T[],
  toLabel: (value: T) => string,
): Line | null {
  return values.length === 0 ? null : [key, list(values, toLabel)];
}

/**
 * Renders one ICP configuration as a briefing.
 *
 * Deterministic: no dates, no randomness, no locale-dependent formatting, so
 * two runs over the same snapshot produce byte-identical text.
 */
export function buildIcpBriefing(config: IcpConfig): string {
  const {
    basicProfile,
    geography,
    companyProfile,
    technology,
    servicesFit,
    businessProblems,
    mustNiceExclude,
    triggersIntent,
    targetBuyer,
    evidenceDiscovery,
  } = config;

  const currency = companyProfile.revenueRange.currency;

  const sections: (string | null)[] = [
    section('COMMERCIAL INTENT', [
      ['ICP name', basicProfile.name],
      basicProfile.description ? ['Author notes', basicProfile.description] : null,
      ['Objective', label.objective(basicProfile.objective)],
      ['Priority', label.priority(basicProfile.priority)],
      ['Operating languages', list(basicProfile.languages, label.language)],
    ]),

    section('TARGET GEOGRAPHY', [
      optional('Regions', geography.regions, label.region),
      ['Countries', list(geography.includedCountries, label.country)],
      optional('Excluded countries', geography.excludedCountries, label.country),
      ['Which location must match', label.locationScope(geography.locationScope)],
    ]),

    section('COMPANY PROFILE', [
      ['Industries', list(companyProfile.industries, label.industry)],
      optional('Excluded industries', companyProfile.excludedIndustries, label.industry),
      [
        'Employees',
        range(companyProfile.employeeRange.min, companyProfile.employeeRange.max, (value) =>
          NUMBER.format(value),
        ),
      ],
      [
        'Annual revenue',
        range(companyProfile.revenueRange.min, companyProfile.revenueRange.max, (value) =>
          money(value, currency),
        ),
      ],
      optional('Business models', companyProfile.businessModels, label.businessModel),
      optional('Company types', companyProfile.companyTypes, label.companyType),
      optional('Maturity stages', companyProfile.maturityStages, label.maturityStage),
    ]),

    // The modern stack and the legacy estate are one section on purpose: read
    // apart they are two lists, read together they are a transition.
    section('TECHNOLOGY ENVIRONMENT', [
      optional('Required technologies', technology.requiredTechnologies, label.technology),
      optional('Preferred technologies', technology.preferredTechnologies, label.technology),
      optional('Excluded technologies', technology.excludedTechnologies, label.technology),
      optional('Technology maturity', technology.technologyMaturities, label.technologyMaturity),
      optional('Cloud providers', technology.cloudProviders, label.cloudProvider),
      optional('Legacy indicators', technology.legacyIndicators, label.legacyIndicator),
    ]),

    section('SERVICES OFFERED TO THIS ICP', [
      ['Service offerings', list(servicesFit.serviceOfferings, label.serviceOffering)],
      ['Engagement models', list(servicesFit.engagementModels, label.engagementModel)],
      ['Expected deal size', label.dealSizeBand(servicesFit.dealSizeBand)],
      ['Outsourcing posture sought', label.outsourcingPosture(servicesFit.outsourcingPosture)],
      optional('Buying indicators', servicesFit.buyingIndicators, label.buyingIndicator),
    ]),

    section('BUSINESS PROBLEMS THIS ICP IS SELECTED FOR', [
      ['Problems', list(businessProblems.problems, label.businessProblem)],
      optional('Highest priority problems', businessProblems.priorityProblems, label.businessProblem),
      optional('Capacity gap indicators', businessProblems.capacityGapIndicators, label.capacityGap),
      optional(
        'Compliance frameworks in scope',
        businessProblems.complianceFrameworks,
        label.complianceFramework,
      ),
    ]),

    section('HARD FILTERS AND SCORING RULES', [
      ['Must have', mustNiceExclude.mustHave.map(describeRule).join('; ')],
      mustNiceExclude.niceToHave.length === 0
        ? null
        : [
            'Nice to have',
            mustNiceExclude.niceToHave
              .map((rule) => `${describeRule(rule)} (weight ${String(rule.weight ?? 0)})`)
              .join('; '),
          ],
      mustNiceExclude.exclusions.length === 0
        ? null
        : ['Disqualifies an account', mustNiceExclude.exclusions.map(describeRule).join('; ')],
    ]),

    section('CONFIGURED INTENT TRIGGERS', [
      [
        'Triggers',
        triggersIntent.triggers
          .map(
            (trigger) =>
              `${label.triggerType(trigger.type)} (${label.polarity(trigger.polarity)}, ` +
              `${label.decayClass(trigger.decayClass)}, relevance ${String(trigger.relevance)}/10, ` +
              `counts for ${String(trigger.lookbackDays)} days)`,
          )
          .join('; '),
      ],
      optional('Ignored trigger types', triggersIntent.excludedTriggerTypes, label.triggerType),
      ['Minimum signals per account', String(triggersIntent.minimumSignalCount)],
      ['Signal freshness window', `${String(triggersIntent.signalFreshnessWindowDays)} days`],
      [
        'A non-decaying structural signal is',
        triggersIntent.requireStructuralSignal ? 'required' : 'not required',
      ],
    ]),

    section('TARGET BUYER', [
      ['Seniorities', list(targetBuyer.seniorities, label.seniority)],
      ['Departments', list(targetBuyer.departments, label.department)],
      optional('Titles', targetBuyer.titles, label.targetTitle),
      optional('Buying roles', targetBuyer.buyerRoles, label.buyerRole),
      ['Reachability requirement', label.reachability(targetBuyer.reachabilityRequirement)],
      ['Minimum contacts per account', String(targetBuyer.minimumContactsPerAccount)],
    ]),

    // The evidence rules the analysis has to work inside: the model may only
    // ask for proof from sources this ICP actually accepts.
    section('EVIDENCE AND DISCOVERY CONSTRAINTS', [
      ['Discovery strategies enabled', list(evidenceDiscovery.discoveryStrategies, label.discoveryStrategy)],
      ['Allowed evidence source types', list(evidenceDiscovery.allowedSourceTypes, label.sourceType)],
      [
        'Allowed source type codes (use these verbatim)',
        evidenceDiscovery.allowedSourceTypes.join(', '),
      ],
      ['Minimum source reliability', label.sourceReliability(evidenceDiscovery.minimumSourceReliability)],
      ['Required directness', label.directness(evidenceDiscovery.requiredDirectness)],
      ['Maximum evidence age', `${String(evidenceDiscovery.evidenceFreshnessDays)} days`],
      [
        'Independent sources required per claim',
        String(evidenceDiscovery.minimumCorroborationCount),
      ],
      evidenceDiscovery.keywordGroups.length === 0
        ? null
        : [
            'Keyword groups the author already supplied',
            evidenceDiscovery.keywordGroups
              .map((group) => `${group.label}: ${group.terms.join(', ')}`)
              .join('; '),
          ],
      evidenceDiscovery.lookAlikeAccounts.length === 0
        ? null
        : [
            'Reference accounts to find look-alikes of',
            evidenceDiscovery.lookAlikeAccounts.map((account) => account.name).join(', '),
          ],
      // Suppressed accounts are named, not counted: an excluded account is a
      // disqualifier the fit model has to know about.
      evidenceDiscovery.suppressedAccounts.length === 0
        ? null
        : [
            'Accounts already excluded',
            evidenceDiscovery.suppressedAccounts.map((account) => account.name).join(', '),
          ],
    ]),
  ];

  return sections.filter((entry): entry is string => entry !== null).join('\n\n');
}
