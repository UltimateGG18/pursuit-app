import {
  PEOPLE_PER_PAGE_DEFAULT,
  PEOPLE_PAGE_MIN,
  uniqueStrings,
  type IcpAnalysisOutput,
  type IcpConfig,
  type PeopleQuery,
} from '@pursuit/shared';

/**
 * ICP -> internal people query.
 *
 * The dedicated mapping step the prospect flow is built around, and the reason
 * it is a function in the domain rather than logic inside a component or inside
 * the Apollo adapter:
 *
 *  - a **component** doing this would put targeting rules in the browser,
 *    where they cannot be tested without a DOM, cannot be reused by a job, and
 *    would have to be duplicated the moment anything else needed prospects;
 *  - the **adapter** doing this would mean the mapping only exists for Apollo,
 *    and a second people provider would start by reimplementing it.
 *
 * So the translation happens twice, deliberately, at two different seams:
 * `mapIcpToPeopleQuery` turns criteria into the provider-neutral `PeopleQuery`
 * here, and `translatePeopleQuery` turns that into one provider's own filters
 * inside the adapter. Nothing in this file names a provider.
 *
 * ## Why only part of the ICP is used
 *
 * The ICP carries far more than this: must-have rules, triggers, evidence
 * thresholds, scoring weights, excluded technologies. None of it belongs in a
 * provider query. A must-have rule is a *filter*, applied after normalization
 * so a person with unknown data can be handled deliberately rather than never
 * being retrieved at all; a trigger is a signal gathered during qualification.
 * Pushing either into the provider query would trade recall for a filter the
 * pipeline is going to apply anyway - invisibly, and against whatever subset
 * the provider happens to support.
 *
 * What is left is the honest recall envelope for people: who they are
 * (`targetBuyer`), and which companies they work at (`geography`,
 * `companyProfile`).
 */

/**
 * Longest analysis-derived role that is worth sending as a title filter.
 *
 * Provider title filters match against a person's actual job title, so
 * "VP of Engineering" finds people and "VP of Engineering at a mid-market
 * manufacturer undergoing ERP replacement" - a perfectly good sentence for the
 * analysis to have produced - matches nobody. The cap drops the prose and keeps
 * the titles, rather than sending a filter that can only ever return zero.
 */
const MAX_ANALYSIS_TITLE_LENGTH = 60;

/**
 * How many analysis-derived titles may widen one search.
 *
 * The catalog titles are the user's own choice and are never capped. These are
 * a model's inference, they OR into the same filter, and past a handful they
 * stop adding buyers and start adding noise to a request that costs a credit.
 */
const MAX_ANALYSIS_TITLES = 8;

export interface MapIcpToPeopleQueryOptions {
  /** 1-based page of the provider's result set. */
  readonly page?: number;
  readonly perPage?: number;
  /**
   * A completed analysis whose buyer strategy should widen the title list.
   *
   * Optional, and opt-in from the caller. The analysis is a model's inference
   * about *roles* - "Head of Digital Transformation" - which the ICP's
   * controlled title catalog cannot express, so it genuinely adds reach. It is
   * never allowed to *narrow* anything: it contributes titles and nothing else,
   * so a search with an analysis always returns a superset of the same search
   * without one.
   */
  readonly analysis?: IcpAnalysisOutput | null;
}

/**
 * Buyer roles from an analysis, as title filters.
 *
 * Exported so the rule that decides which roles survive is testable on its own -
 * it is the one place in this mapping where model prose meets a provider
 * filter, and it is where a bad answer would quietly cost a search its results.
 */
export function analysisTitles(analysis: IcpAnalysisOutput | null | undefined): string[] {
  if (!analysis) return [];

  const roles = analysis.buyerStrategy
    .map((entry) => entry.role.trim())
    .filter((role) => role.length > 0 && role.length <= MAX_ANALYSIS_TITLE_LENGTH);

  return uniqueStrings(roles).slice(0, MAX_ANALYSIS_TITLES);
}

export function mapIcpToPeopleQuery(
  config: IcpConfig,
  options: MapIcpToPeopleQueryOptions = {},
): PeopleQuery {
  const { targetBuyer, geography, companyProfile } = config;
  const freeTextTitles = analysisTitles(options.analysis);

  /**
   * Both bounds are independently optional in the criteria contract, so each is
   * only carried when it was actually set. An absent bound is left absent
   * rather than filled with 0 or a ceiling: the adapter decides what an open
   * bound means to its provider, and a fabricated bound here would look like
   * the user's own choice.
   */
  const { min: employeeMin, max: employeeMax } = companyProfile.employeeRange;

  return {
    buyer: {
      ...(targetBuyer.titles.length > 0 ? { titles: [...targetBuyer.titles] } : {}),
      ...(freeTextTitles.length > 0 ? { freeTextTitles } : {}),
      // Seniorities and departments are both required by the criteria schema,
      // so these are always populated - but they are still read rather than
      // assumed, so a schema change loosening either does not silently produce
      // an empty filter here.
      ...(targetBuyer.seniorities.length > 0 ? { seniorities: [...targetBuyer.seniorities] } : {}),
      ...(targetBuyer.departments.length > 0 ? { departments: [...targetBuyer.departments] } : {}),
    },
    company: {
      ...(geography.includedCountries.length > 0
        ? { countries: [...geography.includedCountries] }
        : {}),
      ...(geography.excludedCountries.length > 0
        ? { excludedCountries: [...geography.excludedCountries] }
        : {}),
      ...(companyProfile.industries.length > 0 ? { industries: [...companyProfile.industries] } : {}),
      ...(employeeMin !== undefined ? { employeeMin } : {}),
      ...(employeeMax !== undefined ? { employeeMax } : {}),
    },
    page: options.page ?? PEOPLE_PAGE_MIN,
    perPage: options.perPage ?? PEOPLE_PER_PAGE_DEFAULT,
  };
}
