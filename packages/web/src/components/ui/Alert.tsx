import type { ReactNode } from 'react';
import { cn } from './cn.js';
import { AlertIcon, CheckIcon, InfoIcon } from './icons.js';

export type AlertTone = 'info' | 'success' | 'error';

const TONES: Record<AlertTone, { frame: string; icon: string }> = {
  info: { frame: 'border-brand-200 bg-brand-50 text-brand-700', icon: 'text-brand-600' },
  success: {
    frame: 'border-positive-200 bg-positive-50 text-positive-700',
    icon: 'text-positive-600',
  },
  error: {
    frame: 'border-critical-200 bg-critical-50 text-critical-700',
    icon: 'text-critical-600',
  },
};

const ICONS: Record<AlertTone, typeof InfoIcon> = {
  info: InfoIcon,
  success: CheckIcon,
  error: AlertIcon,
};

export interface AlertProps {
  tone: AlertTone;
  title: string;
  /** `alert` interrupts; `status` is announced politely. */
  role?: 'alert' | 'status';
  children?: ReactNode;
  className?: string;
}

/**
 * Inline notice used for messages that belong to the page rather than to a
 * single field - a validation summary or an API failure.
 */
export function Alert({ tone, title, role = 'status', children, className }: AlertProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={role}
      className={cn('flex gap-2.5 rounded-control border px-3.5 py-3', TONES[tone].frame, className)}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 flex-none', TONES[tone].icon)} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{title}</p>
        {children ? <div className="mt-1 text-xs leading-5 opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
