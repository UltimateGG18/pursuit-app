import { useState } from 'react';
import type { IcpProfileDto } from '@pursuit/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  cn,
} from '../../components/ui/index.js';
import { IcpAnalysisPanel } from '../analysis/IcpAnalysisPanel.js';
import type { UseIcpAnalysis } from '../analysis/useIcpAnalysis.js';
import { ProspectResults } from '../prospects/ProspectResults.js';
import { appliedAnalysisId, type UseProspectSearch } from '../prospects/useProspectSearch.js';
import { RouteLink } from '../../router/RouteLink.js';
import { ROUTES, type WorkspaceTab } from '../../router/routes.js';
import { IcpOverview } from './IcpOverview.js';
import {
  PHASE_ROW_LABEL,
  PHASE_TONE,
  analysisPhase,
  formatDate,
  recordStatusLabel,
  recordStatusTone,
} from './icp-status.js';

export interface IcpWorkspaceProps {
  profile: IcpProfileDto;
  tab: WorkspaceTab;
  /** Owned by the page, so the header action and the panel share one run. */
  analysis: UseIcpAnalysis;
  /** Owned by the page for the same reason; see `useProspectSearch`. */
  prospects: UseProspectSearch;
  deleting: boolean;
  onEdit: () => void;
  onAnalyze: () => void;
  /** Opens the prospects view and starts a search. */
  onFindProspects: () => void;
  onDelete: () => void;
}

/**
 * The selected ICP.
 *
 * Everything the user came here to do is in the header: the name they clicked,
 * whether it has been analyzed, Edit, and Analyze. The two bodies - the
 * criteria summary and the analysis - are separate views rather than one long
 * page, so reaching a result is a click instead of a scroll past ten sections,
 * and both are addressable: `#/icps/:id` and `#/icps/:id/analyze`.
 */
export function IcpWorkspace({
  profile,
  tab,
  analysis,
  prospects,
  deleting,
  onEdit,
  onAnalyze,
  onFindProspects,
  onDelete,
}: IcpWorkspaceProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const phase = analysisPhase(analysis);
  const running = analysis.status === 'running';
  const analyzed = analysis.history.length > 0;
  const searching = prospects.status === 'searching';

  const analysisApplied = appliedAnalysisId(analysis) !== null;

  const tabs: readonly { id: WorkspaceTab; label: string; href: string }[] = [
    { id: 'overview', label: 'Overview', href: ROUTES.workspace(profile.id) },
    { id: 'analysis', label: 'Analysis', href: ROUTES.analysis(profile.id) },
    { id: 'prospects', label: 'Prospects', href: ROUTES.prospects(profile.id) },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* --- workspace header ---------------------------------------------- */}
      {/* Sticky, so Analyze and the views stay reachable while a long analysis
          is being read. `top-14` clears the application bar, and the header is
          exactly as wide as the content column - a negative margin here would
          reach across the grid gap and sit on top of the sidebar. */}
      <header className="sticky top-14 z-20 border-b border-line bg-canvas/95 pt-4 backdrop-blur">
        <RouteLink
          className="text-xs font-medium text-ink-muted transition-colors hover:text-ink"
          href={ROUTES.list()}
        >
          &larr; All ICPs
        </RouteLink>

        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold leading-7 tracking-[-0.01em] text-ink">
                {profile.name}
              </h1>
              <Badge tone="outline" className="pu-numeric">
                v{profile.version}
              </Badge>
              {profile.status === 'ACTIVE' ? null : (
                <Badge tone={recordStatusTone(profile.status)}>
                  {recordStatusLabel(profile.status)}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Created {formatDate(profile.createdAt)} &middot; updated{' '}
              {formatDate(profile.updatedAt)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <Button variant="secondary" size="sm" onClick={onEdit}>
              Edit ICP
            </Button>
            {/* One primary action for the whole page, and which one it is
                follows the view: reading prospects, the useful action is to
                search again, not to re-run the analysis behind it. Disabled for
                the entire duration of a run so a second click cannot start a
                second one - both of these spend credits. */}
            {tab === 'prospects' ? (
              <Button
                variant="primary"
                size="sm"
                loading={searching}
                disabled={searching}
                onClick={onFindProspects}
              >
                {searching ? 'Searching…' : prospects.searched ? 'Search again' : 'Find matching leads'}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                loading={running}
                disabled={analysis.status !== 'idle'}
                onClick={onAnalyze}
              >
                {running ? 'Analyzing…' : analyzed ? 'Re-analyze' : 'Analyze ICP'}
              </Button>
            )}
          </div>
        </div>

        {/* Links, not ARIA tabs: each view is a route, so back/forward and
            a copied URL land on the same view the user was looking at. */}
        <nav className="mt-3 flex items-center gap-1" aria-label="ICP views">
          {tabs.map((entry) => {
            const active = entry.id === tab;
            return (
              <RouteLink
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-t-control border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                  active
                    ? 'border-brand-600 text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink',
                )}
                href={entry.href}
                key={entry.id}
              >
                {entry.label}
                {entry.id === 'analysis' && PHASE_ROW_LABEL[phase] ? (
                  <Badge tone={PHASE_TONE[phase]}>{PHASE_ROW_LABEL[phase]}</Badge>
                ) : null}
              </RouteLink>
            );
          })}
        </nav>
      </header>

      {tab === 'overview' ? <IcpOverview config={profile.config} /> : null}

      {tab === 'analysis' ? (
        <IcpAnalysisPanel
          icpId={profile.id}
          icpName={profile.name}
          analysis={analysis}
          hideRunAction
          onFindProspects={onFindProspects}
        />
      ) : null}

      {tab === 'prospects' ? (
        <ProspectResults
          analysisApplied={analysisApplied}
          hideRunAction
          icpId={profile.id}
          icpName={profile.name}
          prospects={prospects}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={`Delete "${profile.name}"?`}
          description="This removes the ICP and its stored analyses from PURSUIT, and it will no longer be picked up by a search run. The action cannot be undone from here."
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
        />
      ) : null}
    </div>
  );
}
