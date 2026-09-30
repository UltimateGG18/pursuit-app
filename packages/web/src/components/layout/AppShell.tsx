import { useEffect, useState, type ReactNode } from 'react';
import { AccountMenu } from '../AccountMenu.js';
import { ScrollLink } from '../../router/ScrollLink.js';
import {
  Button,
  ChevronDownIcon,
  CloseIcon,
  LG_QUERY,
  PlusIcon,
  useMediaQuery,
} from '../ui/index.js';

export interface AppShellProps {
  /** The ICP navigation panel; rendered docked or inside the mobile drawer. */
  sidebar: ReactNode;
  /** Current route href. A change closes the mobile drawer. */
  routeKey: string;
  /** Name of the ICP in view, shown on the mobile drawer trigger. */
  selectionLabel: string | null;
  onCreate: () => void;
  children: ReactNode;
}

/**
 * Application frame: bar, ICP navigation, main content.
 *
 * The sidebar is rendered once, never twice: below `lg` it moves into a
 * drawer rather than being duplicated and hidden with CSS, so the ICP list
 * appears exactly once in the accessibility tree and the focus order stays
 * predictable. Above `lg` it is docked and sticky - switching ICPs while
 * reading an analysis stays a single click.
 */
export function AppShell({
  sidebar,
  routeKey,
  selectionLabel,
  onCreate,
  children,
}: AppShellProps) {
  const docked = useMediaQuery(LG_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Navigating is the whole point of the drawer, so a route change dismisses
  // it. Widening the viewport past `lg` docks the sidebar and closes it too.
  useEffect(() => setDrawerOpen(false), [routeKey]);
  useEffect(() => {
    if (docked) setDrawerOpen(false);
  }, [docked]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-canvas">
      <ScrollLink
        targetId="main"
        focusTarget
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:shadow-popover"
      >
        Skip to content
      </ScrollLink>

      {/* --- application bar ------------------------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[110rem] items-center gap-3 px-4 lg:px-8">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-brand-600 text-[13px] font-bold text-white"
          >
            P
          </span>
          <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-ink">
            Pursuit
          </span>
          <span className="hidden h-4 w-px bg-line sm:block" aria-hidden="true" />
          <span className="hidden text-xs text-ink-muted sm:block">Prospect intelligence</span>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<PlusIcon className="h-3.5 w-3.5" />}
              onClick={onCreate}
            >
              <span className="hidden sm:inline">New ICP</span>
              <span className="sm:hidden">New</span>
            </Button>
            <AccountMenu />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[110rem] px-4 pb-28 pt-4 sm:pb-10 lg:px-8">
        {docked ? (
          <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] xl:gap-8">
            <div className="min-w-0 lg:sticky lg:top-20">{sidebar}</div>
            <main className="min-w-0" id="main" tabIndex={-1}>
              {children}
            </main>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            {/* Compact ICP selector, standing in for the docked panel. */}
            <button
              type="button"
              aria-expanded={drawerOpen}
              aria-haspopup="dialog"
              className="flex items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-2 text-left shadow-xs"
              onClick={() => setDrawerOpen(true)}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                ICP
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {selectionLabel ?? 'Select an ICP'}
              </span>
              <ChevronDownIcon className="h-3.5 w-3.5 flex-none text-ink-faint" />
            </button>

            <main className="min-w-0" id="main" tabIndex={-1}>
              {children}
            </main>
          </div>
        )}
      </div>

      {!docked && drawerOpen ? (
        <div className="fixed inset-0 z-40 flex">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            role="dialog"
            aria-label="ICPs"
            aria-modal="true"
            className="relative ml-auto flex h-full w-[19rem] max-w-[85vw] flex-col overflow-y-auto bg-canvas p-3 shadow-popover"
          >
            <div className="mb-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close ICP list"
                onClick={() => setDrawerOpen(false)}
              >
                <CloseIcon className="h-4 w-4" />
              </Button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}
    </div>
  );
}
