import { useEffect, useState } from 'react';
import { cn } from './cn.js';
import { AlertIcon, CheckIcon, CloseIcon } from './icons.js';

export type ToastTone = 'success' | 'error';

export interface ToastProps {
  tone: ToastTone;
  title: string;
  description?: string;
  /** Changing this value re-shows a toast that was already dismissed. */
  messageKey: string;
  durationMs?: number;
}

/**
 * Corner notification for outcomes the user does not have to act on.
 *
 * Driven by the message the form already produces rather than by a queue: the
 * form has one outcome at a time, so a single self-dismissing panel keeps this
 * honest and avoids a provider the app does not need.
 */
export function Toast({ tone, title, description, messageKey, durationMs = 6000 }: ToastProps) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    setDismissedKey(null);
    const timer = setTimeout(() => setDismissedKey(messageKey), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, messageKey]);

  if (dismissedKey === messageKey) return null;

  return (
    // Top-right, clear of the docked save bar at the bottom of the viewport.
    <div className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-50 flex justify-center px-4 sm:inset-x-auto sm:right-6 sm:justify-end sm:px-0">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-card border bg-surface px-3.5 py-3 shadow-popover',
          tone === 'success' ? 'border-positive-200' : 'border-critical-200',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full',
            tone === 'success'
              ? 'bg-positive-50 text-positive-600'
              : 'bg-critical-50 text-critical-600',
          )}
        >
          {tone === 'success' ? (
            <CheckIcon className="h-3.5 w-3.5" />
          ) : (
            <AlertIcon className="h-3.5 w-3.5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">{title}</p>
          {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
        </div>

        <button
          type="button"
          className="-mr-1 -mt-1 flex-none rounded p-1 text-ink-faint transition-colors hover:bg-canvas-deep hover:text-ink"
          aria-label="Dismiss notification"
          onClick={() => setDismissedKey(messageKey)}
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
