import type { ReactNode } from 'react';
import { cn } from './cn.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** `inline` drops the dashed frame, for empty lists that already sit in one. */
  variant?: 'framed' | 'inline';
}

/**
 * The "nothing here yet" panel used by every list in the form - the ICP
 * sidebar, the rule buckets, the trigger rows and the keyword groups - so an
 * empty list always explains itself the same way instead of being a bare line
 * of grey text.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
  variant = 'framed',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-1',
        variant === 'framed' &&
          'rounded-control border border-dashed border-line-strong bg-surface-subtle px-3.5 py-4',
        className,
      )}
    >
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {description ? (
        <p className="max-w-xl text-xs leading-5 text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
