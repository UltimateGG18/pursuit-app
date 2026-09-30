import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IcpProfileDto } from '@pursuit/shared';
import { icpApi, type ClientError } from '../../api/client.js';

export type ProfileStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseIcpProfile {
  status: ProfileStatus;
  profile: IcpProfileDto | null;
  error: ClientError | null;
  reload: () => void;
}

/**
 * The workspace's read model for one ICP.
 *
 * Deliberately separate from `useIcpForm`: the workspace only reads, so it
 * must not be able to leave a half-edited draft behind, and the form's dirty
 * state must not decide what the summary shows. Both call the same endpoint;
 * one extra GET when moving from viewing to editing is worth keeping the two
 * concerns from sharing a mutable draft.
 */
export function useIcpProfile(id: string | null): UseIcpProfile {
  const [status, setStatus] = useState<ProfileStatus>('idle');
  const [profile, setProfile] = useState<IcpProfileDto | null>(null);
  const [error, setError] = useState<ClientError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Switching ICP drops the previous one rather than briefly showing its
    // criteria under the new name.
    setProfile(null);
    setError(null);

    if (id === null) {
      setStatus('idle');
      return undefined;
    }

    setStatus('loading');
    void icpApi.get(id).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setProfile(result.data);
        setStatus('ready');
      } else {
        setError(result.error);
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [id, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return useMemo(() => ({ status, profile, error, reload }), [status, profile, error, reload]);
}
