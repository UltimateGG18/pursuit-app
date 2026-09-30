import {
  createEmptyIcpConfig,
  basicProfileSchema,
  businessProblemsSchema,
  companyProfileSchema,
  evidenceDiscoverySchema,
  geographySchema,
  mustNiceExcludeSchema,
  servicesFitSchema,
  targetBuyerSchema,
  technologySchema,
  triggersIntentSchema,
  type IcpConfig,
} from '@pursuit/shared';
import type { SectionKey } from '../useIcpForm.js';
import { SECTION_ORDER, type SectionMeta } from './section-types.js';

export type SectionState = 'complete' | 'incomplete' | 'invalid';

export interface SectionStatus {
  section: SectionMeta;
  state: SectionState;
  /** Number of validation messages currently attached to fields in this section. */
  issueCount: number;
}

/**
 * The section schemas the shared contract already exports, keyed by section.
 *
 * Reusing them is what keeps the "complete" tick honest: it means the exact
 * same rules the API enforces, evaluated over one section, rather than a
 * hand-written guess at which fields matter. Cross-section refinements are not
 * covered here, so a ticked section can still fail on submit - the save bar and
 * the field-level errors remain the authority.
 */
const SECTION_SCHEMAS: Record<SectionKey, { safeParse: (value: unknown) => { success: boolean } }> =
  {
    basicProfile: basicProfileSchema,
    geography: geographySchema,
    companyProfile: companyProfileSchema,
    technology: technologySchema,
    servicesFit: servicesFitSchema,
    businessProblems: businessProblemsSchema,
    mustNiceExclude: mustNiceExcludeSchema,
    triggersIntent: triggersIntentSchema,
    targetBuyer: targetBuyerSchema,
    evidenceDiscovery: evidenceDiscoverySchema,
  };

/** Counts the messages whose path falls inside a section. */
function countIssues(errors: Record<string, string[]>, key: SectionKey): number {
  let total = 0;
  for (const [path, messages] of Object.entries(errors)) {
    if (path === key || path.startsWith(`${key}.`) || path.startsWith(`${key}[`)) {
      total += messages.length;
    }
  }
  return total;
}

/** Key-order-independent serialization, for comparing a section to its default. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const EMPTY_SECTIONS: Record<string, string> = (() => {
  const empty = createEmptyIcpConfig();
  const snapshot: Record<string, string> = {};
  for (const section of SECTION_ORDER) {
    snapshot[section.configKey] = stableJson(empty[section.configKey]);
  }
  return snapshot;
})();

/**
 * Presentation-only status for the section navigation. Reads the draft; never
 * writes to it.
 *
 * "Complete" requires the section to both validate *and* differ from the empty
 * default. Several sections have no required fields, so a pure schema check
 * would tick them on an untouched form - a green tick has to mean the section
 * was actually filled in, or it is worse than no marker at all.
 */
export function deriveSectionStatuses(
  draft: IcpConfig,
  errors: Record<string, string[]>,
): SectionStatus[] {
  return SECTION_ORDER.map((section) => {
    const issueCount = countIssues(errors, section.configKey);
    if (issueCount > 0) return { section, state: 'invalid' as const, issueCount };

    const value = draft[section.configKey];
    const touched = stableJson(value) !== EMPTY_SECTIONS[section.configKey];
    const complete = touched && SECTION_SCHEMAS[section.configKey].safeParse(value).success;
    return {
      section,
      state: complete ? ('complete' as const) : ('incomplete' as const),
      issueCount,
    };
  });
}
