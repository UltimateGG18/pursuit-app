import { toOptions, type LabelMap } from '../../util/options.js';

export const TECHNOLOGIES = [
  'DOTNET',
  'JAVA',
  'NODEJS',
  'PYTHON',
  'PHP',
  'GO',
  'REACT',
  'ANGULAR',
  'VUE',
  'SAP',
  'DYNAMICS_365',
  'SALESFORCE',
  'ORACLE_EBS',
  'SHAREPOINT',
  'KUBERNETES',
  'DOCKER',
  'TERRAFORM',
  'SNOWFLAKE',
  'DATABRICKS',
  'POWER_BI',
  'KAFKA',
  'MULESOFT',
  'MENDIX',
  'OUTSYSTEMS',
  'AS400',
  'COBOL',
  'DELPHI',
  'VISUAL_BASIC',
  'SQL_SERVER',
  'ORACLE_DB',
  'POSTGRESQL',
  'MONGODB',
] as const;
export type Technology = (typeof TECHNOLOGIES)[number];
const TECHNOLOGY_LABELS: LabelMap<Technology> = {
  DOTNET: '.NET',
  JAVA: 'Java',
  NODEJS: 'Node.js',
  PYTHON: 'Python',
  PHP: 'PHP',
  GO: 'Go',
  REACT: 'React',
  ANGULAR: 'Angular',
  VUE: 'Vue',
  SAP: 'SAP',
  DYNAMICS_365: 'Microsoft Dynamics 365',
  SALESFORCE: 'Salesforce',
  ORACLE_EBS: 'Oracle E-Business Suite',
  SHAREPOINT: 'SharePoint',
  KUBERNETES: 'Kubernetes',
  DOCKER: 'Docker',
  TERRAFORM: 'Terraform',
  SNOWFLAKE: 'Snowflake',
  DATABRICKS: 'Databricks',
  POWER_BI: 'Power BI',
  KAFKA: 'Apache Kafka',
  MULESOFT: 'MuleSoft',
  MENDIX: 'Mendix',
  OUTSYSTEMS: 'OutSystems',
  AS400: 'IBM AS/400',
  COBOL: 'COBOL',
  DELPHI: 'Delphi',
  VISUAL_BASIC: 'Visual Basic',
  SQL_SERVER: 'SQL Server',
  ORACLE_DB: 'Oracle Database',
  POSTGRESQL: 'PostgreSQL',
  MONGODB: 'MongoDB',
};
export const TECHNOLOGY_OPTIONS = toOptions(TECHNOLOGIES, TECHNOLOGY_LABELS);

export const TECHNOLOGY_MATURITIES = [
  'LEGACY_ON_PREMISE',
  'HYBRID',
  'CLOUD_FIRST',
  'CLOUD_NATIVE',
  'DATA_DRIVEN',
] as const;
export type TechnologyMaturity = (typeof TECHNOLOGY_MATURITIES)[number];
const TECHNOLOGY_MATURITY_LABELS: LabelMap<TechnologyMaturity> = {
  LEGACY_ON_PREMISE: 'Legacy / on-premise',
  HYBRID: 'Hybrid',
  CLOUD_FIRST: 'Cloud first',
  CLOUD_NATIVE: 'Cloud native',
  DATA_DRIVEN: 'Data driven',
};
export const TECHNOLOGY_MATURITY_OPTIONS = toOptions(TECHNOLOGY_MATURITIES, TECHNOLOGY_MATURITY_LABELS);

export const CLOUD_PROVIDERS = [
  'AWS',
  'AZURE',
  'GCP',
  'ORACLE_CLOUD',
  'IBM_CLOUD',
  'PRIVATE_CLOUD',
  'ON_PREMISE',
] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
const CLOUD_PROVIDER_LABELS: LabelMap<CloudProvider> = {
  AWS: 'AWS',
  AZURE: 'Microsoft Azure',
  GCP: 'Google Cloud',
  ORACLE_CLOUD: 'Oracle Cloud',
  IBM_CLOUD: 'IBM Cloud',
  PRIVATE_CLOUD: 'Private cloud',
  ON_PREMISE: 'On-premise',
};
export const CLOUD_PROVIDER_OPTIONS = toOptions(CLOUD_PROVIDERS, CLOUD_PROVIDER_LABELS);

/** Structural "legacy" markers used by the deterministic Need dimension. */
export const LEGACY_INDICATORS = [
  'END_OF_LIFE_STACK',
  'LEGACY_ERP',
  'MONOLITHIC_ARCHITECTURE',
  'ON_PREMISE_ONLY',
  'UNSUPPORTED_DATABASE',
  'MANUAL_PROCESSES',
  'NO_CI_CD',
  'CUSTOM_LEGACY_PORTAL',
] as const;
export type LegacyIndicator = (typeof LEGACY_INDICATORS)[number];
const LEGACY_INDICATOR_LABELS: LabelMap<LegacyIndicator> = {
  END_OF_LIFE_STACK: 'End-of-life stack',
  LEGACY_ERP: 'Legacy ERP',
  MONOLITHIC_ARCHITECTURE: 'Monolithic architecture',
  ON_PREMISE_ONLY: 'On-premise only',
  UNSUPPORTED_DATABASE: 'Unsupported database',
  MANUAL_PROCESSES: 'Manual processes',
  NO_CI_CD: 'No CI/CD',
  CUSTOM_LEGACY_PORTAL: 'Custom legacy portal',
};
export const LEGACY_INDICATOR_OPTIONS = toOptions(LEGACY_INDICATORS, LEGACY_INDICATOR_LABELS);
