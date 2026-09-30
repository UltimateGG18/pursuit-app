import { useMemo } from 'react';
import type { IcpProfileSummaryDto } from '@pursuit/shared';
import {
  Alert,
  Badge,
  Button,
  DotIcon,
  EmptyState,
  Skeleton,
  cn,
} from '../../components/ui/index.js';
import type { ClientError } from '../../api/client.js';
import { RouteLink } from '../../router/RouteLink.js';
import { ROUTES } from '../../router/routes.js';
import {
  PHASE_ROW_LABEL,
  PHASE_TONE,
  formatDate,
  recordStatusLabel,
  recordStatusTone,
  type AnalysisPhase,
} from './icp-status.js';

export interface IcpSidebarProps {
  profiles: readonly IcpProfileSummaryDto[];
  status: 'loading' | 'ready' | 'error';
  error: ClientError | null;
  /** ICP the current route is about, highlighted as the active row. */
  selectedId: string | null;
  /** Analysis phase of the selected ICP; every other row reports `unknown`. */
  selectedPhase: AnalysisPhase;
  onRetry: () => void;
}

interface ProfileGroup {
  heading: string;
  items: IcpProfileSummaryDto[];
}

/** Active ICPs run in a search; everything else is reference material. */
function groupProfiles(profiles: readonly IcpProfileSummaryDto[]): ProfileGroup[] {
  const active = profiles.filter((profile) => profile.status === 'ACTIVE');
  const other = profiles.filter((profile) => profile.status !== 'ACTIVE');
  return [
    { heading: 'Active', items: active },
    { heading: 'Inactive', items: other },
  ].filter((group) => group.items.length > 0);
}

function IcpListItem({
  profile,
  selected,
  phase,
}: {
  profile: IcpProfileSummaryDto;
  selected: boolean;
  phase: AnalysisPhase;
}) {
  const phaseLabel = PHASE_ROW_LABEL[phase];

  return (
    <li>
      {/* A link, not a button: the row is a destination, so copy-link and
          open-in-new-tab keep working and browser history stays honest. */}
      <RouteLink
        href={ROUTES.workspace(profile.id)}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'flex items-start gap-2 rounded-control border px-2.5 py-2 transition-colors',
          selected
            ? 'border-brand-200 bg-brand-50'
            : 'border-transparent hover:border-line hover:bg-surface-sunken',
        )}
      >
        <DotIcon
          className={cn(
            'mt-1.5 h-1.5 w-1.5 flex-none',
            selected
              ? 'text-brand-600'
              : profile.status === 'ACTIVE'
                ? 'text-positive-600'
                : 'text-ink-faint',
          )}
        />

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block break-words text-[13px] font-medium leading-5',
              selected ? 'text-brand-700' : 'text-ink',
            )}
          >
            {profile.name}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* Analysis state is only shown for the ICP whose analyses have
                actually been loaded - see `AnalysisPhase`. */}
            {phaseLabel ? <Badge tone={PHASE_TONE[phase]}>{phaseLabel}</Badge> : null}
            {profile.status === 'ACTIVE' ? null : (
              <Badge tone={recordStatusTone(profile.status)}>
                {recordStatusLabel(profile.status)}
              </Badge>
            )}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="pu-numeric">v{profile.version}</span>
            <span aria-hidden="true">&middot;</span>
            <span>{profile.priority}</span>
            <span aria-hidden="true">&middot;</span>
            <span>Updated {formatDate(profile.updatedAt)}</span>
          </span>
        </span>
      </RouteLink>
    </li>
  );
}

/**
 * Persistent navigation panel for the stored ICPs.
 *
 * Compact rows and nothing else: selecting an ICP is the only thing this panel
 * does, so Edit and Delete live in the workspace header where they act on
 * something the user can actually see. That is what keeps a list of twenty
 * ICPs readable, and it is why switching ICPs is one click from anywhere.
 */
export function IcpSidebar({
  profiles,
  status,
  error,
  selectedId,
  selectedPhase,
  onRetry,
}: IcpSidebarProps) {
  const groups = useMemo(() => groupProfiles(profiles), [profiles]);

  return (
    <nav
      aria-labelledby="icp-sidebar-title"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-ink" id="icp-sidebar-title">
          ICPs
        </h2>
        {status === 'ready' && profiles.length > 0 ? (
          <span className="pu-numeric text-[11px] text-ink-faint">{profiles.length}</span>
        ) : null}
      </div>

      {status === 'loading' ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading ICPs">
          {[0, 1, 2, 3].map((row) => (
            <div className="flex flex-col gap-1.5 px-2.5 py-2" key={row}>
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      ) : null}

      {status === 'error' ? (
        <Alert tone="error" role="alert" title="Unable to load ICPs">
          <p>{error?.message ?? 'The ICP list could not be loaded.'}</p>
          {error ? <p className="mt-1 opacity-80">Error code: {error.code}</p> : null}
          <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
            Retry
          </Button>
        </Alert>
      ) : null}

      {status === 'ready' && profiles.length === 0 ? (
        <EmptyState
          title="No ICPs stored yet"
          description="Use New ICP in the bar above to create the first one."
        />
      ) : null}

      {groups.map((group) => (
        <div className="flex flex-col gap-1.5" key={group.heading}>
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              {group.heading}
            </h3>
            <span className="h-px flex-1 bg-line" aria-hidden="true" />
          </div>

          <ul className="flex flex-col gap-1">
            {group.items.map((profile) => (
              <IcpListItem
                key={profile.id}
                profile={profile}
                selected={profile.id === selectedId}
                phase={profile.id === selectedId ? selectedPhase : 'unknown'}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
