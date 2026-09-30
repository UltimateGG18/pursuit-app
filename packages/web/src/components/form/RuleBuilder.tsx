import { useMemo } from 'react';
import {
  RULE_FIELDS,
  RULE_WEIGHT_MAX,
  RULE_WEIGHT_MIN,
  UNKNOWN_HANDLING_OPTIONS,
  allowedOperatorsForField,
  describeRule,
  operandKindForOperator,
  ruleFieldDefinition,
  ruleOperatorLabel,
  type IcpRule,
  type RuleField,
  type RuleOperator,
  type SelectOption,
} from '@pursuit/shared';
import {
  Badge,
  Button,
  EmptyState,
  FieldErrors,
  Input,
  MultiSelectControl,
  PlusIcon,
  SelectControl,
  SliderControl,
  TrashIcon,
  cn,
} from '../ui/index.js';

export type ErrorLookup = (path: string) => string[] | undefined;

export interface RuleBuilderProps {
  /** Base path of the rule array, e.g. `mustNiceExclude.mustHave`. */
  path: string;
  label: string;
  hint?: string;
  rules: IcpRule[];
  onChange: (rules: IcpRule[]) => void;
  /** Nice-to-have rules carry a scoring weight; hard rules must not. */
  withWeight?: boolean;
  errorsFor: ErrorLookup;
  disabled?: boolean;
  addLabel?: string;
  /** How the bucket combines its conditions, shown as the connector chip. */
  combinator?: 'ALL' | 'ANY';
  tone?: 'neutral' | 'positive' | 'critical';
}

function newRuleId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `rule-${Math.random().toString(36).slice(2, 12)}`;
}

/** A rule with only the slots its operator uses, so switching never leaves stale values. */
function ruleForOperator(
  rule: IcpRule,
  field: RuleField,
  operator: RuleOperator,
  withWeight: boolean,
): IcpRule {
  const next: IcpRule = {
    id: rule.id ?? newRuleId(),
    field,
    operator,
    unknownHandling: rule.unknownHandling,
  };
  if (withWeight) next.weight = rule.weight ?? 5;

  const definition = ruleFieldDefinition(field);
  switch (operandKindForOperator(operator)) {
    case 'SINGLE':
      if (definition.valueType === 'ENUM') next.value = definition.options?.[0]?.value ?? '';
      else if (definition.valueType === 'NUMBER') next.value = definition.min ?? 0;
      else if (definition.valueType === 'BOOLEAN') next.value = true;
      else next.value = '';
      break;
    case 'LIST':
      next.values = [];
      break;
    case 'RANGE':
      next.range = { min: definition.min ?? 0, max: definition.max ?? 0 };
      break;
    case 'NONE':
    default:
      break;
  }
  return next;
}

function createRule(withWeight: boolean): IcpRule {
  const field: RuleField = 'company.country';
  const base: IcpRule = {
    id: newRuleId(),
    field,
    operator: 'IN',
    unknownHandling: 'TREAT_AS_UNKNOWN',
  };
  return ruleForOperator(base, field, 'IN', withWeight);
}

