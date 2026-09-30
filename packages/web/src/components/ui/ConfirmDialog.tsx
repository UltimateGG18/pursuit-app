import { useEffect, useId, useRef } from 'react';
import { Button } from './Button.js';
import { cn } from './cn.js';

export interface ConfirmDialogProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` marks a destructive confirmation; the default is neutral. */
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation for an action that cannot be undone from the UI.
 *
 * Cancel takes the initial focus rather than Confirm: a stray Enter on a
 * destructive dialog must not be the thing that deletes the record. Escape and
 * a backdrop click both cancel, so there is always a way out that is not the
 * dangerous button.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]"
        aria-hidden="true"
        onClick={onCancel}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="relative w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-popover"
      >
        <h2 className="text-[15px] font-semibold leading-6 text-ink" id={titleId}>
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 text-[13px] leading-6 text-ink-muted" id={descriptionId}>
            {description}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          {/* Both tones are the primary action of the dialog; `danger` only
              recolours it, so the accent is never spent on the safe choice. */}
          <Button
            variant="primary"
            className={cn(
              tone === 'danger' &&
                'border-critical-600 bg-critical-600 hover:border-critical-700 hover:bg-critical-700 active:bg-critical-700 disabled:border-critical-200 disabled:bg-critical-200',
            )}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
