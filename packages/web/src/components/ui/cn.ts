/**
 * Joins class names, dropping anything falsy.
 *
 * Deliberately tiny: the components in this folder compose a fixed set of
 * Tailwind classes with a handful of conditional ones, so there is nothing to
 * de-duplicate and no need for a class-merging dependency.
 */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}
