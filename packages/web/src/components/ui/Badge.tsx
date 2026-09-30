import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type BadgeTone = 'neutral' | 'brand' | 'positive' | 'critical' | 'caution' | 'outline';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-canvas-deep text-ink-soft',
  brand: 'bg-brand-50 text-brand-700',
  positive: 'bg-positive-50 text-positive-700',
  critical: 'bg-critical-50 text-critical-700',
  caution: 'bg-caution-50 text-caution-700',
  outline: 'border border-line-strong bg-surface text-ink-muted',
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Uppercase micro-label, for statuses and placeholders. */
  uppercase?: boolean;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', uppercase, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
        uppercase && 'font-semibold uppercase tracking-[0.06em]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
