import {
  SIGNAL_DECAY_CLASS_OPTIONS,
  SIGNAL_POLARITY_OPTIONS,
  TRIGGER_LOOKBACK_DAYS_MAX,
  TRIGGER_LOOKBACK_DAYS_MIN,
  TRIGGER_RELEVANCE_MAX,
  TRIGGER_RELEVANCE_MIN,
  TRIGGER_TYPE_OPTIONS,
  type IcpTrigger,
  type TriggerType,
} from '@pursuit/shared';
import {
  Button,
  EmptyState,
  FieldErrors,
  PlusIcon,
  SelectControl,
  SliderControl,
  TrashIcon,
  cn,
} from '../ui/index.js';
import type { ErrorLookup } from './RuleBuilder.js';

export interface TriggerEditorProps {
  path: string;
  triggers: IcpTrigger[];
  onChange: (triggers: IcpTrigger[]) => void;
  errorsFor: ErrorLookup;
  disabled?: boolean;
}

function firstUnusedType(triggers: readonly IcpTrigger[]): TriggerType {
  const used = new Set(triggers.map((trigger) => trigger.type));
  const available = TRIGGER_TYPE_OPTIONS.find((option) => !used.has(option.value));
  return available?.value ?? 'RECENT_HIRING';
}

/** Caption used above each control in a trigger row. */
function RowLabel({ id, children }: { id: string; children: string }) {
  return (
    <span
      id={id}
      className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint"
    >
      {children}
    </span>
  );
}

/**
 * Structured trigger rows. Each trigger carries polarity, a decay class and a
 * lookback window, which is what the deterministic Intent and Timing
 * dimensions read - so intent is configured, never written as prose.
 */
export function TriggerEditor({ path, triggers, onChange, errorsFor, disabled }: TriggerEditorProps) {
  const bucketErrors = errorsFor(path);
  const allTypesUsed = triggers.length >= TRIGGER_TYPE_OPTIONS.length;

  const update = (index: number, trigger: IcpTrigger): void => {
    onChange(triggers.map((existing, position) => (position === index ? trigger : existing)));
  };

  return (
    <div className="flex flex-col gap-3">
      <FieldErrors errors={bucketErrors ?? []} />

      {triggers.length === 0 ? (
        <EmptyState
          title="No triggers configured"
          description="Without at least one trigger this ICP has no intent signal to score."
        />
      ) : (
        <ol className="flex flex-col gap-2.5">
          {triggers.map((trigger, index) => {
            const rowPath = `${path}[${index}]`;
            const rowId = `${path}-${index}`;
            const rowErrors = [
              ...(errorsFor(rowPath) ?? []),
              ...(errorsFor(`${rowPath}.type`) ?? []),
              ...(errorsFor(`${rowPath}.relevance`) ?? []),
              ...(errorsFor(`${rowPath}.lookbackDays`) ?? []),
            ];

            return (
              <li
                key={trigger.type}
                className={cn(
                  'rounded-control border bg-surface p-3',
                  rowErrors.length > 0 ? 'border-critical-200 bg-critical-50/40' : 'border-line',
                )}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
                    <RowLabel id={`${rowId}-type-label`}>Trigger</RowLabel>
                    <SelectControl
                      id={`${rowId}-type`}
                      labelledBy={`${rowId}-type-label`}
                      size="sm"
                      value={trigger.type}
                      options={TRIGGER_TYPE_OPTIONS}
                      disabled={disabled}
                      onChange={(type) => update(index, { ...trigger, type })}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <RowLabel id={`${rowId}-polarity-label`}>Polarity</RowLabel>
                    <SelectControl
                      id={`${rowId}-polarity`}
                      labelledBy={`${rowId}-polarity-label`}
                      size="sm"
                      value={trigger.polarity}
                      options={SIGNAL_POLARITY_OPTIONS}
                      disabled={disabled}
                      onChange={(polarity) => update(index, { ...trigger, polarity })}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <RowLabel id={`${rowId}-decay-label`}>Decay</RowLabel>
                    <SelectControl
                      id={`${rowId}-decay`}
                      labelledBy={`${rowId}-decay-label`}
                      size="sm"
                      value={trigger.decayClass}
                      options={SIGNAL_DECAY_CLASS_OPTIONS}
                      disabled={disabled}
                      onChange={(decayClass) => update(index, { ...trigger, decayClass })}
                    />
                  </div>

                  <div className="flex items-end justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2 hover:text-critical-600"
                      icon={<TrashIcon className="h-3.5 w-3.5" />}
                      disabled={disabled}
                      onClick={() => onChange(triggers.filter((_, position) => position !== index))}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-x-6 gap-y-3 border-t border-dashed border-line pt-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <RowLabel id={`${rowId}-relevance-label`}>Relevance</RowLabel>
                    <SliderControl
                      id={`${rowId}-relevance`}
                      label={`${trigger.type} relevance`}
                      min={TRIGGER_RELEVANCE_MIN}
                      max={TRIGGER_RELEVANCE_MAX}
                      value={trigger.relevance}
                      disabled={disabled}
                      onChange={(relevance) => update(index, { ...trigger, relevance })}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <RowLabel id={`${rowId}-lookback-label`}>Lookback</RowLabel>
                    <SliderControl
                      id={`${rowId}-lookback`}
                      label={`${trigger.type} lookback days`}
                      min={TRIGGER_LOOKBACK_DAYS_MIN}
                      max={TRIGGER_LOOKBACK_DAYS_MAX}
                      step={7}
                      unit="d"
                      value={trigger.lookbackDays}
                      disabled={disabled}
                      onChange={(lookbackDays) => update(index, { ...trigger, lookbackDays })}
                    />
                  </div>
                </div>

                {rowErrors.length > 0 ? (
                  <div className="mt-2">
                    <FieldErrors errors={rowErrors} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<PlusIcon className="h-3.5 w-3.5" />}
          disabled={disabled || allTypesUsed}
          onClick={() =>
            onChange([
              ...triggers,
              {
                type: firstUnusedType(triggers),
                polarity: 'POSITIVE',
                decayClass: 'TRANSIENT',
                relevance: 5,
                lookbackDays: 90,
              },
            ])
          }
        >
          Add trigger
        </Button>
        {allTypesUsed ? (
          <p className="mt-1.5 text-xs text-ink-muted">
            Every trigger type in the catalog is already configured.
          </p>
        ) : null}
      </div>
    </div>
  );
}
