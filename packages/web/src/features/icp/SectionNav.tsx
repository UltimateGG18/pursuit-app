import { useEffect, useState } from 'react';
import { AlertIcon, CheckIcon, cn } from '../../components/ui/index.js';
import { ScrollLink } from '../../router/ScrollLink.js';
import type { SectionStatus } from './sections/section-status.js';

export interface SectionNavProps {
  statuses: readonly SectionStatus[];
}

/**
 * Tracks which section is currently in view.
 *
 * An IntersectionObserver rather than a scroll handler, so the nav costs
 * nothing while the page is still. jsdom has no observer, hence the guard.
 */
function useActiveSection(ids: readonly string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);
  const key = ids.join('|');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const sectionIds = key.split('|');
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        const first = visible[0]?.target.id;
        if (first) setActiveId(first);
      },
      // Bias the band towards the top of the viewport: the section whose
      // heading you just scrolled past is the one you are working in.
      { rootMargin: '-96px 0px -55% 0px', threshold: 0 },
    );

    for (const id of sectionIds) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);

  return activeId;
}

const STATE_LABEL: Record<SectionStatus['state'], string> = {
  complete: 'Complete',
  incomplete: 'Not complete',
  invalid: 'Needs attention',
};

/**
 * Vertical section navigation: ordinal, name, and a state marker that is never
 * carried by colour alone - complete shows a tick, invalid shows a warning
 * glyph, and both repeat the state in text for screen readers.
 */
export function SectionNav({ statuses }: SectionNavProps) {
  const activeId = useActiveSection(statuses.map((status) => status.section.id));
  const completeCount = statuses.filter((status) => status.state === 'complete').length;

  return (
    <nav aria-label="Form sections" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Sections
        </h2>
        <span className="pu-numeric text-[11px] text-ink-faint">
          {completeCount}/{statuses.length}
        </span>
      </div>

      <ol className="flex flex-col gap-0.5">
        {statuses.map(({ section, state, issueCount }) => {
          const isActive = activeId === section.id;
          return (
            <li key={section.id}>
              <ScrollLink
                targetId={section.id}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'group flex items-center gap-2.5 rounded-control px-2.5 py-2 transition-colors',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-canvas-deep',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'pu-numeric w-5 flex-none text-[11px] font-semibold',
                    isActive ? 'text-brand-600' : 'text-ink-faint',
                  )}
                >
                  {section.number}
                </span>

                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {section.title}
                </span>

                {state === 'invalid' ? (
                  <span className="flex flex-none items-center gap-1 text-critical-600">
                    <AlertIcon className="h-3.5 w-3.5" />
                    <span className="sr-only">
                      {STATE_LABEL.invalid}: {issueCount}{' '}
                      {issueCount === 1 ? 'issue' : 'issues'}
                    </span>
                  </span>
                ) : state === 'complete' ? (
                  <span className="flex flex-none items-center text-positive-600">
                    <CheckIcon className="h-3.5 w-3.5" />
                    <span className="sr-only">{STATE_LABEL.complete}</span>
                  </span>
                ) : (
                  <span
                    className={cn(
                      'h-1.5 w-1.5 flex-none rounded-full',
                      isActive ? 'bg-brand-300' : 'bg-line-strong',
                    )}
                  >
                    <span className="sr-only">{STATE_LABEL.incomplete}</span>
                  </span>
                )}
              </ScrollLink>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Horizontal variant for viewports too narrow for the rail. Same states, laid
 * out as a scrollable strip so it never forces the page to scroll sideways.
 */
export function SectionNavStrip({ statuses }: SectionNavProps) {
  return (
    <nav aria-label="Form sections" className="pu-scroll w-full max-w-full overflow-x-auto">
      <ol className="flex w-max gap-1.5 pb-1">
        {statuses.map(({ section, state, issueCount }) => (
          <li key={section.id}>
            <ScrollLink
              targetId={section.id}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                state === 'invalid'
                  ? 'border-critical-200 bg-critical-50 text-critical-700'
                  : 'border-line bg-surface text-ink-soft hover:border-line-strong',
              )}
            >
              <span aria-hidden="true" className="pu-numeric text-[11px] text-ink-faint">
                {section.number}
              </span>
              <span className="whitespace-nowrap">{section.title}</span>
              {state === 'invalid' ? (
                <>
                  <AlertIcon className="h-3 w-3" />
                  <span className="sr-only">
                    {STATE_LABEL.invalid}: {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
                  </span>
                </>
              ) : state === 'complete' ? (
                <>
                  <CheckIcon className="h-3 w-3 text-positive-600" />
                  <span className="sr-only">{STATE_LABEL.complete}</span>
                </>
              ) : (
                <span className="sr-only">{STATE_LABEL.incomplete}</span>
              )}
            </ScrollLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}
