/** Stable de-duplication that preserves first-seen order. */
export function uniqueStrings<T extends string>(values: readonly T[] | undefined): T[] {
  if (!values) return [];
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Sorted + de-duplicated, used for option-list fields so payloads are canonical. */
export function canonicalizeEnumList<T extends string>(
  values: readonly T[] | undefined,
  order: readonly T[],
): T[] {
  const unique = uniqueStrings(values);
  const rank = new Map<T, number>(order.map((value, index) => [value, index]));
  return unique.sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER));
}

export function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** URL/lookup friendly key derived from the ICP name. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
