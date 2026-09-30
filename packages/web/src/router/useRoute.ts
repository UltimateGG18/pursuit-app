import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseRoute, type Route } from './routes.js';

export interface Router {
  route: Route;
  /** Current href, so a link can compare itself against it. */
  href: string;
  navigate: (href: string, options?: { replace?: boolean }) => void;
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

/**
 * The application's single router instance.
 *
 * Called once, at the top of the tree, and passed down: two independent
 * instances would each hold their own copy of the hash and could disagree for
 * a frame. Sidebar rows are plain `<a href="#/icps/...">` links, so most
 * navigation never reaches `navigate` at all - it arrives as `hashchange`,
 * which is also what makes browser back/forward work for free.
 */
export function useRoute(): Router {
  const [hash, setHash] = useState(currentHash);

  useEffect(() => {
    const onHashChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);

    // Normalize a bare URL once, with `replaceState` rather than by assigning
    // the hash: the first entry in the history stack should be a real route,
    // not a blank one the user can press Back into.
    if (!window.location.hash.startsWith('#/')) {
      window.history.replaceState(null, '', '#/icps');
      setHash('#/icps');
    }

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((target: string, options?: { replace?: boolean }) => {
    if (typeof window === 'undefined') return;
    const next = target.startsWith('#') ? target : `#${target}`;
    if (window.location.hash === next) return;

    if (options?.replace) {
      window.history.replaceState(null, '', next);
    } else {
      window.location.hash = next;
    }
    // `hashchange` is queued as a task, so the state is set here as well to
    // keep a navigation and the render that follows it in the same tick.
    setHash(next);
  }, []);

  const route = useMemo(() => parseRoute(hash), [hash]);

  return useMemo(() => ({ route, href: hash, navigate }), [route, hash, navigate]);
}
