/**
 * Application routes.
 *
 * Hash based, and deliberately without a router library: the whole map is five
 * routes, so `#/icps/:id` costs a parser and a `hashchange` listener rather
 * than a dependency plus a history fallback in every place the build is
 * served. What matters is that the selected ICP lives in the URL - refresh,
 * back/forward, deep links and "send me that ICP" all work because of it.
 */
export type WorkspaceTab = 'overview' | 'analysis' | 'prospects';

export type Route =
  /** No ICP selected: the sidebar is the page. */
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'workspace'; id: string; tab: WorkspaceTab }
  | { kind: 'edit'; id: string };

/**
 * The only place a URL is written. Every link and every navigation goes
 * through one of these, so a route change is never spelled out twice.
 */
export const ROUTES = {
  list: (): string => '#/icps',
  create: (): string => '#/icps/new',
  workspace: (id: string): string => `#/icps/${id}`,
  analysis: (id: string): string => `#/icps/${id}/analyze`,
  prospects: (id: string): string => `#/icps/${id}/prospects`,
  edit: (id: string): string => `#/icps/${id}/edit`,
} as const;

/** Anything unrecognized resolves to the list rather than to a dead screen. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = path.length === 0 ? [] : path.split('/');

  if (segments[0] !== 'icps') return { kind: 'list' };

  const id = segments[1];
  if (id === undefined || id.length === 0) return { kind: 'list' };
  if (id === 'new') return { kind: 'create' };

  const leaf = segments[2];
  if (leaf === 'edit') return { kind: 'edit', id };
  if (leaf === 'analyze') return { kind: 'workspace', id, tab: 'analysis' };
  if (leaf === 'prospects') return { kind: 'workspace', id, tab: 'prospects' };
  return { kind: 'workspace', id, tab: 'overview' };
}

/** Canonical href for a route, used to highlight the active sidebar row. */
export function routeHref(route: Route): string {
  switch (route.kind) {
    case 'create':
      return ROUTES.create();
    case 'workspace':
      if (route.tab === 'analysis') return ROUTES.analysis(route.id);
      if (route.tab === 'prospects') return ROUTES.prospects(route.id);
      return ROUTES.workspace(route.id);
    case 'edit':
      return ROUTES.edit(route.id);
    case 'list':
    default:
      return ROUTES.list();
  }
}

/** The ICP a route is about, if it is about one. */
export function routeIcpId(route: Route): string | null {
  return route.kind === 'workspace' || route.kind === 'edit' ? route.id : null;
}
