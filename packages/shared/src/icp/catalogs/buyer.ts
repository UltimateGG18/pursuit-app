import { toOptions, type LabelMap } from '../../util/options.js';

export const SENIORITIES = ['C_LEVEL', 'VP', 'DIRECTOR', 'HEAD', 'MANAGER', 'LEAD', 'INDIVIDUAL_CONTRIBUTOR'] as const;
export type Seniority = (typeof SENIORITIES)[number];
const SENIORITY_LABELS: LabelMap<Seniority> = {
  C_LEVEL: 'C-level',
  VP: 'VP',
  DIRECTOR: 'Director',
  HEAD: 'Head of',
  MANAGER: 'Manager',
  LEAD: 'Lead',
  INDIVIDUAL_CONTRIBUTOR: 'Individual contributor',
};
export const SENIORITY_OPTIONS = toOptions(SENIORITIES, SENIORITY_LABELS);

export const DEPARTMENTS = [
  'EXECUTIVE',
  'ENGINEERING',
  'IT',
  'PRODUCT',
  'DATA',
  'OPERATIONS',
  'FINANCE',
  'PROCUREMENT',
  'MARKETING',
  'SALES',
  'HR',
  'LEGAL_COMPLIANCE',
] as const;
export type Department = (typeof DEPARTMENTS)[number];
const DEPARTMENT_LABELS: LabelMap<Department> = {
  EXECUTIVE: 'Executive',
  ENGINEERING: 'Engineering',
  IT: 'IT',
  PRODUCT: 'Product',
  DATA: 'Data',
  OPERATIONS: 'Operations',
  FINANCE: 'Finance',
  PROCUREMENT: 'Procurement',
  MARKETING: 'Marketing',
  SALES: 'Sales',
  HR: 'HR',
  LEGAL_COMPLIANCE: 'Legal & compliance',
};
export const DEPARTMENT_OPTIONS = toOptions(DEPARTMENTS, DEPARTMENT_LABELS);

/** Curated job titles - kept as a controlled list instead of free-text keywords. */
export const TARGET_TITLES = [
  'CTO',
  'CIO',
  'CDO',
  'CEO',
  'COO',
  'CFO',
  'CISO',
  'VP_ENGINEERING',
  'VP_PRODUCT',
  'VP_IT',
  'DIRECTOR_OF_ENGINEERING',
  'DIRECTOR_OF_IT',
  'HEAD_OF_DATA',
  'HEAD_OF_PLATFORM',
  'HEAD_OF_DIGITAL',
  'IT_MANAGER',
  'ENGINEERING_MANAGER',
  'PRODUCT_OWNER',
  'ENTERPRISE_ARCHITECT',
  'SOLUTION_ARCHITECT',
  'PROCUREMENT_MANAGER',
  'TRANSFORMATION_LEAD',
] as const;
export type TargetTitle = (typeof TARGET_TITLES)[number];
const TARGET_TITLE_LABELS: LabelMap<TargetTitle> = {
  CTO: 'CTO',
  CIO: 'CIO',
  CDO: 'CDO',
  CEO: 'CEO',
  COO: 'COO',
  CFO: 'CFO',
  CISO: 'CISO',
  VP_ENGINEERING: 'VP Engineering',
  VP_PRODUCT: 'VP Product',
  VP_IT: 'VP IT',
  DIRECTOR_OF_ENGINEERING: 'Director of Engineering',
  DIRECTOR_OF_IT: 'Director of IT',
  HEAD_OF_DATA: 'Head of Data',
  HEAD_OF_PLATFORM: 'Head of Platform',
  HEAD_OF_DIGITAL: 'Head of Digital',
  IT_MANAGER: 'IT Manager',
  ENGINEERING_MANAGER: 'Engineering Manager',
  PRODUCT_OWNER: 'Product Owner',
  ENTERPRISE_ARCHITECT: 'Enterprise Architect',
  SOLUTION_ARCHITECT: 'Solution Architect',
  PROCUREMENT_MANAGER: 'Procurement Manager',
  TRANSFORMATION_LEAD: 'Transformation Lead',
};
export const TARGET_TITLE_OPTIONS = toOptions(TARGET_TITLES, TARGET_TITLE_LABELS);

export const BUYER_ROLES = [
  'DECISION_MAKER',
  'ECONOMIC_BUYER',
  'TECHNICAL_EVALUATOR',
  'INFLUENCER',
  'CHAMPION',
  'GATEKEEPER',
] as const;
export type BuyerRole = (typeof BUYER_ROLES)[number];
const BUYER_ROLE_LABELS: LabelMap<BuyerRole> = {
  DECISION_MAKER: 'Decision maker',
  ECONOMIC_BUYER: 'Economic buyer',
  TECHNICAL_EVALUATOR: 'Technical evaluator',
  INFLUENCER: 'Influencer',
  CHAMPION: 'Champion',
  GATEKEEPER: 'Gatekeeper',
};
export const BUYER_ROLE_OPTIONS = toOptions(BUYER_ROLES, BUYER_ROLE_LABELS);

/** Opportunity dimension input: reachable decision maker requirement. */
export const REACHABILITY_REQUIREMENTS = [
  'DECISION_MAKER_REQUIRED',
  'INFLUENCER_ACCEPTED',
  'ANY_CONTACT',
  'NOT_REQUIRED',
] as const;
export type ReachabilityRequirement = (typeof REACHABILITY_REQUIREMENTS)[number];
const REACHABILITY_REQUIREMENT_LABELS: LabelMap<ReachabilityRequirement> = {
  DECISION_MAKER_REQUIRED: 'Decision maker required',
  INFLUENCER_ACCEPTED: 'Influencer accepted',
  ANY_CONTACT: 'Any reachable contact',
  NOT_REQUIRED: 'Not required',
};
export const REACHABILITY_REQUIREMENT_OPTIONS = toOptions(
  REACHABILITY_REQUIREMENTS,
  REACHABILITY_REQUIREMENT_LABELS,
);

export const MIN_CONTACTS_PER_ACCOUNT_MIN = 0;
export const MIN_CONTACTS_PER_ACCOUNT_MAX = 25;
