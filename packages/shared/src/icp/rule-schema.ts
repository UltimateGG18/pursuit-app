import { z } from 'zod';
import {
  RULE_FIELDS,
  RULE_OPERATORS,
  UNKNOWN_HANDLINGS,
  isOperatorAllowedForField,
  operandKindForOperator,
  ruleFieldDefinition,
  ruleOperatorLabel,
  type RuleField,
} from './rule-fields.js';

export const RULE_WEIGHT_MIN = 1;
export const RULE_WEIGHT_MAX = 10;

const scalarValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const listValueSchema = z.array(z.union([z.string(), z.number()])).max(200);

export const ruleRangeSchema = z.object({
  min: z.number().finite(),
  max: z.number().finite(),
});

/**
 * A single criteria rule. The value slot that must be filled is determined by
 * the operator, and the accepted values are determined by the rule field, so
 * the shape is validated in `refineRuleStructure` rather than by a plain
 * object schema.
 */
const ruleObjectSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  field: z.enum(RULE_FIELDS, {
    errorMap: () => ({ message: 'Select a criteria field from the catalog' }),
  }),
  operator: z.enum(RULE_OPERATORS, {
    errorMap: () => ({ message: 'Select an operator' }),
  }),
  value: scalarValueSchema.optional(),
  values: listValueSchema.optional(),
  range: ruleRangeSchema.optional(),
  unknownHandling: z.enum(UNKNOWN_HANDLINGS).default('TREAT_AS_UNKNOWN'),
  /** Only meaningful for nice-to-have rules, where it acts as a scoring weight. */
  weight: z.number().int().min(RULE_WEIGHT_MIN).max(RULE_WEIGHT_MAX).optional(),
  note: z.string().max(280).optional(),
});

type RuleObject = z.infer<typeof ruleObjectSchema>;

function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function enumValuesFor(field: RuleField): Set<string> | null {
  const definition = ruleFieldDefinition(field);
  if (definition.valueType !== 'ENUM' || !definition.options) return null;
  return new Set(definition.options.map((option) => option.value));
}

function checkScalarAgainstField(
  ctx: z.RefinementCtx,
  field: RuleField,
  path: (string | number)[],
  value: string | number | boolean,
): void {
  const definition = ruleFieldDefinition(field);
  switch (definition.valueType) {
    case 'ENUM': {
      const allowed = enumValuesFor(field);
      if (typeof value !== 'string') {
        addIssue(ctx, path, `${definition.label} expects one of the predefined options`);
        return;
      }
      if (allowed && !allowed.has(value)) {
        addIssue(ctx, path, `"${value}" is not a valid option for ${definition.label}`);
      }
      return;
    }
    case 'NUMBER': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        addIssue(ctx, path, `${definition.label} expects a number`);
        return;
      }
      if (definition.min !== undefined && value < definition.min) {
        addIssue(ctx, path, `${definition.label} must be at least ${definition.min}`);
      }
      if (definition.max !== undefined && value > definition.max) {
        addIssue(ctx, path, `${definition.label} must be at most ${definition.max}`);
      }
      return;
    }
    case 'TEXT': {
      if (typeof value !== 'string' || value.trim().length === 0) {
        addIssue(ctx, path, `${definition.label} expects a non-empty text value`);
      }
      return;
    }
    case 'BOOLEAN': {
      if (typeof value !== 'boolean') {
        addIssue(ctx, path, `${definition.label} expects true or false`);
      }
      return;
    }
    default:
      return;
  }
}

