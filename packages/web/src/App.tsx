import { useCallback, useEffect } from 'react';
import { AppShell } from './components/layout/AppShell.js';
import { Alert, Button, EmptyState, Skeleton, Toast } from './components/ui/index.js';
import { useIcpAnalysis } from './features/analysis/useIcpAnalysis.js';
import {
  appliedAnalysisId,
  useProspectSearch,
} from './features/prospects/useProspectSearch.js';
import { IcpForm } from './features/icp/IcpForm.js';
import { IcpSidebar } from './features/icp/IcpSidebar.js';
import { IcpWorkspace } from './features/icp/IcpWorkspace.js';
import { analysisPhase } from './features/icp/icp-status.js';
import { useIcpForm } from './features/icp/useIcpForm.js';
import { useIcpProfile } from './features/icp/useIcpProfile.js';
import { RouterProvider } from './router/RouteLink.js';
import { ROUTES, routeHref, routeIcpId } from './router/routes.js';
import { useRoute } from './router/useRoute.js';

/** Body of `#/icps`, where the sidebar is the page. */
function SelectPrompt({ hasProfiles, onCreate }: { hasProfiles: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      {hasProfiles ? (
        <EmptyState
          variant="inline"
          title="Select an ICP"
          description="Pick an ICP from the list to see its criteria, run an analysis and read the results."
        />
      ) : (
        <EmptyState
          variant="inline"
          title="No ICPs yet"
          description="Create your first Ideal Customer Profile to start prospect intelligence."
          action={
            <Button variant="primary" onClick={onCreate}>
              Create ICP
            </Button>
          }
        />
      )}
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div
      aria-label="Loading ICP"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-card"
      role="status"
    >
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

/**
 * PURSUIT.
 *
 * The route is the application state: which ICP is selected, and whether the
 * user is reading its criteria, reading its analysis, or editing it. Every
 * screen below is derived from that, which is what makes refresh,
 * back/forward and a shared link all land where the user actually was.
 */
export function App() {
  const { route, navigate } = useRoute();
  const form = useIcpForm();

  const routeKind = route.kind;
  const selectedId = routeIcpId(route);

  // The workspace reads the stored profile; the form loads its own copy into a
  // draft, so a half-finished edit can never change what the summary shows.
  const viewedProfile = useIcpProfile(route.kind === 'workspace' ? route.id : null);
  // Owned here, so the workspace header, the analysis panel and the sidebar
  // row all describe the same run.
  const analysis = useIcpAnalysis(selectedId);
  /**
   * Owned here for the same reason the analysis is: the workspace header, the
   * analysis panel's handoff and the results panel all act on one search.
   *
   * The analysis id is passed in rather than looked up inside the hook, so the
   * search widens its title filter with the analysis the user is actually
   * reading - and drops back to the ICP's own criteria when that run is from an
   * older contract this build cannot read.
   */
  const prospects = useProspectSearch(selectedId, {
    analysisId: appliedAnalysisId(analysis),
  });

  const { startCreate, startEdit, deleteProfile, refreshProfiles } = form;
  const profile = viewedProfile.profile;

  // Route -> form. `create` seeds an empty draft, `edit` loads the stored ICP.
  // Both callbacks are stable, so this runs on navigation and nothing else.
  useEffect(() => {
    if (routeKind === 'create') {
      startCreate();
      return;
    }
    if (routeKind === 'edit' && selectedId !== null) {
      void startEdit(selectedId);
    }
  }, [routeKind, selectedId, startCreate, startEdit]);

  const openCreate = useCallback(() => navigate(ROUTES.create()), [navigate]);

  const onAnalyze = useCallback(() => {
    if (selectedId === null) return;
    // Switch to the result view first, so the run reports its progress where
    // the result will appear rather than behind a view the user has to find.
    navigate(ROUTES.analysis(selectedId));
    void analysis.run();
  }, [analysis, navigate, selectedId]);

  const onFindProspects = useCallback(() => {
    if (selectedId === null) return;
    // Switch to the results view first, so the search reports its progress
    // where the results will appear rather than behind a view to be found.
    navigate(ROUTES.prospects(selectedId));
    void prospects.search();
  }, [navigate, prospects, selectedId]);

  const onDelete = useCallback(() => {
    if (selectedId === null) return;
    void deleteProfile(selectedId).then((removed) => {
      // A failed delete leaves the user on the ICP, where the error is shown.
      if (removed) navigate(ROUTES.list());
    });
  }, [deleteProfile, navigate, selectedId]);

  const onCancelForm = useCallback(() => {
    navigate(
      routeKind === 'edit' && selectedId !== null ? ROUTES.workspace(selectedId) : ROUTES.list(),
    );
  }, [navigate, routeKind, selectedId]);

  /** Name for the compact sidebar trigger below `lg`. */
  const selectionLabel =
    routeKind === 'create'
      ? 'New ICP'
      : (profile?.name ??
        form.profiles.find((summary) => summary.id === selectedId)?.name ??
        null);

  return (
    <RouterProvider navigate={navigate}>
      <AppShell
        onCreate={openCreate}
        routeKey={routeHref(route)}
        selectionLabel={selectionLabel}
        sidebar={
          <IcpSidebar
            error={form.listError}
            onRetry={() => void refreshProfiles()}
            profiles={form.profiles}
            selectedId={selectedId}
            selectedPhase={analysisPhase(analysis)}
            status={form.listStatus}
          />
        }
      >
        {route.kind === 'list' ? (
          <SelectPrompt hasProfiles={form.profiles.length > 0} onCreate={openCreate} />
        ) : null}

        {route.kind === 'create' || route.kind === 'edit' ? (
          <IcpForm
            form={form}
            onCancel={onCancelForm}
            onSaved={(id) => navigate(ROUTES.workspace(id))}
          />
        ) : null}

        {route.kind === 'workspace' ? (
          viewedProfile.status === 'error' ? (
            <Alert tone="error" role="alert" title="Unable to load this ICP">
              <p>{viewedProfile.error?.message ?? 'The ICP could not be loaded.'}</p>
              {viewedProfile.error ? (
                <p className="mt-1 opacity-80">Error code: {viewedProfile.error.code}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={viewedProfile.reload}>
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.list())}>
                  Back to ICPs
                </Button>
              </div>
            </Alert>
          ) : profile === null ? (
            <WorkspaceSkeleton />
          ) : (
            <IcpWorkspace
              analysis={analysis}
              deleting={form.status === 'deleting'}
              onAnalyze={onAnalyze}
              onDelete={onDelete}
              onEdit={() => navigate(ROUTES.edit(profile.id))}
              onFindProspects={onFindProspects}
              profile={profile}
              prospects={prospects}
              tab={route.tab}
            />
          )
        ) : null}
      </AppShell>

      {form.successMessage ? (
        <Toast
          tone="success"
          title={form.successMessage}
          messageKey={form.successMessage}
          description="The ICP list is up to date."
        />
      ) : null}
    </RouterProvider>
  );
}
