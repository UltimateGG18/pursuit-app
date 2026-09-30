import type { ReactNode } from 'react';
import { cn } from './cn.js';
import { AlertIcon } from './icons.js';

export interface FormFieldProps {
  /** Dot path into the ICP config; used as the control id and as the error key. */
  path: string;
  label: string;
  hint?: string;
  required?: boolean;
  errors?: string[];
  /**
   * Render the caption as plain text instead of a `<label for>`. Use it when
   * the control is not a single labelable element (a checkbox group, a pair of
   * range inputs) and carries its own accessible name.
   */
  captionOnly?: boolean;
  /** Right-aligned slot on the label row, e.g. a selected count. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Label / hint / error shell shared by every control, so validation messages
 * appear in the same place and are wired to the control for screen readers.
 *
 * Hints sit above the control and errors below it: the hint is guidance you
 * read before typing, the error is feedback on what you typed.
 */
export function FormField({
  path,
  label,
  hint,
  required,
  errors,
  captionOnly,
  action,
  className,
  children,
}: FormFieldProps) {
  const hasErrors = (errors?.length ?? 0) > 0;
  const caption = (
    <>
      {label}
      {required ? (
        <span className="ml-0.5 font-normal text-ink-faint" aria-hidden="true">
          *
        </span>
      ) : null}
      {required ? <span className="sr-only"> (required)</span> : null}
    </>
  );

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        {captionOnly ? (
          <span className="text-[13px] font-semibold leading-5 text-ink" id={`${path}-label`}>
            {caption}
          </span>
        ) : (
          <label
            className="text-[13px] font-semibold leading-5 text-ink"
            htmlFor={path}
            id={`${path}-label`}
          >
            {caption}
          </label>
        )}
        {action}
      </div>

      {hint ? (
        <p className="-mt-0.5 text-xs leading-5 text-ink-muted" id={`${path}-hint`}>
          {hint}
        </p>
      ) : null}

      {children}

      {hasErrors ? (
        <ul className="flex flex-col gap-0.5" id={`${path}-error`}>
          {errors?.map((message) => (
            <li className="flex items-start gap-1.5 text-xs text-critical-600" key={message}>
              <AlertIcon className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>{message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Ties a control to its hint and error text so both are announced. */
export function describedBy(path: string, hint: boolean, invalid: boolean): string | undefined {
  const ids = [hint ? `${path}-hint` : null, invalid ? `${path}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/** Standalone error list, for controls that are not wrapped in a FormField. */
export function FieldErrors({ id, errors }: { id?: string; errors: readonly string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5" id={id}>
      {errors.map((message) => (
        <li className="flex items-start gap-1.5 text-xs text-critical-600" key={message}>
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>{message}</span>
        </li>
      ))}
    </ul>
  );
}

