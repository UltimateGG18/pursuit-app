import type { SelectOption } from '@pursuit/shared';
import {
  Checkbox as CheckboxInput,
  FieldErrors,
  FormField,
  Input,
  MultiSelectControl,
  RangeInput,
  SelectControl,
  SliderControl,
  Textarea,
  describedBy,
} from '../ui/index.js';

/**
 * Config-aware wrappers around the UI primitives.
 *
 * The ten ICP sections talk to these, so a section never touches layout or
 * ARIA wiring: it passes a config path, a value and a change handler, and gets
 * the same label / hint / error treatment as every other field.
 */
interface BaseProps {
  /** Dot path into the ICP config; used as the control id and the error key. */
  path: string;
  label: string;
  hint?: string;
  required?: boolean;
  errors?: string[];
  disabled?: boolean;
}

/** Every control names itself through the label element FormField renders. */
function labelId(path: string): string {
  return `${path}-label`;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface TextInputProps extends BaseProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
}

export function TextInput({
  path,
  label,
  hint,
  required,
  errors,
  disabled,
  value,
  onChange,
  placeholder,
  maxLength,
}: TextInputProps) {
  const invalid = (errors?.length ?? 0) > 0;
  return (
    <FormField path={path} label={label} hint={hint} required={required} errors={errors}>
      <Input
        id={path}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        invalid={invalid}
        aria-describedby={describedBy(path, Boolean(hint), invalid)}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

export interface TextAreaProps extends BaseProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
}

export function TextArea({
  path,
  label,
  hint,
  required,
  errors,
  disabled,
  value,
  onChange,
  rows = 3,
  maxLength,
}: TextAreaProps) {
  const invalid = (errors?.length ?? 0) > 0;
  const remaining = maxLength === undefined ? null : maxLength - value.length;

  return (
    <FormField
      path={path}
      label={label}
      hint={hint}
      required={required}
      errors={errors}
      action={
        remaining === null ? undefined : (
          <span className="pu-numeric text-[11px] text-ink-faint">{remaining} left</span>
        )
      }
    >
      <Textarea
        id={path}
        rows={rows}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        invalid={invalid}
        aria-describedby={describedBy(path, Boolean(hint), invalid)}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// Select / multi-select
// ---------------------------------------------------------------------------

export interface SelectProps<T extends string> extends BaseProps {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
}

export function Select<T extends string>({
  path,
  label,
  hint,
  required,
  errors,
  disabled,
  value,
  options,
  onChange,
}: SelectProps<T>) {
  const invalid = (errors?.length ?? 0) > 0;
  return (
    <FormField path={path} label={label} hint={hint} required={required} errors={errors}>
      <SelectControl
        id={path}
        labelledBy={labelId(path)}
        describedBy={describedBy(path, Boolean(hint), invalid)}
        value={value}
        options={options}
        disabled={disabled}
        invalid={invalid}
        onChange={onChange}
      />
    </FormField>
  );
}

export interface MultiSelectProps<T extends string> extends BaseProps {
  values: readonly T[];
  options: readonly SelectOption<T>[];
  onChange: (values: T[]) => void;
  /**
   * Retained for call-site compatibility with the checkbox-grid version of
   * this control. The searchable popup lays itself out, so the value is
   * ignored.
   */
  columns?: 1 | 2 | 3;
}

export function MultiSelect<T extends string>({
  path,
  label,
  hint,
  required,
  errors,
  disabled,
  values,
  options,
  onChange,
}: MultiSelectProps<T>) {
  const invalid = (errors?.length ?? 0) > 0;
  return (
    <FormField
      path={path}
      label={label}
      hint={hint}
      required={required}
      errors={errors}
      action={
        values.length > 0 ? (
          <span className="pu-numeric text-[11px] text-ink-faint">{values.length} selected</span>
        ) : undefined
      }
    >
      <MultiSelectControl
        id={path}
        labelledBy={labelId(path)}
        describedBy={describedBy(path, Boolean(hint), invalid)}
        label={label}
        values={values}
        options={options}
        disabled={disabled}
        invalid={invalid}
        onChange={onChange}
      />
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// Numbers and ranges
// ---------------------------------------------------------------------------

export interface NumberRangeProps extends BaseProps {
  min: number | undefined;
  max: number | undefined;
  bounds: { min: number; max: number };
  step?: number;
  unit?: string;
  onChange: (range: { min?: number; max?: number }) => void;
  minErrors?: string[];
  maxErrors?: string[];
}

/** Inclusive numeric range; either side may be left open. */
export function NumberRange({
  path,
  label,
  hint,
  required,
  errors,
  disabled,
  min,
  max,
  bounds,
  step = 1,
  unit,
  onChange,
  minErrors,
  maxErrors,
}: NumberRangeProps) {
  const allErrors = [...(errors ?? []), ...(minErrors ?? []), ...(maxErrors ?? [])];
  const invalid = allErrors.length > 0;

  return (
    <FormField
      path={path}
      label={label}
      hint={hint}
      required={required}
      errors={allErrors}
      captionOnly
    >
      <RangeInput
        path={path}
        label={label}
        min={min}
        max={max}
        bounds={bounds}
        step={step}
        unit={unit}
        disabled={disabled}
        invalid={invalid}
        describedBy={describedBy(path, Boolean(hint), invalid)}
        onChange={onChange}
      />
    </FormField>
  );
}

export interface SliderProps extends BaseProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

/** Single bounded value, for weights, windows and thresholds. */
export function Slider({
  path,
  label,
  hint,
  required,
  errors,
  disabled,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: SliderProps) {
  const invalid = (errors?.length ?? 0) > 0;
  return (
    <FormField path={path} label={label} hint={hint} required={required} errors={errors}>
      <SliderControl
        id={path}
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        disabled={disabled}
        describedBy={describedBy(path, Boolean(hint), invalid)}
        onChange={onChange}
      />
    </FormField>
  );
}

export interface CheckboxProps extends BaseProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Boolean switch rendered as a labelled row, not as a bare Yes/No pair. */
export function Checkbox({
  path,
  label,
  hint,
  errors,
  disabled,
  checked,
  onChange,
}: CheckboxProps) {
  const invalid = (errors?.length ?? 0) > 0;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        className="flex cursor-pointer items-start gap-2.5 rounded-control border border-line bg-surface-subtle px-3 py-2.5 transition-colors hover:border-line-strong has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
        htmlFor={path}
      >
        <CheckboxInput
          id={path}
          className="mt-0.5"
          checked={checked}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy(path, Boolean(hint), invalid)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-ink">{label}</span>
          {hint ? (
            <span className="mt-0.5 block text-xs leading-5 text-ink-muted" id={`${path}-hint`}>
              {hint}
            </span>
          ) : null}
        </span>
      </label>
      <FieldErrors id={`${path}-error`} errors={errors ?? []} />
    </div>
  );
}
