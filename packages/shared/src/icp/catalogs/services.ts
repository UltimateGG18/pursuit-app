import { toOptions, type LabelMap } from '../../util/options.js';

export const SERVICE_OFFERINGS = [
  'CUSTOM_SOFTWARE_DEVELOPMENT',
  'PLATFORM_MODERNIZATION',
  'CLOUD_MIGRATION',
  'DATA_ENGINEERING',
  'ANALYTICS_BI',
  'AI_ENABLEMENT',
  'SYSTEM_INTEGRATION',
  'MANAGED_SERVICES',
  'STAFF_AUGMENTATION',
  'QA_TEST_AUTOMATION',
  'SECURITY_COMPLIANCE',
  'UX_PRODUCT_DESIGN',
] as const;
export type ServiceOffering = (typeof SERVICE_OFFERINGS)[number];
const SERVICE_OFFERING_LABELS: LabelMap<ServiceOffering> = {
  CUSTOM_SOFTWARE_DEVELOPMENT: 'Custom software development',
  PLATFORM_MODERNIZATION: 'Platform modernization',
  CLOUD_MIGRATION: 'Cloud migration',
  DATA_ENGINEERING: 'Data engineering',
  ANALYTICS_BI: 'Analytics & BI',
  AI_ENABLEMENT: 'AI enablement',
  SYSTEM_INTEGRATION: 'System integration',
  MANAGED_SERVICES: 'Managed services',
  STAFF_AUGMENTATION: 'Staff augmentation',
  QA_TEST_AUTOMATION: 'QA & test automation',
  SECURITY_COMPLIANCE: 'Security & compliance',
  UX_PRODUCT_DESIGN: 'UX & product design',
};
export const SERVICE_OFFERING_OPTIONS = toOptions(SERVICE_OFFERINGS, SERVICE_OFFERING_LABELS);

export const ENGAGEMENT_MODELS = [
  'FIXED_PRICE_PROJECT',
  'TIME_AND_MATERIALS',
  'DEDICATED_TEAM',
  'MANAGED_SERVICE',
  'RETAINER',
  'STAFF_AUGMENTATION',
] as const;
export type EngagementModel = (typeof ENGAGEMENT_MODELS)[number];
const ENGAGEMENT_MODEL_LABELS: LabelMap<EngagementModel> = {
  FIXED_PRICE_PROJECT: 'Fixed price project',
  TIME_AND_MATERIALS: 'Time & materials',
  DEDICATED_TEAM: 'Dedicated team',
  MANAGED_SERVICE: 'Managed service',
  RETAINER: 'Retainer',
  STAFF_AUGMENTATION: 'Staff augmentation',
};
export const ENGAGEMENT_MODEL_OPTIONS = toOptions(ENGAGEMENT_MODELS, ENGAGEMENT_MODEL_LABELS);

/** Opportunity dimension input: expected deal size category. */
export const DEAL_SIZE_BANDS = [
  'UNDER_50K',
  'FROM_50K_TO_150K',
  'FROM_150K_TO_500K',
  'FROM_500K_TO_1M',
  'ABOVE_1M',
] as const;
export type DealSizeBand = (typeof DEAL_SIZE_BANDS)[number];
const DEAL_SIZE_BAND_LABELS: LabelMap<DealSizeBand> = {
  UNDER_50K: '< 50k',
  FROM_50K_TO_150K: '50k - 150k',
  FROM_150K_TO_500K: '150k - 500k',
  FROM_500K_TO_1M: '500k - 1M',
  ABOVE_1M: '> 1M',
};
export const DEAL_SIZE_BAND_OPTIONS = toOptions(DEAL_SIZE_BANDS, DEAL_SIZE_BAND_LABELS);

/** Business Fit dimension input: how the account buys delivery capacity. */
export const OUTSOURCING_POSTURES = [
  'HEAVY_OUTSOURCER',
  'HYBRID',
  'MOSTLY_IN_HOUSE',
  'IN_HOUSE_ONLY',
  'UNKNOWN',
] as const;
export type OutsourcingPosture = (typeof OUTSOURCING_POSTURES)[number];
const OUTSOURCING_POSTURE_LABELS: LabelMap<OutsourcingPosture> = {
  HEAVY_OUTSOURCER: 'Heavy outsourcer',
  HYBRID: 'Hybrid',
  MOSTLY_IN_HOUSE: 'Mostly in-house',
  IN_HOUSE_ONLY: 'In-house only',
  UNKNOWN: 'Unknown',
};
export const OUTSOURCING_POSTURE_OPTIONS = toOptions(OUTSOURCING_POSTURES, OUTSOURCING_POSTURE_LABELS);

export const BUYING_INDICATORS = [
  'OUTSOURCING_HISTORY',
  'VENDOR_CONSOLIDATION',
  'PUBLIC_RFP_ACTIVITY',
  'FRAMEWORK_AGREEMENTS',
  'PARTNER_ECOSYSTEM',
  'DIGITAL_TRANSFORMATION_BUDGET',
  'RECENT_VENDOR_CHANGE',
] as const;
export type BuyingIndicator = (typeof BUYING_INDICATORS)[number];
const BUYING_INDICATOR_LABELS: LabelMap<BuyingIndicator> = {
  OUTSOURCING_HISTORY: 'History of outsourcing',
  VENDOR_CONSOLIDATION: 'Vendor consolidation',
  PUBLIC_RFP_ACTIVITY: 'Public RFP activity',
  FRAMEWORK_AGREEMENTS: 'Framework agreements',
  PARTNER_ECOSYSTEM: 'Active partner ecosystem',
  DIGITAL_TRANSFORMATION_BUDGET: 'Digital transformation budget',
  RECENT_VENDOR_CHANGE: 'Recent vendor change',
};
export const BUYING_INDICATOR_OPTIONS = toOptions(BUYING_INDICATORS, BUYING_INDICATOR_LABELS);
