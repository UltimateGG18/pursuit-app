import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn.js';
import { SpinnerIcon } from './icons.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction without changing the label. */
  loading?: boolean;
  /** Leading decoration; supply the meaning through the label, not the icon. */
  icon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-control border font-medium whitespace-nowrap ' +
  'transition-colors duration-100 outline-none disabled:cursor-not-allowed';

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[13px]',
  md: 'h-10 px-3.5 text-sm',
};

/**
 * Only `primary` carries the accent, so a screen never shows two equally
 * weighted calls to action.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border-brand-600 bg-brand-600 text-white shadow-xs hover:bg-brand-700 hover:border-brand-700 ' +
    'active:bg-brand-700 disabled:border-brand-300 disabled:bg-brand-300',
  secondary:
    'border-line-strong bg-surface text-ink shadow-xs hover:bg-surface-sunken ' +
    'active:bg-canvas-deep disabled:bg-surface-sunken disabled:text-ink-faint disabled:border-line',
  ghost:
    'border-transparent bg-transparent text-ink-soft hover:bg-canvas-deep hover:text-ink ' +
    'active:bg-canvas-deep disabled:text-ink-faint disabled:hover:bg-transparent',
  quiet:
    'border-transparent bg-transparent font-normal text-ink-muted underline-offset-2 hover:text-ink ' +
    'hover:underline disabled:text-ink-faint disabled:hover:no-underline',
  danger:
    'border-transparent bg-transparent text-critical-600 hover:bg-critical-50 hover:text-critical-700 ' +
    'active:bg-critical-50 disabled:text-ink-faint disabled:hover:bg-transparent',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    fullWidth,
    disabled,
    type = 'button',
    children,
    className,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, SIZES[size], VARIANTS[variant], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? <SpinnerIcon className="h-3.5 w-3.5" /> : icon}
      {children}
    </button>
  );
});
