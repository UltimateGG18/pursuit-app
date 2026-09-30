import {
  Badge,
  ChevronDownIcon,
  POPOVER_PANEL_CLASS,
  UserIcon,
  cn,
  usePopover,
} from './ui/index.js';

/**
 * Account control in the application bar.
 *
 * There is no authentication in this slice, so the avatar shows a generic
 * glyph rather than inventing a signed-in identity, and the panel says plainly
 * that accounts are not wired up yet. That honesty is the job the "Day 1
 * slice" badge used to do in this corner of the header.
 */
export function AccountMenu() {
  const { open, containerRef, openPopover, closePopover } = usePopover(200);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        data-popover-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Account"
        className={cn(
          'flex items-center gap-1.5 rounded-full border p-0.5 pr-1.5 transition-colors',
          open
            ? 'border-line-strong bg-surface-sunken'
            : 'border-transparent hover:border-line hover:bg-surface-sunken',
        )}
        onClick={() => (open ? closePopover() : openPopover())}
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-canvas-deep text-ink-muted"
        >
          <UserIcon className="h-4 w-4" />
        </span>
        <ChevronDownIcon
          className={cn(
            'h-3.5 w-3.5 flex-none text-ink-faint transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Account"
          className={cn(POPOVER_PANEL_CLASS, 'right-0 top-full mt-2 w-64')}
        >
          <div className="flex items-start gap-2.5 px-3.5 py-3">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-canvas-deep text-ink-muted"
            >
              <UserIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">Not signed in</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">
                Accounts and permissions arrive in a later slice.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-subtle px-3.5 py-2">
            <span className="text-[11px] text-ink-muted">Sign-in</span>
            <Badge tone="caution" uppercase>
              Placeholder
            </Badge>
          </div>
        </div>
      ) : null}
    </div>
  );
}
