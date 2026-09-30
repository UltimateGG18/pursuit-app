import type { ReactNode } from 'react';
import { cn } from './cn.js';
import { Badge } from './Badge.js';

export interface FormSectionProps {
  id: string;
  /** Two-digit ordinal, shown as a quiet index rather than as a heading number. */
  number: string;
  title: string;
  description: string;
  /** Issue count for this section; renders a badge in the header. */
  issueCount?: number;
  children: ReactNode;
}

/**
 * One configuration card: quiet ordinal, strong title, short description, a
 * divider, then the fields. Every section in the form uses this, so padding and
 * heading weight never drift between them.
 */
export function FormSection({
  id,
  number,
  title,
  description,
  issueCount = 0,
  children,
}: FormSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        'scroll-mt-24 rounded-card border bg-surface shadow-card',
        issueCount > 0 ? 'border-critical-200' : 'border-line',
      )}
    >
      <header className="flex items-start gap-3 px-5 py-4 sm:px-6 sm:py-5">
        <span
          aria-hidden="true"
          className="pu-numeric mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md bg-canvas-deep text-[11px] font-semibold text-ink-muted"
        >
          {number}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-6 text-ink" id={`${id}-title`}>
              {title}
            </h3>
            {issueCount > 0 ? (
              <Badge tone="critical">
                {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">{description}</p>
        </div>
      </header>

      <div className="border-t border-line px-5 py-5 sm:px-6 sm:py-6">{children}</div>
    </section>
  );
}

/**
 * Sub-group inside a section, for the parts of a section that are their own
 * unit of work (a rule bucket, a repeatable editor).
 */
export function FormSubsection({
  title,
  description,
  required,
  tone = 'neutral',
  action,
  children,
}: {
  title: string;
  description?: string;
  required?: boolean;
  tone?: 'neutral' | 'brand' | 'positive' | 'critical';
  action?: ReactNode;
  children: ReactNode;
}) {
  const accents: Record<string, string> = {
    neutral: 'before:bg-line-strong',
    brand: 'before:bg-brand-300',
    positive: 'before:bg-positive-200',
    critical: 'before:bg-critical-200',
  };

  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 pl-3.5',
        'before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:rounded-full',
        accents[tone],
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-ink">
            {title}
            {required ? (
              <span className="ml-0.5 font-normal text-ink-faint" aria-hidden="true">
                *
              </span>
            ) : null}
          </h4>
          {description ? (
            <p className="mt-0.5 max-w-xl text-xs leading-5 text-ink-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Responsive field grid used by every section body. */
export function FieldGrid({
  columns = 2,
  className,
  children,
}: {
  columns?: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid items-start gap-x-6 gap-y-5',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 md:grid-cols-2',
        columns === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Marks a field that should span the full grid width. */
export function FieldSpan({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-w-0 md:col-span-2 lg:col-span-full', className)}>{children}</div>;
}
