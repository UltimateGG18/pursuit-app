import { toOptions, type LabelMap } from '../../util/options.js';

export const INDUSTRIES = [
  'SOFTWARE_SAAS',
  'IT_SERVICES',
  'FINANCIAL_SERVICES',
  'INSURANCE',
  'HEALTHCARE',
  'LIFE_SCIENCES',
  'MANUFACTURING',
  'AUTOMOTIVE',
  'ENERGY_UTILITIES',
  'LOGISTICS_TRANSPORT',
  'RETAIL_ECOMMERCE',
  'WHOLESALE_DISTRIBUTION',
  'CONSTRUCTION_REAL_ESTATE',
  'TELECOM_MEDIA',
  'PUBLIC_SECTOR',
  'EDUCATION',
  'AGRIFOOD',
  'PROFESSIONAL_SERVICES',
  'HOSPITALITY_LEISURE',
  'NONPROFIT',
] as const;
export type Industry = (typeof INDUSTRIES)[number];
const INDUSTRY_LABELS: LabelMap<Industry> = {
  SOFTWARE_SAAS: 'Software & SaaS',
  IT_SERVICES: 'IT services',
  FINANCIAL_SERVICES: 'Financial services',
  INSURANCE: 'Insurance',
  HEALTHCARE: 'Healthcare',
  LIFE_SCIENCES: 'Life sciences & pharma',
  MANUFACTURING: 'Manufacturing',
  AUTOMOTIVE: 'Automotive',
  ENERGY_UTILITIES: 'Energy & utilities',
  LOGISTICS_TRANSPORT: 'Logistics & transport',
  RETAIL_ECOMMERCE: 'Retail & e-commerce',
  WHOLESALE_DISTRIBUTION: 'Wholesale & distribution',
  CONSTRUCTION_REAL_ESTATE: 'Construction & real estate',
  TELECOM_MEDIA: 'Telecom & media',
  PUBLIC_SECTOR: 'Public sector',
  EDUCATION: 'Education',
  AGRIFOOD: 'Agrifood',
  PROFESSIONAL_SERVICES: 'Professional services',
  HOSPITALITY_LEISURE: 'Hospitality & leisure',
  NONPROFIT: 'Non-profit',
};
export const INDUSTRY_OPTIONS = toOptions(INDUSTRIES, INDUSTRY_LABELS);

export const COMPANY_TYPES = [
  'PRIVATE',
  'PUBLIC',
  'PE_BACKED',
  'VC_BACKED',
  'FAMILY_OWNED',
  'SUBSIDIARY',
  'GOVERNMENT',
  'NONPROFIT',
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];
const COMPANY_TYPE_LABELS: LabelMap<CompanyType> = {
  PRIVATE: 'Private',
  PUBLIC: 'Publicly listed',
  PE_BACKED: 'PE backed',
  VC_BACKED: 'VC backed',
  FAMILY_OWNED: 'Family owned',
  SUBSIDIARY: 'Subsidiary',
  GOVERNMENT: 'Government',
  NONPROFIT: 'Non-profit',
};
export const COMPANY_TYPE_OPTIONS = toOptions(COMPANY_TYPES, COMPANY_TYPE_LABELS);

export const BUSINESS_MODELS = [
  'B2B_SAAS',
  'B2B_SERVICES',
  'B2C',
  'B2B2C',
  'MARKETPLACE',
  'MANUFACTURING',
  'RETAIL',
  'LOGISTICS',
  'FINANCIAL_SERVICES',
  'HEALTHCARE_PROVIDER',
  'PUBLIC_SERVICE',
] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];
const BUSINESS_MODEL_LABELS: LabelMap<BusinessModel> = {
  B2B_SAAS: 'B2B SaaS',
  B2B_SERVICES: 'B2B services',
  B2C: 'B2C',
  B2B2C: 'B2B2C',
  MARKETPLACE: 'Marketplace',
  MANUFACTURING: 'Manufacturing',
  RETAIL: 'Retail',
  LOGISTICS: 'Logistics',
  FINANCIAL_SERVICES: 'Financial services',
  HEALTHCARE_PROVIDER: 'Healthcare provider',
  PUBLIC_SERVICE: 'Public service',
};
export const BUSINESS_MODEL_OPTIONS = toOptions(BUSINESS_MODELS, BUSINESS_MODEL_LABELS);

export const MATURITY_STAGES = ['STARTUP', 'GROWTH', 'SCALE_UP', 'ESTABLISHED', 'ENTERPRISE'] as const;
export type MaturityStage = (typeof MATURITY_STAGES)[number];
const MATURITY_STAGE_LABELS: LabelMap<MaturityStage> = {
  STARTUP: 'Startup',
  GROWTH: 'Growth',
  SCALE_UP: 'Scale-up',
  ESTABLISHED: 'Established',
  ENTERPRISE: 'Enterprise',
};
export const MATURITY_STAGE_OPTIONS = toOptions(MATURITY_STAGES, MATURITY_STAGE_LABELS);

export const CURRENCIES = ['EUR', 'USD', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];
const CURRENCY_LABELS: LabelMap<Currency> = {
  EUR: 'EUR',
  USD: 'USD',
  GBP: 'GBP',
};
export const CURRENCY_OPTIONS = toOptions(CURRENCIES, CURRENCY_LABELS);
