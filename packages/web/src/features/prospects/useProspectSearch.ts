import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PEOPLE_PER_PAGE_DEFAULT, readAnalysisOutput, type ProspectRunDto } from '@pursuit/shared';
import { prospectsApi, type ClientError } from '../../api/client.js';
import type { UseIcpAnalysis } from '../analysis/useIcpAnalysis.js';

/**
 * The analysis a prospect search may use, or null when there is none to use.
 *
 * "Readable" is the requirement, not "present": a run written under an older
 * contract carries no `buyerStrategy` to widen the title filter with, so
 * sending its id would claim an input the search did not actually have. Shared
 * by the page that starts the search and the panel that labels it, so the badge
 * and the request can never disagree about whether an analysis was applied.
 */
export function appliedAnalysisId(analysis: UseIcpAnalysis): string | null {
  const current = analysis.current;
  if (!current) return null;
  return readAnalysisOutput(current) ? current.id : null;
}

export type ProspectStatus = 'idle' | 'searching';

export interface UseProspectSearch {
  status: ProspectStatus;
  /** The page on screen, or null before the first search. */
  run: ProspectRunDto | null;
  error: ClientError | null;
  /** True once a search has completed, however many people it found. */
  searched: boolean;
  /** Runs the search. Omitting `page` starts again from the first page. */
  search: (page?: number) => Promise<void>;
  reset: () => void;
}

export interface UseProspectSearchOptions {
  /**
   * The analysis on screen, whose buyer strategy widens the title filter.
   *
   * Passed rather than looked up so the search uses the analysis the user is
   * actually reading. Omitted, the search runs on the ICP's criteria alone,
   * which is a valid search and simply a narrower one.
   */
  analysisId?: string | null;
  perPage?: number;
}

/**
 * Prospect search state for one ICP.
 *
 * Deliberately *not* modelled on `useIcpAnalysis`, which loads stored history
 * on mount: there is no stored prospect run to read back, every search costs
 * provider credits, and a search that fired because a user clicked an ICP would
 * spend one without being asked for. So nothing happens here until `search` is
 * called, and each call fetches exactly one page.
 *
 * No state library, matching the rest of the application: this is one screen's
 * state, and `useState` in the feature that owns it is the whole requirement.
 */
export function useProspectSearch(
  icpId: string | null,
  options: UseProspectSearchOptions = {},
): UseProspectSearch {
  const [status, setStatus] = useState<ProspectStatus>('idle');
  const [run, setRun] = useState<ProspectRunDto | null>(null);
  const [error, setError] = useState<ClientError | null>(null);
  const [searched, setSearched] = useState(false);

  const { analysisId, perPage = PEOPLE_PER_PAGE_DEFAULT } = options;

  /**
   * The request the state on screen belongs to.
   *
   * A search takes seconds and paging is one click, so a slow first page can
   * land after the user has asked for the second. Without this, the stale page
   * would overwrite the newer one and the pager would jump backwards.
   */
  const requestId = useRef(0);

  const search = useCallback(
    async (page = 1) => {
      if (icpId === null) return;
      const ticket = requestId.current + 1;
      requestId.current = ticket;

      setStatus('searching');
      setError(null);

      const result = await prospectsApi.search(icpId, {
        page,
        perPage,
        ...(analysisId ? { analysisId } : {}),
      });

      // A newer search has been started since; its result is the current one.
      if (requestId.current !== ticket) return;
      setStatus('idle');
      setSearched(true);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRun(result.data);
    },
    [analysisId, icpId, perPage],
  );

  /**
   * Switching ICP discards the previous one's results rather than briefly
   * showing them under the new heading - the same rule `useIcpAnalysis`
   * follows. It deliberately does *not* start a search for the new ICP: a
   * search costs provider credits, and clicking through a list of ICPs must
   * never spend them.
   */
  useEffect(() => {
    requestId.current += 1;
    setStatus('idle');
    setRun(null);
    setError(null);
    setSearched(false);
  }, [icpId]);

  const reset = useCallback(() => {
    // Invalidates any search still in flight, so its result cannot repopulate
    // the view after it was cleared.
    requestId.current += 1;
    setStatus('idle');
    setRun(null);
    setError(null);
    setSearched(false);
  }, []);

  return useMemo(
    () => ({ status, run, error, searched, search, reset }),
    [status, run, error, searched, search, reset],
  );
}
