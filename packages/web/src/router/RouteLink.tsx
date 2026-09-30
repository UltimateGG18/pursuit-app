import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

export type NavigateFn = (href: string, options?: { replace?: boolean }) => void;

const NavigateContext = createContext<NavigateFn | null>(null);

export function RouterProvider({
  navigate,
  children,
}: {
  navigate: NavigateFn;
  children: ReactNode;
}) {
  return <NavigateContext.Provider value={navigate}>{children}</NavigateContext.Provider>;
}

export function useNavigate(): NavigateFn {
  const navigate = useContext(NavigateContext);
  if (!navigate) throw new Error('useNavigate must be used inside a RouterProvider');
  return navigate;
}

/** A click the browser should own: new tab, new window, download, middle-click. */
function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

export interface RouteLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  replace?: boolean;
}

/**
 * An internal link.
 *
 * The `href` is real, so copy-link, middle-click and "open in new tab" behave
 * the way a user expects from a link, but a plain click is handled here rather
 * than left to the browser's fragment navigation - that keeps the route change
 * and the render in one tick, and stops the page from jumping to the top of
 * the document on every ICP switch.
 */
export function RouteLink({ href, replace, onClick, children, ...rest }: RouteLinkProps) {
  const navigate = useNavigate();

  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || isModifiedClick(event)) return;
        event.preventDefault();
        navigate(href, replace === true ? { replace: true } : undefined);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
