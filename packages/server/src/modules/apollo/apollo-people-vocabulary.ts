import {
  DEPARTMENTS,
  SENIORITIES,
  TARGET_TITLE_OPTIONS,
  type Department,
  type Seniority,
  type TargetTitle,
} from '@pursuit/shared';

/**
 * Translation between PURSUIT's buyer catalogs and Apollo's *people* filter
 * vocabulary.
 *
 * The people counterpart to `apollo-vocabulary.ts`, and it exists for the same
 * reason: the criteria contract stores internal enums (`C_LEVEL`, `VP_IT`)
 * while Apollo filters on its own controlled values (`c_suite`) and on free
 * text titles (`VP IT`). Somebody has to bridge that and it has to be the
 * adapter.
 *
 * Every map below is an exhaustive `Record` over its catalog, so adding a
 * seniority, a title or a department to `@pursuit/shared` fails the build here
 * until its Apollo translation is decided. A silently untranslated value would
 * drop a filter and quietly widen the search - which is the failure mode that
 * looks like a working search returning the wrong people.
 */

/**
 * Internal seniority -> Apollo `person_seniorities[]`.
 *
 * Apollo's documented vocabulary for this filter is a closed list: `owner`,
 * `founder`, `c_suite`, `partner`, `vp`, `head`, `director`, `manager`,
 * `senior`, `entry`, `intern`. Sending anything outside it is silently ignored
 * by Apollo, which is why this is a `Record` and not a `toLowerCase()`.
 *
 * `INDIVIDUAL_CONTRIBUTOR` maps to `senior` rather than to `entry`: the ICP
 * form offers it for staff engineers and architects who evaluate technology,
 * not for graduates, and `entry` would systematically return the wrong people.
 * `LEAD` maps to `manager` for the same reason - Apollo has no lead tier, and
 * `senior` would lose the people-management signal a lead role carries.
 */
const APOLLO_SENIORITIES: Readonly<Record<Seniority, string>> = {
  C_LEVEL: 'c_suite',
  VP: 'vp',
  DIRECTOR: 'director',
  HEAD: 'head',
  MANAGER: 'manager',
  LEAD: 'manager',
  INDIVIDUAL_CONTRIBUTOR: 'senior',
};

export function toApolloSeniorities(seniorities: readonly string[]): string[] {
  const out = new Set<string>();
  for (const seniority of seniorities) {
    const mapped = APOLLO_SENIORITIES[seniority as Seniority];
    // A value outside the catalog is skipped rather than passed through: the
    // query is built from validated criteria, so this can only be a bug, and
    // forwarding an unknown value to Apollo silently drops the filter.
    if (mapped !== undefined) out.add(mapped);
  }
  return [...out];
}

/**
 * Apollo's seniority label -> the internal `SENIORITIES` values it covers.
 *
 * The reverse of `APOLLO_SENIORITIES`, derived from that map rather than
 * restated, so the two cannot disagree. It is what lets a hard seniority filter
 * compare a returned person against the criteria without the filter knowing
 * anything about Apollo.
 *
 * The reverse is genuinely many-to-one in two places, and the list return is
 * how that is handled honestly rather than by guessing:
 *
 *  - `manager` covers our MANAGER **and** our LEAD, because Apollo has no lead
 *    tier and the forward map sends both there.
 *  - `senior` covers INDIVIDUAL_CONTRIBUTOR.
 *
 * Apollo's `owner`, `founder`, `partner`, `entry` and `intern` are outside our
 * catalog entirely and map to nothing. That returns an empty list, which the
 * filter reads as *unknown seniority* and keeps - the only safe direction,
 * since rejecting a founder because our catalog has no word for one would be a
 * false negative invented by a vocabulary gap.
 */
const SENIORITIES_BY_APOLLO_VALUE: ReadonlyMap<string, readonly Seniority[]> = (() => {
  const map = new Map<string, Seniority[]>();
  for (const seniority of SENIORITIES) {
    const apollo = APOLLO_SENIORITIES[seniority];
    const bucket = map.get(apollo);
    if (bucket) bucket.push(seniority);
    else map.set(apollo, [seniority]);
  }
  return map;
})();

export function toSeniorityCodes(value: string | undefined): Seniority[] {
  if (value === undefined) return [];
  const key = value.trim().toLowerCase();
  if (key.length === 0) return [];
  return [...(SENIORITIES_BY_APOLLO_VALUE.get(key) ?? [])];
}

/**
 * Internal title -> Apollo `person_titles[]`.
 *
 * Apollo matches these as free text against a person's current job title, so
 * the translation is simply the human form of each catalog entry - and that
 * form already exists, as the label the ICP form shows for the same option.
 * Deriving it from `TARGET_TITLE_OPTIONS` rather than restating it here means
 * the search asks for exactly the title the user saw themselves select, and a
 * relabelled option cannot drift away from the filter it produces.
 */
