import type { ReactNode } from 'react';
import {
  BUSINESS_MODEL_OPTIONS,
  BUSINESS_PROBLEM_OPTIONS,
  BUYER_ROLE_OPTIONS,
  BUYING_INDICATOR_OPTIONS,
  CAPACITY_GAP_INDICATOR_OPTIONS,
  CLOUD_PROVIDER_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  COMPLIANCE_FRAMEWORK_OPTIONS,
  COUNTRY_OPTIONS,
  DEAL_SIZE_BAND_OPTIONS,
  DEPARTMENT_OPTIONS,
  DISCOVERY_STRATEGY_OPTIONS,
  ENGAGEMENT_MODEL_OPTIONS,
  EVIDENCE_DIRECTNESS_OPTIONS,
  ICP_OBJECTIVE_OPTIONS,
  ICP_PRIORITY_OPTIONS,
  INDUSTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  LEGACY_INDICATOR_OPTIONS,
  LOCATION_SCOPE_OPTIONS,
  MATURITY_STAGE_OPTIONS,
  OUTSOURCING_POSTURE_OPTIONS,
  REACHABILITY_REQUIREMENT_OPTIONS,
  REGION_OPTIONS,
  SENIORITY_OPTIONS,
  SERVICE_OFFERING_OPTIONS,
  SOURCE_RELIABILITY_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  TARGET_TITLE_OPTIONS,
  TECHNOLOGY_MATURITY_OPTIONS,
  TECHNOLOGY_OPTIONS,
  TRIGGER_TYPE_OPTIONS,
  describeRule,
  type IcpConfig,
  type IcpRule,
  type SelectOption,
} from '@pursuit/shared';
import { Badge, cn } from '../../components/ui/index.js';

/**
 * Label lookup over one of the shared option catalogs.
 *
 * The catalogs are the single source of truth for how a stored code is spelled
 * for a human, so the overview reads the same labels the form wrote - it never
 * shows a raw `PLATFORM_MODERNIZATION` and never keeps a second copy of the
 * wording that could drift from the form's.
 */
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

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** An unset bound means "no limit", which is not the same as zero. */
function rangeText(min: number | undefined, max: number | undefined, unit?: string): string {
  const suffix = unit ? ` ${unit}` : '';
  if (min === undefined && max === undefined) return 'Any';
  if (min !== undefined && max !== undefined) {
    return `${NUMBER.format(min)} – ${NUMBER.format(max)}${suffix}`;
  }
  if (min !== undefined) return `${NUMBER.format(min)}+${suffix}`;
  return `Up to ${NUMBER.format(max ?? 0)}${suffix}`;
}

// ---------------------------------------------------------------------------
// Layout primitives, local to the overview
// ---------------------------------------------------------------------------

function Card({
  title,
  span,
  children,
}: {
  title: string;
  span?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'min-w-0 rounded-card border border-line bg-surface shadow-card',
        span && 'md:col-span-2',
      )}
    >
      <h3 className="border-b border-line px-4 py-3 text-[13px] font-semibold text-ink">{title}</h3>
      <dl className="flex flex-col gap-3 px-4 py-3.5">{children}</dl>
    </section>
  );
}

/** One label/value pair. The label column is fixed so values line up. */
function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint sm:pt-0.5">
        {term}
      </dt>
      <dd className="min-w-0 text-[13px] leading-6 text-ink-soft">{children}</dd>
    </div>
  );
}

/** Chip list; an empty selection says so instead of collapsing to nothing. */
function Chips<T extends string>({
  values,
  format,
  tone = 'neutral',
  empty = 'Not set',
}: {
  values: readonly T[];
  format: (value: T) => string;
  tone?: 'neutral' | 'outline' | 'critical' | 'brand';
  empty?: string;
}) {
  if (values.length === 0) return <span className="text-ink-faint">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <Badge key={value} tone={tone}>
          {format(value)}
        </Badge>
      ))}
    </span>
  );
}

