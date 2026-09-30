import '@testing-library/jest-dom/vitest';

/**
 * jsdom ships no `matchMedia`, so every `useMediaQuery` would answer `false`
 * and the suite would silently exercise the narrow layout only - the ICP
 * sidebar would live behind the mobile drawer and the form's section rail
 * would never render. PURSUIT is a desktop workspace first, so the stub
 * answers for a desktop viewport and evaluates the one query form the UI
 * writes: `(min-width: <n>rem)`.
 */
const VIEWPORT_WIDTH_PX = 1440;

function evaluateQuery(query: string): boolean {
  const match = /\(min-width:\s*([\d.]+)(rem|px)\)/.exec(query);
  const rawValue = match?.[1];
  if (rawValue === undefined) return false;
  const value = Number(rawValue);
  const pixels = match?.[2] === 'rem' ? value * 16 : value;
  return VIEWPORT_WIDTH_PX >= pixels;
}

window.matchMedia = (query: string): MediaQueryList => ({
  media: query,
  matches: evaluateQuery(query),
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
});

/**
 * jsdom implements no layout, so it ships no `scrollIntoView` either - and
 * `ScrollLink` calls it on every in-page jump. Without this, any test that
 * clicks a section link or an analysis anchor throws inside a React event
 * handler, which surfaces as an unhandled error and fails the whole run
 * regardless of the assertions.
 *
 * Stubbed rather than guarded at the call site: scrolling is a real behaviour
 * of the component and the production path should not carry a check for a
 * method every browser has.
 */
Element.prototype.scrollIntoView = () => undefined;
