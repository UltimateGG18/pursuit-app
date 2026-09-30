import type { SelectOption } from '../util/options.js';
import { toOptions, type LabelMap } from '../util/options.js';
import { COUNTRY_OPTIONS, REGION_OPTIONS } from './catalogs/geography.js';
import {
  BUSINESS_MODEL_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  INDUSTRY_OPTIONS,
  MATURITY_STAGE_OPTIONS,
} from './catalogs/company.js';
import { LANGUAGE_OPTIONS } from './catalogs/basic.js';
import {
  CLOUD_PROVIDER_OPTIONS,
  LEGACY_INDICATOR_OPTIONS,
  TECHNOLOGY_MATURITY_OPTIONS,
  TECHNOLOGY_OPTIONS,
} from './catalogs/technology.js';
import { BUSINESS_PROBLEM_OPTIONS, COMPLIANCE_FRAMEWORK_OPTIONS } from './catalogs/problems.js';
import { SIGNAL_POLARITY_OPTIONS, TRIGGER_TYPE_OPTIONS } from './catalogs/signals.js';
import { SOURCE_RELIABILITY_OPTIONS, SOURCE_TYPE_OPTIONS } from './catalogs/evidence.js';
import { DEPARTMENT_OPTIONS, SENIORITY_OPTIONS, TARGET_TITLE_OPTIONS } from './catalogs/buyer.js';

/** Value shape a rule field accepts. Drives both the rule builder UI and validation. */
export const RULE_VALUE_TYPES = ['ENUM', 'NUMBER', 'TEXT', 'BOOLEAN'] as const;
export type RuleValueType = (typeof RULE_VALUE_TYPES)[number];