function RuleList({ rules, empty }: { rules: readonly IcpRule[]; empty: string }) {
  if (rules.length === 0) return <span className="text-ink-faint">{empty}</span>;
  return (
    <ul className="flex flex-col gap-1">
      {rules.map((rule, index) => (
        <li className="flex flex-wrap items-baseline gap-1.5" key={`${rule.field}-${index}`}>
          <span>{describeRule(rule)}</span>
          {rule.weight === undefined ? null : <Badge tone="outline">weight {rule.weight}</Badge>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

export interface IcpOverviewProps {
  config: IcpConfig;
}

/**
 * Readable summary of a stored ICP.
 *
 * Grouped the way the criteria are reasoned about rather than the way they are
 * stored, so the question "what does this ICP target?" is answered by reading,
 * not by opening ten form sections. Editing stays entirely in the form; nothing
 * here is a control.
 */
export function IcpOverview({ config }: IcpOverviewProps) {
  const { basicProfile, geography, companyProfile, technology } = config;
  const { servicesFit, businessProblems, mustNiceExclude } = config;
  const { triggersIntent, targetBuyer, evidenceDiscovery } = config;

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <Card title="Profile" span>
        <Row term="Description">
          {basicProfile.description && basicProfile.description.trim().length > 0 ? (
            <p className="max-w-3xl">{basicProfile.description}</p>
          ) : (
            <span className="text-ink-faint">No description</span>
          )}
        </Row>
        <Row term="Objective">{label.objective(basicProfile.objective)}</Row>
        <Row term="Priority">{label.priority(basicProfile.priority)}</Row>
        <Row term="Languages">
          <Chips values={basicProfile.languages} format={label.language} />
        </Row>
      </Card>

      <Card title="Company profile">
        <Row term="Industries">
          <Chips values={companyProfile.industries} format={label.industry} tone="brand" />
        </Row>
        <Row term="Excluded">
          <Chips
            values={companyProfile.excludedIndustries}
            format={label.industry}
            tone="critical"
            empty="None"
          />
        </Row>
        <Row term="Business models">
          <Chips values={companyProfile.businessModels} format={label.businessModel} />
        </Row>
        <Row term="Employees">
          {rangeText(companyProfile.employeeRange.min, companyProfile.employeeRange.max, 'employees')}
        </Row>
        <Row term="Revenue">
          {companyProfile.revenueRange.min === undefined &&
          companyProfile.revenueRange.max === undefined
            ? 'Any'
            : `${rangeText(companyProfile.revenueRange.min, companyProfile.revenueRange.max)} ${companyProfile.revenueRange.currency}`}
        </Row>
        <Row term="Company types">
          <Chips values={companyProfile.companyTypes} format={label.companyType} empty="Any" />
        </Row>
        <Row term="Maturity">
          <Chips values={companyProfile.maturityStages} format={label.maturityStage} empty="Any" />
        </Row>
      </Card>

      <Card title="Geography">
        <Row term="Regions">
          <Chips values={geography.regions} format={label.region} empty="Any" />
        </Row>
        <Row term="Countries">
          <Chips values={geography.includedCountries} format={label.country} tone="brand" />
        </Row>
        <Row term="Excluded">
          <Chips
            values={geography.excludedCountries}
            format={label.country}
            tone="critical"
            empty="None"
          />
        </Row>
        <Row term="Location scope">{label.locationScope(geography.locationScope)}</Row>
      </Card>

      <Card title="Technology">
        <Row term="Required">
          <Chips
            values={technology.requiredTechnologies}
            format={label.technology}
            tone="brand"
            empty="None"
          />
        </Row>
        <Row term="Preferred">
          <Chips values={technology.preferredTechnologies} format={label.technology} empty="None" />
        </Row>
        <Row term="Excluded">
          <Chips
            values={technology.excludedTechnologies}
            format={label.technology}
            tone="critical"
            empty="None"
          />
        </Row>
        <Row term="Maturity">
          <Chips
            values={technology.technologyMaturities}
            format={label.technologyMaturity}
            empty="Any"
          />
        </Row>
        <Row term="Cloud">
          <Chips values={technology.cloudProviders} format={label.cloudProvider} empty="Any" />
        </Row>
        <Row term="Legacy markers">
          <Chips
            values={technology.legacyIndicators}
            format={label.legacyIndicator}
            empty="None"
          />
        </Row>
      </Card>

      <Card title="Services & fit">
        <Row term="Offerings">
          <Chips values={servicesFit.serviceOfferings} format={label.serviceOffering} tone="brand" />
        </Row>
        <Row term="Engagement">
          <Chips values={servicesFit.engagementModels} format={label.engagementModel} />
        </Row>
        <Row term="Deal size">{label.dealSizeBand(servicesFit.dealSizeBand)}</Row>
        <Row term="Outsourcing">{label.outsourcingPosture(servicesFit.outsourcingPosture)}</Row>
        <Row term="Buying signals">
          <Chips
            values={servicesFit.buyingIndicators}
            format={label.buyingIndicator}
            empty="None"
          />
        </Row>
      </Card>

      <Card title="Business problems">
        <Row term="Problems">
          <Chips values={businessProblems.problems} format={label.businessProblem} />
        </Row>
        <Row term="Priority">
          <Chips
            values={businessProblems.priorityProblems}
            format={label.businessProblem}
            tone="brand"
            empty="None"
          />
        </Row>
        <Row term="Capacity gaps">
          <Chips
            values={businessProblems.capacityGapIndicators}
            format={label.capacityGap}
            empty="None"
          />
        </Row>
        <Row term="Compliance">
          <Chips
            values={businessProblems.complianceFrameworks}
            format={label.complianceFramework}
            empty="None"
          />
        </Row>
      </Card>

      <Card title="Target buyer">
        <Row term="Seniorities">
          <Chips values={targetBuyer.seniorities} format={label.seniority} tone="brand" />
        </Row>
        <Row term="Departments">
          <Chips values={targetBuyer.departments} format={label.department} />
        </Row>
        <Row term="Titles">
          <Chips values={targetBuyer.titles} format={label.targetTitle} empty="Any" />
        </Row>
        <Row term="Buyer roles">
          <Chips values={targetBuyer.buyerRoles} format={label.buyerRole} empty="Any" />
        </Row>
        <Row term="Reachability">{label.reachability(targetBuyer.reachabilityRequirement)}</Row>
        <Row term="Min contacts">
          <span className="pu-numeric">{targetBuyer.minimumContactsPerAccount}</span>
        </Row>
      </Card>

      <Card title="Triggers & intent">
        <Row term="Triggers">
          {triggersIntent.triggers.length === 0 ? (
            <span className="text-ink-faint">None</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {triggersIntent.triggers.map((trigger) => (
                <li className="flex flex-wrap items-baseline gap-1.5" key={trigger.type}>
                  <span>{label.triggerType(trigger.type)}</span>
                  <Badge tone={trigger.polarity === 'NEGATIVE' ? 'critical' : 'outline'}>
                    relevance {trigger.relevance}
                  </Badge>
                  <Badge tone="outline">{trigger.lookbackDays}d lookback</Badge>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row term="Excluded">
          <Chips
            values={triggersIntent.excludedTriggerTypes}
            format={label.triggerType}
            tone="critical"
            empty="None"
          />
        </Row>
        <Row term="Min signals">
          <span className="pu-numeric">{triggersIntent.minimumSignalCount}</span>
        </Row>
        <Row term="Freshness">
          <span className="pu-numeric">{triggersIntent.signalFreshnessWindowDays}</span> days
        </Row>
        <Row term="Structural">
          {triggersIntent.requireStructuralSignal ? 'Required' : 'Not required'}
        </Row>
      </Card>

      <Card title="Criteria rules" span>
        <Row term="Must have">
          <RuleList rules={mustNiceExclude.mustHave} empty="No hard filters" />
        </Row>
        <Row term="Nice to have">
          <RuleList rules={mustNiceExclude.niceToHave} empty="None" />
        </Row>
        <Row term="Exclusions">
          <RuleList rules={mustNiceExclude.exclusions} empty="None" />
        </Row>
      </Card>

      <Card title="Evidence & discovery" span>
        <Row term="Strategies">
          <Chips
            values={evidenceDiscovery.discoveryStrategies}
            format={label.discoveryStrategy}
            tone="brand"
          />
        </Row>
        <Row term="Keyword groups">
          {evidenceDiscovery.keywordGroups.length === 0 ? (
            <span className="text-ink-faint">None</span>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {evidenceDiscovery.keywordGroups.map((group) => (
                <li key={group.label}>
                  <span className="text-[13px] font-medium text-ink">{group.label}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {group.terms.map((term) => (
                      <Badge key={term} tone="neutral">
                        {term}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row term="Allowed sources">
          <Chips values={evidenceDiscovery.allowedSourceTypes} format={label.sourceType} />
        </Row>
        <Row term="Min reliability">
          {label.sourceReliability(evidenceDiscovery.minimumSourceReliability)}
        </Row>
        <Row term="Directness">{label.directness(evidenceDiscovery.requiredDirectness)}</Row>
        <Row term="Evidence age">
          At most <span className="pu-numeric">{evidenceDiscovery.evidenceFreshnessDays}</span> days
        </Row>
        <Row term="Corroboration">
          <span className="pu-numeric">{evidenceDiscovery.minimumCorroborationCount}</span> sources
        </Row>
        <Row term="Reference accounts">
          {evidenceDiscovery.lookAlikeAccounts.length === 0 ? (
            <span className="text-ink-faint">None</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {evidenceDiscovery.lookAlikeAccounts.map((account) => (
                <Badge key={account.id} tone="neutral">
                  {account.name}
                </Badge>
              ))}
            </span>
          )}
        </Row>
        <Row term="Suppressed">
          {evidenceDiscovery.suppressedAccounts.length === 0 ? (
            <span className="text-ink-faint">None</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {evidenceDiscovery.suppressedAccounts.map((account) => (
                <Badge key={account.id} tone="critical">
                  {account.name}
                </Badge>
              ))}
            </span>
          )}
        </Row>
      </Card>
    </div>
  );
}