/** Validates that a rule's operator and value slots agree with its field definition. */
function refineRuleStructure(rule: RuleObject, ctx: z.RefinementCtx): void {
  const definition = ruleFieldDefinition(rule.field);

  if (!isOperatorAllowedForField(rule.field, rule.operator)) {
    addIssue(
      ctx,
      ['operator'],
      `Operator "${ruleOperatorLabel(rule.operator)}" cannot be used with ${definition.label}`,
    );
    return;
  }

  const operandKind = operandKindForOperator(rule.operator);
  const provided = {
    value: rule.value !== undefined,
    values: rule.values !== undefined,
    range: rule.range !== undefined,
  };

  const disallowedSlots: Array<'value' | 'values' | 'range'> = (
    ['value', 'values', 'range'] as const
  ).filter((slot) => {
    if (!provided[slot]) return false;
    if (operandKind === 'SINGLE') return slot !== 'value';
    if (operandKind === 'LIST') return slot !== 'values';
    if (operandKind === 'RANGE') return slot !== 'range';
    return true;
  });
  for (const slot of disallowedSlots) {
    addIssue(ctx, [slot], `"${slot}" is not allowed with operator "${ruleOperatorLabel(rule.operator)}"`);
  }

  switch (operandKind) {
    case 'SINGLE': {
      if (rule.value === undefined) {
        addIssue(ctx, ['value'], `A value is required for operator "${ruleOperatorLabel(rule.operator)}"`);
        return;
      }
      checkScalarAgainstField(ctx, rule.field, ['value'], rule.value);
      return;
    }
    case 'LIST': {
      if (rule.values === undefined) {
        addIssue(
          ctx,
          ['values'],
          `At least one value is required for operator "${ruleOperatorLabel(rule.operator)}"`,
        );
        return;
      }
      if (rule.values.length === 0) {
        addIssue(ctx, ['values'], 'Select at least one value');
        return;
      }
      const seen = new Set<string>();
      rule.values.forEach((entry, index) => {
        const key = String(entry);
        if (seen.has(key)) {
          addIssue(ctx, ['values', index], `Duplicate value "${key}"`);
        }
        seen.add(key);
        checkScalarAgainstField(ctx, rule.field, ['values', index], entry);
      });
      return;
    }
    case 'RANGE': {
      if (rule.range === undefined) {
        addIssue(ctx, ['range'], 'A minimum and maximum are required for "is between"');
        return;
      }
      if (definition.valueType !== 'NUMBER') {
        addIssue(ctx, ['operator'], '"is between" can only be used with numeric fields');
        return;
      }
      checkScalarAgainstField(ctx, rule.field, ['range', 'min'], rule.range.min);
      checkScalarAgainstField(ctx, rule.field, ['range', 'max'], rule.range.max);
      if (rule.range.min > rule.range.max) {
        addIssue(ctx, ['range', 'max'], 'Maximum must be greater than or equal to minimum');
      }
      return;
    }
    case 'NONE':
      return;
    default:
      return;
  }
}

export const icpRuleSchema = ruleObjectSchema.superRefine(refineRuleStructure);

/** Nice-to-have rules never disqualify a candidate, so they must carry a weight. */
export const icpNiceToHaveRuleSchema = icpRuleSchema.superRefine((rule, ctx) => {
  if (rule.weight === undefined) {
    addIssue(ctx, ['weight'], 'A nice-to-have rule needs a weight between 1 and 10');
  }
});

/** Hard filters and exclusions are boolean gates; a scoring weight is meaningless there. */
export const icpHardRuleSchema = icpRuleSchema.superRefine((rule, ctx) => {
  if (rule.weight !== undefined) {
    addIssue(ctx, ['weight'], 'Weights only apply to nice-to-have rules');
  }
});

export type IcpRuleInput = z.input<typeof icpRuleSchema>;
export type IcpRule = z.output<typeof icpRuleSchema>;
export type IcpRuleRange = z.output<typeof ruleRangeSchema>;

/**
 * Renders one operand for a reader.
 *
 * An ENUM field stores a catalog code, and the field definition already carries
 * the wording for it, so `LEGACY_ERP` is written as "Legacy ERP" here rather
 * than in each of the three places that display a rule. A code with no matching
 * option falls back to itself, which is the honest thing to show for a value
 * the catalog no longer contains.
 */
function describeOperand(field: RuleField, value: string | number | boolean): string {
  const { options } = ruleFieldDefinition(field);
  if (typeof value !== 'string' || !options) return String(value);
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Human readable rendering of a rule, used by the rule builder summary line,
 * the ICP overview and the analysis briefing.
 *
 * Enum operands are labelled, not printed raw: the briefing this feeds exists
 * precisely so a model never sees an opaque code, and a screen showing
 * `LEGACY_ERP` to a person was never right either.
 */
export function describeRule(rule: IcpRule): string {
  const definition = ruleFieldDefinition(rule.field);
  const operator = ruleOperatorLabel(rule.operator);
  switch (operandKindForOperator(rule.operator)) {
    case 'LIST':
      return `${definition.label} ${operator} ${(rule.values ?? [])
        .map((value) => describeOperand(rule.field, value))
        .join(', ')}`;
    case 'RANGE':
      return `${definition.label} ${operator} ${String(rule.range?.min)} and ${String(rule.range?.max)}`;
    case 'NONE':
      return `${definition.label} ${operator}`;
    case 'SINGLE':
    default:
      return `${definition.label} ${operator} ${
        rule.value === undefined ? '' : describeOperand(rule.field, rule.value)
      }`;
  }
}