export const RULE_OPERATORS = [
  'EQUALS',
  'NOT_EQUALS',
  'IN',
  'NOT_IN',
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL',
  'BETWEEN',
  'CONTAINS',
  'NOT_CONTAINS',
  'EXISTS',
  'NOT_EXISTS',
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

const RULE_OPERATOR_LABELS: LabelMap<RuleOperator> = {
  EQUALS: 'equals',
  NOT_EQUALS: 'does not equal',
  IN: 'is any of',
  NOT_IN: 'is none of',
  GREATER_THAN: 'is greater than',
  GREATER_THAN_OR_EQUAL: 'is at least',
  LESS_THAN: 'is less than',
  LESS_THAN_OR_EQUAL: 'is at most',
  BETWEEN: 'is between',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'does not contain',
  EXISTS: 'is known',
  NOT_EXISTS: 'is unknown',
};
export const RULE_OPERATOR_OPTIONS = toOptions(RULE_OPERATORS, RULE_OPERATOR_LABELS);

export function ruleOperatorLabel(operator: RuleOperator): string {
  return RULE_OPERATOR_LABELS[operator];
}

/** Which value slot an operator uses. `NONE` operators must not carry a value at all. */
export const RULE_OPERAND_KINDS = ['SINGLE', 'LIST', 'RANGE', 'NONE'] as const;
export type RuleOperandKind = (typeof RULE_OPERAND_KINDS)[number];

const OPERATOR_OPERAND_KIND: Readonly<Record<RuleOperator, RuleOperandKind>> = {
  EQUALS: 'SINGLE',
  NOT_EQUALS: 'SINGLE',
  IN: 'LIST',
  NOT_IN: 'LIST',
  GREATER_THAN: 'SINGLE',
  GREATER_THAN_OR_EQUAL: 'SINGLE',
  LESS_THAN: 'SINGLE',
  LESS_THAN_OR_EQUAL: 'SINGLE',
  BETWEEN: 'RANGE',
  CONTAINS: 'SINGLE',
  NOT_CONTAINS: 'SINGLE',
  EXISTS: 'NONE',
  NOT_EXISTS: 'NONE',
};

export function operandKindForOperator(operator: RuleOperator): RuleOperandKind {
  return OPERATOR_OPERAND_KIND[operator];
}

const OPERATORS_BY_VALUE_TYPE: Readonly<Record<RuleValueType, readonly RuleOperator[]>> = {
  ENUM: ['EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'EXISTS', 'NOT_EXISTS'],
  NUMBER: [
    'EQUALS',
    'NOT_EQUALS',
    'GREATER_THAN',
    'GREATER_THAN_OR_EQUAL',
    'LESS_THAN',
    'LESS_THAN_OR_EQUAL',
    'BETWEEN',
    'EXISTS',
    'NOT_EXISTS',
  ],
  TEXT: ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'EXISTS', 'NOT_EXISTS'],
  BOOLEAN: ['EQUALS', 'NOT_EQUALS', 'EXISTS', 'NOT_EXISTS'],
};

/**
 * How a rule behaves when the underlying company data is missing. The plan
 * requires missing data to be UNKNOWN rather than an automatic reject, so
 * TREAT_AS_UNKNOWN is the default for every rule.
 */
export const UNKNOWN_HANDLINGS = ['TREAT_AS_UNKNOWN', 'TREAT_AS_FAIL', 'TREAT_AS_PASS'] as const;
export type UnknownHandling = (typeof UNKNOWN_HANDLINGS)[number];
const UNKNOWN_HANDLING_LABELS: LabelMap<UnknownHandling> = {
  TREAT_AS_UNKNOWN: 'Treat as unknown (keep candidate)',
  TREAT_AS_FAIL: 'Treat as failed',
  TREAT_AS_PASS: 'Treat as passed',
};
export const UNKNOWN_HANDLING_OPTIONS = toOptions(UNKNOWN_HANDLINGS, UNKNOWN_HANDLING_LABELS);

export const RULE_FIELDS = [
  'company.country',
  'company.region',
  'company.industry',
  'company.companyType',
  'company.businessModel',
  'company.maturityStage',
  'company.employeeCount',
  'company.annualRevenue',
  'company.foundedYear',
  'company.language',
  'company.domain',
  'company.description',
  'company.hasWebsite',
  'technology.stack',
  'technology.cloudProvider',
  'technology.maturity',
  'technology.legacyIndicator',
  'problem.type',
  'problem.complianceFramework',
  'signal.type',
  'signal.polarity',
  'signal.ageDays',
  'evidence.sourceType',
  'evidence.reliability',
  'evidence.ageDays',
  'buyer.seniority',
  'buyer.department',
  'buyer.title',
  'buyer.contactCount',
  'account.isExistingCustomer',
  'account.hasOpenDeal',
  'account.doNotContact',
  'account.inActiveSequence',
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export interface RuleFieldDefinition {
  readonly field: RuleField;
  readonly label: string;
  readonly group: string;
  readonly valueType: RuleValueType;
  /** Present for ENUM fields; a rule value must be one of these option values. */
  readonly options?: readonly SelectOption[];
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
}

function enumField(
  field: RuleField,
  label: string,
  group: string,
  options: readonly SelectOption[],
): RuleFieldDefinition {
  return { field, label, group, valueType: 'ENUM', options };
}

function numberField(
  field: RuleField,
  label: string,
  group: string,
  bounds: { min: number; max: number; unit?: string },
): RuleFieldDefinition {
  return {
    field,
    label,
    group,
    valueType: 'NUMBER',
    min: bounds.min,
    max: bounds.max,
    ...(bounds.unit ? { unit: bounds.unit } : {}),
  };
}

function textField(field: RuleField, label: string, group: string): RuleFieldDefinition {
  return { field, label, group, valueType: 'TEXT' };
}

function booleanField(field: RuleField, label: string, group: string): RuleFieldDefinition {
  return { field, label, group, valueType: 'BOOLEAN' };
}

export const RULE_FIELD_DEFINITIONS: Readonly<Record<RuleField, RuleFieldDefinition>> = {
  'company.country': enumField('company.country', 'Country', 'Company', COUNTRY_OPTIONS),
  'company.region': enumField('company.region', 'Region', 'Company', REGION_OPTIONS),
  'company.industry': enumField('company.industry', 'Industry', 'Company', INDUSTRY_OPTIONS),
  'company.companyType': enumField(
    'company.companyType',
    'Company type',
    'Company',
    COMPANY_TYPE_OPTIONS,
  ),
  'company.businessModel': enumField(
    'company.businessModel',
    'Business model',
    'Company',
    BUSINESS_MODEL_OPTIONS,
  ),
  'company.maturityStage': enumField(
    'company.maturityStage',
    'Maturity stage',
    'Company',
    MATURITY_STAGE_OPTIONS,
  ),
  'company.employeeCount': numberField('company.employeeCount', 'Employee count', 'Company', {
    min: 0,
    max: 1000000,
    unit: 'employees',
  }),
  'company.annualRevenue': numberField('company.annualRevenue', 'Annual revenue', 'Company', {
    min: 0,
    max: 100000000000,
    unit: 'currency units',
  }),
  'company.foundedYear': numberField('company.foundedYear', 'Founded year', 'Company', {
    min: 1800,
    max: 2100,
  }),
  'company.language': enumField('company.language', 'Primary language', 'Company', LANGUAGE_OPTIONS),
  'company.domain': textField('company.domain', 'Domain', 'Company'),
  'company.description': textField('company.description', 'Company description', 'Company'),
  'company.hasWebsite': booleanField('company.hasWebsite', 'Has website', 'Company'),
  'technology.stack': enumField(
    'technology.stack',
    'Technology in stack',
    'Technology',
    TECHNOLOGY_OPTIONS,
  ),
  'technology.cloudProvider': enumField(
    'technology.cloudProvider',
    'Cloud provider',
    'Technology',
    CLOUD_PROVIDER_OPTIONS,
  ),
  'technology.maturity': enumField(
    'technology.maturity',
    'Technology maturity',
    'Technology',
    TECHNOLOGY_MATURITY_OPTIONS,
  ),
  'technology.legacyIndicator': enumField(
    'technology.legacyIndicator',
    'Legacy indicator',
    'Technology',
    LEGACY_INDICATOR_OPTIONS,
  ),
  'problem.type': enumField('problem.type', 'Business problem', 'Problems', BUSINESS_PROBLEM_OPTIONS),
  'problem.complianceFramework': enumField(
    'problem.complianceFramework',
    'Compliance framework',
    'Problems',
    COMPLIANCE_FRAMEWORK_OPTIONS,
  ),
  'signal.type': enumField('signal.type', 'Signal type', 'Signals', TRIGGER_TYPE_OPTIONS),
  'signal.polarity': enumField(
    'signal.polarity',
    'Signal polarity',
    'Signals',
    SIGNAL_POLARITY_OPTIONS,
  ),
  'signal.ageDays': numberField('signal.ageDays', 'Signal age', 'Signals', {
    min: 0,
    max: 3650,
    unit: 'days',
  }),
  'evidence.sourceType': enumField(
    'evidence.sourceType',
    'Source type',
    'Evidence',
    SOURCE_TYPE_OPTIONS,
  ),
  'evidence.reliability': enumField(
    'evidence.reliability',
    'Source reliability',
    'Evidence',
    SOURCE_RELIABILITY_OPTIONS,
  ),
  'evidence.ageDays': numberField('evidence.ageDays', 'Evidence age', 'Evidence', {
    min: 0,
    max: 3650,
    unit: 'days',
  }),
  'buyer.seniority': enumField('buyer.seniority', 'Buyer seniority', 'Buyer', SENIORITY_OPTIONS),
  'buyer.department': enumField('buyer.department', 'Buyer department', 'Buyer', DEPARTMENT_OPTIONS),
  'buyer.title': enumField('buyer.title', 'Buyer title', 'Buyer', TARGET_TITLE_OPTIONS),
  'buyer.contactCount': numberField('buyer.contactCount', 'Reachable contacts', 'Buyer', {
    min: 0,
    max: 500,
    unit: 'contacts',
  }),
  'account.isExistingCustomer': booleanField(
    'account.isExistingCustomer',
    'Is existing customer',
    'Account state',
  ),
  'account.hasOpenDeal': booleanField('account.hasOpenDeal', 'Has open deal', 'Account state'),
  'account.doNotContact': booleanField('account.doNotContact', 'Do not contact', 'Account state'),
  'account.inActiveSequence': booleanField(
    'account.inActiveSequence',
    'In active sequence',
    'Account state',
  ),
};

export const RULE_FIELD_OPTIONS: readonly SelectOption<RuleField>[] = RULE_FIELDS.map((field) => ({
  value: field,
  label: `${RULE_FIELD_DEFINITIONS[field].group} - ${RULE_FIELD_DEFINITIONS[field].label}`,
}));

export function ruleFieldDefinition(field: RuleField): RuleFieldDefinition {
  return RULE_FIELD_DEFINITIONS[field];
}

/** Operators the rule builder may offer for a given field. */
export function allowedOperatorsForField(field: RuleField): readonly RuleOperator[] {
  return OPERATORS_BY_VALUE_TYPE[RULE_FIELD_DEFINITIONS[field].valueType];
}

export function isOperatorAllowedForField(field: RuleField, operator: RuleOperator): boolean {
  return allowedOperatorsForField(field).includes(operator);
}
