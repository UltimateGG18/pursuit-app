import { toOptions, type LabelMap } from '../../util/options.js';

/** Discovery strategies from section 5 of the implementation plan. */
export const DISCOVERY_STRATEGIES = [
  'FIRMOGRAPHIC',
  'SIGNAL_FIRST',
  'SEMANTIC',
  'LOOK_ALIKE',
  'RELATIONSHIP',
  'INBOUND',
] as const;
export type DiscoveryStrategy = (typeof DISCOVERY_STRATEGIES)[number];
const DISCOVERY_STRATEGY_LABELS: LabelMap<DiscoveryStrategy> = {
  FIRMOGRAPHIC: 'Firmographic (P0)',
  SIGNAL_FIRST: 'Signal first (P1)',
  SEMANTIC: 'Semantic / description match (P1)',
  LOOK_ALIKE: 'Look-alike (P2)',
  RELATIONSHIP: 'Relationship (P2)',
  INBOUND: 'Inbound / engagement (P2)',
};
export const DISCOVERY_STRATEGY_OPTIONS = toOptions(DISCOVERY_STRATEGIES, DISCOVERY_STRATEGY_LABELS);

export const SOURCE_TYPES = [
  'COMPANY_WEBSITE',
  'JOB_POSTING',
  'NEWS_ARTICLE',
  'PRESS_RELEASE',
  'FUNDING_DATABASE',
  'TECHNOLOGY_DETECTION',
  'REGISTRY_FILING',
  'SOCIAL_POST',
  'REVIEW_SITE',
  'PARTNER_DIRECTORY',
  'TENDER_PORTAL',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
const SOURCE_TYPE_LABELS: LabelMap<SourceType> = {
  COMPANY_WEBSITE: 'Company website',
  JOB_POSTING: 'Job posting',
  NEWS_ARTICLE: 'News article',
  PRESS_RELEASE: 'Press release',
  FUNDING_DATABASE: 'Funding database',
  TECHNOLOGY_DETECTION: 'Technology detection',
  REGISTRY_FILING: 'Registry filing',
  SOCIAL_POST: 'Social post',
  REVIEW_SITE: 'Review site',
  PARTNER_DIRECTORY: 'Partner directory',
  TENDER_PORTAL: 'Tender portal',
};
export const SOURCE_TYPE_OPTIONS = toOptions(SOURCE_TYPES, SOURCE_TYPE_LABELS);

/** Evidence reliability floor. Maps onto the plan's source reliability score. */
export const SOURCE_RELIABILITIES = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;
export type SourceReliability = (typeof SOURCE_RELIABILITIES)[number];
const SOURCE_RELIABILITY_LABELS: LabelMap<SourceReliability> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  VERY_HIGH: 'Very high',
};
export const SOURCE_RELIABILITY_OPTIONS = toOptions(SOURCE_RELIABILITIES, SOURCE_RELIABILITY_LABELS);

/** How directly a source supports a claim. */
export const EVIDENCE_DIRECTNESS_LEVELS = ['DIRECT', 'INDIRECT', 'INFERRED'] as const;
export type EvidenceDirectness = (typeof EVIDENCE_DIRECTNESS_LEVELS)[number];
const EVIDENCE_DIRECTNESS_LABELS: LabelMap<EvidenceDirectness> = {
  DIRECT: 'Direct statement by the company',
  INDIRECT: 'Indirect / third party',
  INFERRED: 'Inferred from related facts',
};
export const EVIDENCE_DIRECTNESS_OPTIONS = toOptions(
  EVIDENCE_DIRECTNESS_LEVELS,
  EVIDENCE_DIRECTNESS_LABELS,
);

export const EVIDENCE_FRESHNESS_DAYS_MIN = 30;
export const EVIDENCE_FRESHNESS_DAYS_MAX = 730;
export const CORROBORATION_MIN = 1;
export const CORROBORATION_MAX = 5;
export const KEYWORD_GROUP_TERM_MAX = 40;
