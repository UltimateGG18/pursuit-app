import { toOptions, type LabelMap } from '../../util/options.js';

/** Intent/trigger catalog. Mirrors the plan's Intent dimension inputs. */
export const TRIGGER_TYPES = [
  'RECENT_HIRING',
  'FUNDING_ROUND',
  'GEOGRAPHIC_EXPANSION',
  'PRODUCT_LAUNCH',
  'TECHNOLOGY_MIGRATION',
  'LEADERSHIP_CHANGE',
  'STRATEGIC_INITIATIVE',
  'MERGER_ACQUISITION',
  'OFFICE_OPENING',
  'REGULATORY_DEADLINE',
  'VENDOR_CHANGE',
  'RFP_PUBLISHED',
  'CERTIFICATION_OBTAINED',
  'LAYOFFS',
  'NEGATIVE_PRESS',
  'INSOLVENCY_RISK',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];
const TRIGGER_TYPE_LABELS: LabelMap<TriggerType> = {
  RECENT_HIRING: 'Recent hiring',
  FUNDING_ROUND: 'Funding round',
  GEOGRAPHIC_EXPANSION: 'Geographic expansion',
  PRODUCT_LAUNCH: 'Product launch',
  TECHNOLOGY_MIGRATION: 'Technology migration',
  LEADERSHIP_CHANGE: 'Leadership change',
  STRATEGIC_INITIATIVE: 'Strategic initiative',
  MERGER_ACQUISITION: 'Merger or acquisition',
  OFFICE_OPENING: 'Office opening',
  REGULATORY_DEADLINE: 'Regulatory deadline',
  VENDOR_CHANGE: 'Vendor change',
  RFP_PUBLISHED: 'RFP published',
  CERTIFICATION_OBTAINED: 'Certification obtained',
  LAYOFFS: 'Layoffs',
  NEGATIVE_PRESS: 'Negative press',
  INSOLVENCY_RISK: 'Insolvency risk',
};
export const TRIGGER_TYPE_OPTIONS = toOptions(TRIGGER_TYPES, TRIGGER_TYPE_LABELS);

export const SIGNAL_POLARITIES = ['POSITIVE', 'NEGATIVE'] as const;
export type SignalPolarity = (typeof SIGNAL_POLARITIES)[number];
const SIGNAL_POLARITY_LABELS: LabelMap<SignalPolarity> = {
  POSITIVE: 'Positive',
  NEGATIVE: 'Negative',
};
export const SIGNAL_POLARITY_OPTIONS = toOptions(SIGNAL_POLARITIES, SIGNAL_POLARITY_LABELS);

/**
 * Decay classes from the plan: transient intent decays quickly, structural
 * facts must be tagged so they are not aged out like news.
 */
export const SIGNAL_DECAY_CLASSES = ['TRANSIENT', 'SEASONAL', 'STRUCTURAL'] as const;
export type SignalDecayClass = (typeof SIGNAL_DECAY_CLASSES)[number];
const SIGNAL_DECAY_CLASS_LABELS: LabelMap<SignalDecayClass> = {
  TRANSIENT: 'Transient (decays fast)',
  SEASONAL: 'Seasonal',
  STRUCTURAL: 'Structural (does not decay)',
};
export const SIGNAL_DECAY_CLASS_OPTIONS = toOptions(SIGNAL_DECAY_CLASSES, SIGNAL_DECAY_CLASS_LABELS);

export const TRIGGER_RELEVANCE_MIN = 1;
export const TRIGGER_RELEVANCE_MAX = 10;
export const TRIGGER_LOOKBACK_DAYS_MIN = 7;
export const TRIGGER_LOOKBACK_DAYS_MAX = 1095;