const BOOLEAN_OPTIONS: readonly SelectOption<'true' | 'false'>[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

interface RuleValueEditorProps {
  rule: IcpRule;
  rowId: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (rule: IcpRule) => void;
}

/** The value editor is chosen by the field's value type and the operator's operand kind. */
function RuleValueEditor({ rule, rowId, disabled, invalid, onChange }: RuleValueEditorProps) {
  const definition = ruleFieldDefinition(rule.field);
  const kind = operandKindForOperator(rule.operator);

  if (kind === 'NONE') {
    return (
      <p className="flex min-h-8 flex-1 items-center text-xs italic text-ink-faint">
        No value needed
      </p>
    );
  }

  if (kind === 'RANGE') {
    const range = rule.range ?? { min: definition.min ?? 0, max: definition.max ?? 0 };
    return (
      <div className="flex flex-1 items-center gap-2">
        <Input
          className="min-h-8 px-2.5 py-1 text-[13px]"
          type="number"
          aria-label={`${definition.label} minimum`}
          value={range.min}
          disabled={disabled}
          invalid={invalid}
          onChange={(event) =>
            onChange({ ...rule, range: { ...range, min: Number(event.target.value) } })
          }
        />
        <span className="flex-none text-[11px] uppercase tracking-wide text-ink-faint">to</span>
        <Input
          className="min-h-8 px-2.5 py-1 text-[13px]"
          type="number"
          aria-label={`${definition.label} maximum`}
          value={range.max}
          disabled={disabled}
          invalid={invalid}
          onChange={(event) =>
            onChange({ ...rule, range: { ...range, max: Number(event.target.value) } })
          }
        />
      </div>
    );
  }

  if (kind === 'LIST') {
    return (
      <div className="min-w-0 flex-1">
        <MultiSelectControl
          id={`${rowId}-values`}
          labelledBy={`${rowId}-value-label`}
          label={`${definition.label} values`}
          values={(rule.values ?? []).map(String)}
          options={definition.options ?? []}
          disabled={disabled}
          invalid={invalid}
          placeholder="Choose values"
          onChange={(values) => onChange({ ...rule, values })}
        />
      </div>
    );
  }

  // SINGLE
  if (definition.valueType === 'ENUM') {
    return (
      <div className="min-w-0 flex-1">
        <SelectControl
          id={`${rowId}-value`}
          labelledBy={`${rowId}-value-label`}
          size="sm"
          value={typeof rule.value === 'string' ? rule.value : ''}
          options={definition.options ?? []}
          disabled={disabled}
          invalid={invalid}
          onChange={(value) => onChange({ ...rule, value })}
        />
      </div>
    );
  }

  if (definition.valueType === 'BOOLEAN') {
    return (
      <div className="min-w-0 flex-1">
        <SelectControl
          id={`${rowId}-value`}
          labelledBy={`${rowId}-value-label`}
          size="sm"
          value={rule.value === true ? 'true' : 'false'}
          options={BOOLEAN_OPTIONS}
          disabled={disabled}
          invalid={invalid}
          onChange={(value) => onChange({ ...rule, value: value === 'true' })}
        />
      </div>
    );
  }

  if (definition.valueType === 'NUMBER') {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Input
          className="min-h-8 px-2.5 py-1 text-[13px]"
          type="number"
          aria-label={`${definition.label} value`}
          min={definition.min}
          max={definition.max}
          value={typeof rule.value === 'number' ? rule.value : ''}
          disabled={disabled}
          invalid={invalid}
          onChange={(event) => onChange({ ...rule, value: Number(event.target.value) })}
        />
        {definition.unit ? (
          <span className="flex-none text-[11px] text-ink-faint">{definition.unit}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <Input
        className="min-h-8 px-2.5 py-1 text-[13px]"
        aria-label={`${definition.label} value`}
        value={typeof rule.value === 'string' ? rule.value : ''}
        disabled={disabled}
        invalid={invalid}
        placeholder="Enter a value"
        onChange={(event) => onChange({ ...rule, value: event.target.value })}
      />
    </div>
  );
}

const TONE_RING: Record<string, string> = {
  neutral: 'border-line',
  positive: 'border-positive-200',
  critical: 'border-critical-200',
};

/**
 * Rule builder for the must-have / nice-to-have / exclusion buckets.
 *
 * Fields, operators and values all come from the shared rule catalog, so a
 * rule that can be built here is a rule the backend contract accepts - the UI
 * cannot express an operator or value the engine would not understand. The
 * redesign changes only how the rows are presented; the rule objects it emits
 * are byte-identical to the ones the previous form produced.
 */
export function RuleBuilder({
  path,
  label,
  hint,
  rules,
  onChange,
  withWeight = false,
  errorsFor,
  disabled,
  addLabel = 'Add rule',
  combinator = 'ALL',
  tone = 'neutral',
}: RuleBuilderProps) {
  const fieldOptions = useMemo<readonly SelectOption<RuleField>[]>(
    () =>
      [...RULE_FIELDS]
        .sort((left, right) => {
          const leftGroup = ruleFieldDefinition(left).group;
          const rightGroup = ruleFieldDefinition(right).group;
          return leftGroup === rightGroup ? 0 : leftGroup.localeCompare(rightGroup);
        })
        .map((field) => ({ value: field, label: ruleFieldDefinition(field).label })),
    [],
  );

  const bucketErrors = errorsFor(path);
  const headingId = `${path}-heading`;

  const updateRule = (index: number, rule: IcpRule): void => {
    onChange(rules.map((existing, position) => (position === index ? rule : existing)));
  };

  return (
    <div
      className={cn('rounded-card border bg-surface-subtle', TONE_RING[tone])}
      role="group"
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pb-3 pt-3.5">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-ink" id={headingId}>
            {label}
          </h4>
          {hint ? <p className="mt-0.5 max-w-xl text-xs leading-5 text-ink-muted">{hint}</p> : null}
        </div>
        <Badge tone={rules.length > 0 ? 'brand' : 'outline'}>
          {rules.length} {rules.length === 1 ? 'condition' : 'conditions'}
        </Badge>
      </div>

      <div className="border-t border-line/70 px-4 py-3.5">
        <FieldErrors errors={bucketErrors ?? []} />

        {rules.length === 0 ? (
          <EmptyState
            className="bg-surface"
            title="No conditions yet"
            description="Every condition you add is evaluated against the shared rule catalog."
          />
        ) : (
          <ol className="flex flex-col">
            {rules.map((rule, index) => {
              const rulePath = `${path}[${index}]`;
              const rowId = `${path}-${index}`;
              const definition = ruleFieldDefinition(rule.field);
              const operators = allowedOperatorsForField(rule.field);
              const operatorOptions = operators.map((operator) => ({
                value: operator,
                label: ruleOperatorLabel(operator),
              }));
              const rowErrors = [
                ...(errorsFor(rulePath) ?? []),
                ...(errorsFor(`${rulePath}.operator`) ?? []),
                ...(errorsFor(`${rulePath}.value`) ?? []),
                ...(errorsFor(`${rulePath}.values`) ?? []),
                ...(errorsFor(`${rulePath}.range`) ?? []),
                ...(errorsFor(`${rulePath}.range.min`) ?? []),
                ...(errorsFor(`${rulePath}.range.max`) ?? []),
                ...(errorsFor(`${rulePath}.weight`) ?? []),
              ];
              const invalid = rowErrors.length > 0;

              return (
                <li key={rule.id ?? index}>
                  {index > 0 ? (
                    <div className="flex items-center gap-2 py-1.5 pl-1">
                      <span className="pu-numeric rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                        {combinator === 'ALL' ? 'and' : 'or'}
                      </span>
                      <span className="h-px flex-1 bg-line" aria-hidden="true" />
                    </div>
                  ) : null}

                  <div
                    className={cn(
                      'rounded-control border bg-surface p-2.5',
                      invalid ? 'border-critical-200 bg-critical-50/40' : 'border-line',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="sr-only" id={`${rowId}-field-label`}>
                        Condition {index + 1} field
                      </span>
                      <span className="sr-only" id={`${rowId}-operator-label`}>
                        Condition {index + 1} operator
                      </span>
                      <span className="sr-only" id={`${rowId}-value-label`}>
                        Condition {index + 1} value
                      </span>

                      <div className="w-full min-w-0 sm:w-52">
                        <SelectControl
                          id={`${rowId}-field`}
                          labelledBy={`${rowId}-field-label`}
                          size="sm"
                          searchable
                          value={rule.field}
                          options={fieldOptions}
                          groupBy={(option) => ruleFieldDefinition(option.value).group}
                          disabled={disabled}
                          onChange={(nextField) => {
                            const nextOperator = allowedOperatorsForField(nextField)[0] ?? 'EQUALS';
                            updateRule(
                              index,
                              ruleForOperator(rule, nextField, nextOperator, withWeight),
                            );
                          }}
                        />
                      </div>

                      <div className="w-full min-w-0 sm:w-40">
                        <SelectControl
                          id={`${rowId}-operator`}
                          labelledBy={`${rowId}-operator-label`}
                          size="sm"
                          value={rule.operator}
                          options={operatorOptions}
                          disabled={disabled}
                          onChange={(operator) =>
                            updateRule(index, ruleForOperator(rule, rule.field, operator, withWeight))
                          }
                        />
                      </div>

                      <RuleValueEditor
                        rule={rule}
                        rowId={rowId}
                        disabled={disabled}
                        invalid={invalid}
                        onChange={(next) => updateRule(index, next)}
                      />

                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto flex-none px-2 hover:text-critical-600"
                        aria-label={`Remove condition ${index + 1}: ${definition.label}`}
                        disabled={disabled}
                        onClick={() => onChange(rules.filter((_, position) => position !== index))}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed border-line pt-2.5">
                      <div className="flex w-full min-w-0 items-center gap-2 text-[11px] text-ink-muted sm:w-auto">
                        <span aria-hidden="true" className="flex-none">
                          When unknown
                        </span>
                        <span className="sr-only" id={`${rowId}-unknown-label`}>
                          Condition {index + 1}: handling when the data is unknown
                        </span>
                        <div className="min-w-0 flex-1 sm:w-72 sm:flex-none">
                          <SelectControl
                            id={`${rowId}-unknown`}
                            labelledBy={`${rowId}-unknown-label`}
                            size="sm"
                            value={rule.unknownHandling}
                            options={UNKNOWN_HANDLING_OPTIONS}
                            disabled={disabled}
                            onChange={(unknownHandling) =>
                              updateRule(index, { ...rule, unknownHandling })
                            }
                          />
                        </div>
                      </div>

                      {withWeight ? (
                        <div className="flex w-full min-w-0 flex-1 items-center gap-2 text-[11px] text-ink-muted sm:min-w-56 sm:w-auto">
                          <span className="flex-none">Weight</span>
                          <SliderControl
                            id={`${rowId}-weight`}
                            label={`Condition ${index + 1} weight`}
                            min={RULE_WEIGHT_MIN}
                            max={RULE_WEIGHT_MAX}
                            value={rule.weight ?? 5}
                            disabled={disabled}
                            onChange={(weight) => updateRule(index, { ...rule, weight })}
                          />
                        </div>
                      ) : null}

                      <p className="ml-auto max-w-full truncate text-[11px] text-ink-faint">
                        {describeRule(rule)}
                      </p>
                    </div>

                    {invalid ? (
                      <div className="mt-2">
                        <FieldErrors errors={rowErrors} />
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            disabled={disabled}
            onClick={() => onChange([...rules, createRule(withWeight)])}
          >
            {addLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
