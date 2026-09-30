import { cn } from './cn.js';

export interface SkeletonProps {
  className?: string;
}

/**
 * Placeholder block for content that is on its way.
 *
 * Purely decorative and always `aria-hidden`: the loading state itself is
 * announced by the `role="status"` region that wraps a group of these, so a
 * screen reader hears "Loading ICPs" once instead of six empty boxes.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('block animate-pulse rounded bg-canvas-deep', className ?? 'h-4 w-full')}
    />
  );
}
