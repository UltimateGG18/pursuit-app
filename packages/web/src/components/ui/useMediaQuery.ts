import { useEffect, useState } from 'react';

/**
 * Subscribes to a media query.
 *
 * Used where a breakpoint has to change *which* element renders rather than how
 * it looks - the section navigation, for instance, must not exist twice in the
 * accessibility tree just because CSS hides one copy. Anything that only
 * changes appearance stays in Tailwind's responsive variants.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const list = window.matchMedia(query);
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `lg` breakpoint: the width at which the ICP sidebar is docked. */
export const LG_QUERY = '(min-width: 64rem)';

/** Tailwind's `xl` breakpoint: the width at which the section rail fits. */
export const XL_QUERY = '(min-width: 80rem)';
