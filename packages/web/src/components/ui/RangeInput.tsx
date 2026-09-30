import { useId } from 'react';
import { cn } from './cn.js';
import { Input } from './Input.js';

export interface RangeInputProps {
  /** Base path; the two inputs get `.min` and `.max` appended. */
  path: string;
  label: string;
  min: number | undefined;
  max: number | undefined;
  bounds: { min: number; max: number };
  step?: number;
  unit?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (range: { min?: number; max?: number }) => void;
}

const FORMAT = new Intl.NumberFormat('en-US');

/** Upper end of the slider when the schema bound is effectively unbounded. */
function sliderCeiling(bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, 100000);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Numeric range: two bounded number inputs, a paired slider for the common
 * case, and a plain-language summary of what is currently expressed.
 *
 * Either side may stay empty - the ICP schema treats an open end as "no
 * constraint", not as zero - so the slider is an accelerator for the inputs
 * rather than the source of truth.
 */
export function RangeInput({
  path,
  label,
  min,
  max,
  bounds,
  step = 1,
  unit,
  disabled,
  invalid,
  describedBy,
  onChange,
}: RangeInputProps) {
  const summaryId = `${useId()}summary`;
  const ceiling = sliderCeiling(bounds);
  const showSliders = bounds.max <= 100000;

  const toNumber = (raw: string): number | undefined => {
    if (raw.trim() === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const summary = (() => {
    const unitSuffix = unit ? ` ${unit}` : '';
    if (min === undefined && max === undefined) return `Any${unitSuffix ? ` ${unit}` : ''}`;
    if (min !== undefined && max !== undefined) {
      return `${FORMAT.format(min)}-${FORMAT.format(max)}${unitSuffix}`;
    }
    if (min !== undefined) return `${FORMAT.format(min)}${unitSuffix} and above`;
    return `Up to ${FORMAT.format(max as number)}${unitSuffix}`;
  })();

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label
            className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-muted"
            htmlFor={`${path}.min`}
          >
            Minimum
          </label>
          <Input
            id={`${path}.min`}
            type="number"
            inputMode="numeric"
            placeholder="No minimum"
            aria-label={`${label} minimum`}
            aria-describedby={[describedBy, summaryId].filter(Boolean).join(' ') || undefined}
            min={bounds.min}
            max={bounds.max}
            step={step}
            disabled={disabled}
            invalid={invalid}
            value={min ?? ''}
            onChange={(event) => onChange({ min: toNumber(event.target.value), max })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-muted"
            htmlFor={`${path}.max`}
          >
            Maximum
          </label>
          <Input
            id={`${path}.max`}
            type="number"
            inputMode="numeric"
            placeholder="No maximum"
            aria-label={`${label} maximum`}
            aria-describedby={summaryId}
            min={bounds.min}
            max={bounds.max}
            step={step}
            disabled={disabled}
            invalid={invalid}
            value={max ?? ''}
            onChange={(event) => onChange({ min, max: toNumber(event.target.value) })}
          />
        </div>
      </div>

      {showSliders ? (
        <div className="flex items-center gap-3">
          <input
            type="range"
            className="pu-slider"
            aria-label={`${label} minimum slider`}
            min={bounds.min}
            max={ceiling}
            step={step}
            disabled={disabled}
            value={min ?? bounds.min}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange({ min: next, max: max !== undefined ? Math.max(max, next) : max });
            }}
          />
          <input
            type="range"
            className="pu-slider"
            aria-label={`${label} maximum slider`}
            min={bounds.min}
            max={ceiling}
            step={step}
            disabled={disabled}
            value={max ?? ceiling}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange({ min: min !== undefined ? Math.min(min, next) : min, max: next });
            }}
          />
        </div>
      ) : null}

      <p
        className={cn('pu-numeric text-xs', min !== undefined || max !== undefined ? 'text-ink-soft' : 'text-ink-muted')}
        id={summaryId}
      >
        {summary}
      </p>
    </div>
  );
}

export interface SliderControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  describedBy?: string;
  onChange: (value: number) => void;
}

/** Single bounded value: slider plus a readable numeric readout. */
export function SliderControl({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled,
  describedBy,
  onChange,
}: SliderControlProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        className="pu-slider"
        min={min}
        max={max}
        step={step}
        value={clamp(value, min, max)}
        disabled={disabled}
        aria-label={label}
        aria-describedby={describedBy}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output
        className="pu-numeric min-w-16 flex-none rounded-md border border-line bg-surface-sunken px-2 py-1 text-center text-xs font-medium text-ink"
        htmlFor={id}
      >
        {FORMAT.format(value)}
        {unit ? ` ${unit}` : ''}
      </output>
    </div>
  );
}
