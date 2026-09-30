import { memo } from 'react';
import {
  TRIGGER_LOOKBACK_DAYS_MAX,
  TRIGGER_LOOKBACK_DAYS_MIN,
  TRIGGER_TYPE_OPTIONS,
} from '@pursuit/shared';
import { Checkbox, MultiSelect, Slider } from '../../../components/form/controls.js';
import { TriggerEditor } from '../../../components/form/TriggerEditor.js';
import { FieldGrid, FormSubsection } from '../../../components/ui/index.js';
import type { SectionProps } from './section-types.js';

function TriggersIntentSectionImpl({
  value,
  onChange,
  errorsFor,
  disabled,
}: SectionProps<'triggersIntent'>) {
  return (
    <div className="flex flex-col gap-6">
      <FormSubsection
        title="Triggers"
        description="Each trigger is dated and typed. Transient signals decay; structural signals do not."
        tone="brand"
      >
        <TriggerEditor
          path="triggersIntent.triggers"
          triggers={value.triggers}
          errorsFor={errorsFor}
          disabled={disabled}
          onChange={(triggers) =>
            onChange({
              triggers,
              // Keep the exclusion list consistent with the configured triggers.
              excludedTriggerTypes: value.excludedTriggerTypes.filter(
                (type) => !triggers.some((trigger) => trigger.type === type),
              ),
            })
          }
        />
      </FormSubsection>

      <FieldGrid>
        <MultiSelect
          path="triggersIntent.excludedTriggerTypes"
          label="Excluded trigger types"
          hint="Signals that must never raise intent for this ICP."
          values={value.excludedTriggerTypes}
          options={TRIGGER_TYPE_OPTIONS.filter(
            (option) => !value.triggers.some((trigger) => trigger.type === option.value),
          )}
          errors={errorsFor('triggersIntent.excludedTriggerTypes')}
          disabled={disabled}
          onChange={(excludedTriggerTypes) => onChange({ excludedTriggerTypes })}
        />

        <div className="flex flex-col gap-5">
          <Slider
            path="triggersIntent.minimumSignalCount"
            label="Minimum matching signals"
            hint="How many configured triggers must be present before intent counts."
            min={0}
            max={10}
            value={value.minimumSignalCount}
            errors={errorsFor('triggersIntent.minimumSignalCount')}
            disabled={disabled}
            onChange={(minimumSignalCount) => onChange({ minimumSignalCount })}
          />

          <Slider
            path="triggersIntent.signalFreshnessWindowDays"
            label="Signal freshness window"
            hint="Signals older than this window lose their influence."
            min={TRIGGER_LOOKBACK_DAYS_MIN}
            max={TRIGGER_LOOKBACK_DAYS_MAX}
            step={7}
            unit="days"
            value={value.signalFreshnessWindowDays}
            errors={errorsFor('triggersIntent.signalFreshnessWindowDays')}
            disabled={disabled}
            onChange={(signalFreshnessWindowDays) => onChange({ signalFreshnessWindowDays })}
          />

          <Checkbox
            path="triggersIntent.requireStructuralSignal"
            label="Require a structural signal"
            hint="Prevents an ICP from qualifying on transient news alone."
            checked={value.requireStructuralSignal}
            errors={errorsFor('triggersIntent.requireStructuralSignal')}
            disabled={disabled}
            onChange={(requireStructuralSignal) => onChange({ requireStructuralSignal })}
          />
        </div>
      </FieldGrid>
    </div>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const TriggersIntentSection = memo(TriggersIntentSectionImpl);
