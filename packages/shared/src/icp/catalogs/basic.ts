import { toOptions, type LabelMap } from '../../util/options.js';

export const ICP_OBJECTIVES = [
  'NEW_LOGO_ACQUISITION',
  'MARKET_ENTRY',
  'EXPANSION_EXISTING_ACCOUNTS',
  'PARTNER_SOURCING',
  'REACTIVATION',
] as const;
export type IcpObjective = (typeof ICP_OBJECTIVES)[number];
const ICP_OBJECTIVE_LABELS: LabelMap<IcpObjective> = {
  NEW_LOGO_ACQUISITION: 'New logo acquisition',
  MARKET_ENTRY: 'Market entry',
  EXPANSION_EXISTING_ACCOUNTS: 'Expansion in existing accounts',
  PARTNER_SOURCING: 'Partner sourcing',
  REACTIVATION: 'Reactivation of dormant accounts',
};
export const ICP_OBJECTIVE_OPTIONS = toOptions(ICP_OBJECTIVES, ICP_OBJECTIVE_LABELS);

export const ICP_PRIORITIES = ['P0', 'P1', 'P2'] as const;
export type IcpPriority = (typeof ICP_PRIORITIES)[number];
const ICP_PRIORITY_LABELS: LabelMap<IcpPriority> = {
  P0: 'P0 - primary ICP',
  P1: 'P1 - secondary ICP',
  P2: 'P2 - exploratory ICP',
};
export const ICP_PRIORITY_OPTIONS = toOptions(ICP_PRIORITIES, ICP_PRIORITY_LABELS);

export const LANGUAGES = [
  'NL',
  'EN',
  'DE',
  'FR',
  'ES',
  'IT',
  'PT',
  'DA',
  'SV',
  'NO',
  'FI',
  'PL',
] as const;
export type Language = (typeof LANGUAGES)[number];
const LANGUAGE_LABELS: LabelMap<Language> = {
  NL: 'Dutch',
  EN: 'English',
  DE: 'German',
  FR: 'French',
  ES: 'Spanish',
  IT: 'Italian',
  PT: 'Portuguese',
  DA: 'Danish',
  SV: 'Swedish',
  NO: 'Norwegian',
  FI: 'Finnish',
  PL: 'Polish',
};
export const LANGUAGE_OPTIONS = toOptions(LANGUAGES, LANGUAGE_LABELS);

/** Lifecycle status of a stored ICP profile. */
export const ICP_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type IcpStatus = (typeof ICP_STATUSES)[number];
const ICP_STATUS_LABELS: LabelMap<IcpStatus> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
};
export const ICP_STATUS_OPTIONS = toOptions(ICP_STATUSES, ICP_STATUS_LABELS);
