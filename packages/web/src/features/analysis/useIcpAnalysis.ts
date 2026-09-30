import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IcpAnalysisDto } from '@pursuit/shared';
import { analysisApi, type ClientError } from '../../api/client.js';

export type AnalysisStatus = 'idle' | 'loading' | 'running';

export interface UseIcpAnalysis {
  status: AnalysisStatus;
  /** The analysis on screen: the newest stored one, or the one just produced. */
  current: IcpAnalysisDto | null;
  /** Every stored run for this ICP, newest first. */
  history: IcpAnalysisDto[];
  error: ClientError | null;
  run: () => Promise<void>;
  select: (analysisId: string) => void;
}

/**
 * Analysis state for one ICP.
 *
 * Reading is separate from running on purpose: switching to an ICP loads its
 * stored analyses, and only the explicit `run` spends a model call.
 */
export function useIcpAnalysis(icpId: string | null): UseIcpAnalysis {
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [history, setHistory] = useState<IcpAnalysisDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<ClientError | null>(null);

  /**
   * The ICP the state on screen belongs to.
   *
   * A run takes seconds, and switching ICP is one click, so a result can
   * arrive after the user has moved on. Without this, that result would be
   * filed under whichever ICP is now selected.
   */
  const activeId = useRef(icpId);

  // Switching ICP discards the previous one's results rather than briefly
  // showing them under the new heading.
  useEffect(() => {
    let cancelled = false;
    activeId.current = icpId;
    setHistory([]);
    setSelectedId(null);
    setError(null);

    if (icpId === null) {
      setStatus('idle');
      return;
    }

    setStatus('loading');
    void analysisApi.list(icpId).then((result) => {
      if (cancelled) return;
      setStatus('idle');
      if (result.ok) {
        setHistory(result.data.items);
        setSelectedId(result.data.items[0]?.id ?? null);
      } else {
        setError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [icpId]);

  const run = useCallback(async () => {
    if (icpId === null) return;
    setStatus('running');
    setError(null);

    const result = await analysisApi.run(icpId);
    // The run outlived the selection, so its result belongs to an ICP that is
    // no longer on screen. It is stored server-side either way and will be
    // read back the next time that ICP is opened.
    if (activeId.current !== icpId) return;
    setStatus('idle');

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setHistory((current) => [result.data, ...current]);
    setSelectedId(result.data.id);
  }, [icpId]);

  const select = useCallback((analysisId: string) => {
    setSelectedId(analysisId);
    setError(null);
  }, []);

  const current = useMemo(
    () => history.find((item) => item.id === selectedId) ?? null,
    [history, selectedId],
  );

  return useMemo(
    () => ({ status, current, history, error, run, select }),
    [status, current, history, error, run, select],
  );
}