const APOLLO_TITLES: Readonly<Record<string, string>> = Object.fromEntries(
  TARGET_TITLE_OPTIONS.map((option) => [option.value, option.label]),
);

export function toApolloTitle(title: TargetTitle): string | undefined {
  return APOLLO_TITLES[title];
}

/**
 * Titles for one search, from catalog values and free-text roles combined.
 *
 * Apollo ORs `person_titles[]`, so adding the analysis's buyer roles widens
 * recall rather than narrowing it - which is the correct direction for a
 * discovery stage. De-duplicated case-insensitively, because "CTO" from the
 * catalog and "CTO" from a model are one filter, and keeping both would only
 * lengthen the request.
 */
export function toApolloTitles(
  titles: readonly string[],
  freeTextTitles: readonly string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (value: string | undefined): void => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  for (const title of titles) add(APOLLO_TITLES[title]);
  for (const title of freeTextTitles) add(title);
  return out;
}

/**
 * Internal department -> Apollo `person_department_or_subdepartments[]`.
 *
 * Apollo's department taxonomy is a closed list of master departments with
 * sub-departments beneath them. Six of our twelve map onto one cleanly; the
 * rest are `undefined` on purpose, and the caller reports them as unsupported
 * rather than approximating:
 *
 *  - **DATA** is not a master department in Apollo's taxonomy - data roles sit
 *    under engineering, under product and under operations depending on the
 *    company. Mapping it to `engineering` would quietly exclude the data leads
 *    who sit elsewhere, which is worse than not filtering on department at all
 *    while the title filter is still doing its job.
 *  - **PROCUREMENT** likewise spans operations and finance in Apollo's data.
 *  - **EXECUTIVE** has no department: Apollo expresses it as the `c_suite`
 *    *seniority*, which `toApolloSeniorities` already sends. Adding a
 *    department here would AND with that and return nobody.
 *  - **IT** and **ENGINEERING** both land on `information_technology`, which is
 *    Apollo's single master department covering both. That is a widening, not a
 *    loss, and the title filter separates them.
 *
 * The honest consequence is that a department is a *weak* filter in this
 * adapter, and the run reports exactly which ones were dropped.
 */
const APOLLO_DEPARTMENTS: Readonly<Record<Department, string | undefined>> = {
  EXECUTIVE: undefined,
  ENGINEERING: 'information_technology',
  IT: 'information_technology',
  PRODUCT: 'product_management',
  DATA: undefined,
  OPERATIONS: 'operations',
  FINANCE: 'finance',
  PROCUREMENT: undefined,
  MARKETING: 'marketing',
  SALES: 'sales',
  HR: 'human_resources',
  LEGAL_COMPLIANCE: 'legal',
};

export interface ApolloDepartmentTranslation {
  /** Apollo values to send, de-duplicated. */
  readonly departments: string[];
  /** Internal departments with no Apollo equivalent, in catalog form. */
  readonly untranslated: string[];
}

export function toApolloDepartments(departments: readonly string[]): ApolloDepartmentTranslation {
  const out = new Set<string>();
  const untranslated: string[] = [];

  for (const department of departments) {
    const mapped = APOLLO_DEPARTMENTS[department as Department];
    if (mapped === undefined) {
      untranslated.push(department);
      continue;
    }
    out.add(mapped);
  }
  return { departments: [...out], untranslated };
}

/**
 * Apollo's department label -> the internal `DEPARTMENTS` values it covers.
 *
 * Derived from `APOLLO_DEPARTMENTS` for the same reason, and many-to-one in the
 * same way: `information_technology` is Apollo's single master department for
 * both our ENGINEERING and our IT, so it maps back to both.
 *
 * Apollo also returns *sub*-departments - `devops`, `data_science` - which the
 * forward map never sends and which therefore map to nothing here. An empty
 * list is unknown, not a mismatch, so a data engineer is never rejected for
 * sitting in a sub-department our catalog does not name.
 */
const DEPARTMENTS_BY_APOLLO_VALUE: ReadonlyMap<string, readonly Department[]> = (() => {
  const map = new Map<string, Department[]>();
  for (const department of DEPARTMENTS) {
    const apollo = APOLLO_DEPARTMENTS[department];
    if (apollo === undefined) continue;
    const bucket = map.get(apollo);
    if (bucket) bucket.push(department);
    else map.set(apollo, [department]);
  }
  return map;
})();

export function toDepartmentCodes(value: string | undefined): Department[] {
  if (value === undefined) return [];
  const key = value.trim().toLowerCase();
  if (key.length === 0) return [];
  return [...(DEPARTMENTS_BY_APOLLO_VALUE.get(key) ?? [])];
}
