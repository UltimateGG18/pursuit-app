import { beforeEach, describe, expect, it } from 'vitest';
import { parseRoute, routeHref, routeIcpId, ROUTES } from '../src/router/routes.js';

describe('route parsing', () => {
  it('treats an empty or unknown hash as the list', () => {
    expect(parseRoute('')).toEqual({ kind: 'list' });
    expect(parseRoute('#/')).toEqual({ kind: 'list' });
    expect(parseRoute('#/icps')).toEqual({ kind: 'list' });
    expect(parseRoute('#/somewhere-else')).toEqual({ kind: 'list' });
  });

  it('parses the create, workspace, analysis and edit routes', () => {
    expect(parseRoute('#/icps/new')).toEqual({ kind: 'create' });
    expect(parseRoute('#/icps/abc')).toEqual({ kind: 'workspace', id: 'abc', tab: 'overview' });
    expect(parseRoute('#/icps/abc/analyze')).toEqual({
      kind: 'workspace',
      id: 'abc',
      tab: 'analysis',
    });
    expect(parseRoute('#/icps/abc/edit')).toEqual({ kind: 'edit', id: 'abc' });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRoute('#/icps/abc/')).toEqual({ kind: 'workspace', id: 'abc', tab: 'overview' });
  });

  it('round-trips every route through its href', () => {
    for (const href of [
      ROUTES.list(),
      ROUTES.create(),
      ROUTES.workspace('abc'),
      ROUTES.analysis('abc'),
      ROUTES.edit('abc'),
    ]) {
      expect(routeHref(parseRoute(href))).toBe(href);
    }
  });

  it('reports the ICP a route is about', () => {
    expect(routeIcpId(parseRoute('#/icps/abc'))).toBe('abc');
    expect(routeIcpId(parseRoute('#/icps/abc/edit'))).toBe('abc');
    expect(routeIcpId(parseRoute('#/icps/new'))).toBeNull();
    expect(routeIcpId(parseRoute('#/icps'))).toBeNull();
  });
});

/**
 * Why `RouteLink` handles its own clicks instead of letting the browser follow
 * the fragment: this asserts the assumption it exists for. jsdom does not
 * perform in-page fragment navigation at all, and even where a browser does,
 * it scrolls the document to the top on every ICP switch.
 */
describe('fragment navigation is not something to rely on', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('does not happen on its own in this environment', () => {
    const anchor = document.createElement('a');
    anchor.href = '#/icps/abc';
    document.body.append(anchor);

    anchor.click();

    expect(window.location.hash).toBe('');
    anchor.remove();
  });
});
