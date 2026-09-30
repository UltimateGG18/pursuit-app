import { toOptions, type LabelMap } from '../../util/options.js';

/** Need-dimension problem catalog. Controlled list so problems stay comparable across ICPs. */
export const BUSINESS_PROBLEMS = [
  'SCALING_ENGINEERING_CAPACITY',
  'LEGACY_MODERNIZATION',
  'DATA_FRAGMENTATION',
  'COMPLIANCE_PRESSURE',
  'SLOW_TIME_TO_MARKET',
  'COST_PRESSURE',
  'TALENT_SHORTAGE',
  'INTEGRATION_COMPLEXITY',
  'MANUAL_OPERATIONS',
  'POOR_CUSTOMER_EXPERIENCE',
  'SECURITY_GAPS',
  'CLOUD_COST_OVERRUN',
  'UNRELIABLE_PLATFORM',
  'REPORTING_GAPS',
] as const;
export type BusinessProblem = (typeof BUSINESS_PROBLEMS)[number];
const BUSINESS_PROBLEM_LABELS: LabelMap<BusinessProblem> = {
  SCALING_ENGINEERING_CAPACITY: 'Scaling engineering capacity',
  LEGACY_MODERNIZATION: 'Legacy modernization',
  DATA_FRAGMENTATION: 'Fragmented data landscape',
  COMPLIANCE_PRESSURE: 'Compliance pressure',
  SLOW_TIME_TO_MARKET: 'Slow time to market',
  COST_PRESSURE: 'Cost pressure',
  TALENT_SHORTAGE: 'Talent shortage',
  INTEGRATION_COMPLEXITY: 'Integration complexity',
  MANUAL_OPERATIONS: 'Manual operations',
  POOR_CUSTOMER_EXPERIENCE: 'Poor customer experience',
  SECURITY_GAPS: 'Security gaps',
  CLOUD_COST_OVERRUN: 'Cloud cost overrun',
  UNRELIABLE_PLATFORM: 'Unreliable platform',
  REPORTING_GAPS: 'Reporting gaps',
};
export const BUSINESS_PROBLEM_OPTIONS = toOptions(BUSINESS_PROBLEMS, BUSINESS_PROBLEM_LABELS);

/** Deterministic capacity/hiring gap markers from the plan's Need dimension. */
export const CAPACITY_GAP_INDICATORS = [
  'HIRING_GAP',
  'LONG_OPEN_ROLES',
  'BACKLOG_GROWTH',
  'DELIVERY_DELAYS',
  'HIGH_ATTRITION',
  'CONTRACTOR_DEPENDENCE',
] as const;
export type CapacityGapIndicator = (typeof CAPACITY_GAP_INDICATORS)[number];
const CAPACITY_GAP_INDICATOR_LABELS: LabelMap<CapacityGapIndicator> = {
  HIRING_GAP: 'Hiring gap',
  LONG_OPEN_ROLES: 'Roles open for a long time',
  BACKLOG_GROWTH: 'Growing backlog',
  DELIVERY_DELAYS: 'Delivery delays',
  HIGH_ATTRITION: 'High attrition',
  CONTRACTOR_DEPENDENCE: 'Contractor dependence',
};
export const CAPACITY_GAP_INDICATOR_OPTIONS = toOptions(
  CAPACITY_GAP_INDICATORS,
  CAPACITY_GAP_INDICATOR_LABELS,
);

export const COMPLIANCE_FRAMEWORKS = [
  'GDPR',
  'NIS2',
  'DORA',
  'ISO_27001',
  'SOC2',
  'HIPAA',
  'PCI_DSS',
  'EU_AI_ACT',
  'BIO',
  'MDR',
] as const;
export type ComplianceFramework = (typeof COMPLIANCE_FRAMEWORKS)[number];
const COMPLIANCE_FRAMEWORK_LABELS: LabelMap<ComplianceFramework> = {
  GDPR: 'GDPR',
  NIS2: 'NIS2',
  DORA: 'DORA',
  ISO_27001: 'ISO 27001',
  SOC2: 'SOC 2',
  HIPAA: 'HIPAA',
  PCI_DSS: 'PCI DSS',
  EU_AI_ACT: 'EU AI Act',
  BIO: 'BIO (Dutch government)',
  MDR: 'MDR (medical devices)',
};
export const COMPLIANCE_FRAMEWORK_OPTIONS = toOptions(COMPLIANCE_FRAMEWORKS, COMPLIANCE_FRAMEWORK_LABELS);
