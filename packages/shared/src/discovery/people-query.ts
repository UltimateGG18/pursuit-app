import { z } from 'zod';
import { COUNTRIES } from '../icp/catalogs/geography.js';
import { INDUSTRIES } from '../icp/catalogs/company.js';
import { DEPARTMENTS, SENIORITIES, TARGET_TITLES } from '../icp/catalogs/buyer.js';

/**
 * The internal, provider-neutral *people* query - the counterpart to
 * `DiscoveryQuery`, for finding the humans inside the companies rather than
 * the companies.
 *
 * Same discipline as the firmographic query: it is *derived* from `IcpConfig`
 * rather than being a second representation of it, it carries only the
 * recall-shaped subset a provider can actually filter on, and every value stays
 * in the internal catalog vocabulary (`NL`, `C_LEVEL`, `CTO`). Translating
 * those into a provider's own words - Apollo's `c_suite`, `Netherlands` - is
 * the adapter's job, so no provider term appears in this file.
 *
 * Two fields have no equivalent in the company query and are worth naming:
 *
 *  - `freeTextTitles` carries titles that did **not** come from the
 *    `TARGET_TITLES` catalog - the buyer roles the ICP analysis reasoned out,
 *    e.g. "Head of Digital Transformation". They are kept separate from
 *    `titles` so the source of every title stays visible: one list is a
 *    person's controlled choice, the other is a model's inference, and a search
 *    that mixes them silently cannot be audited.
 *  - `page`/`perPage` replace the company query's opaque `cursor`. People
 *    search is a browsable result set that a user pages through in the UI,
 *    where firmographic discovery is a budgeted walk the server performs on
 *    their behalf. Those are different interactions and they get different
 *    contracts rather than one contorted to serve both.
 */

/** Version of the people query contract, stamped onto every run. */
export const PEOPLE_QUERY_VERSION = 'people-query.v1';

export interface PeopleQueryBuyer {
  /** Internal `TARGET_TITLES` values, e.g. `CTO`. */
  readonly titles?: readonly string[];
  /**
   * Titles as prose, from the ICP analysis. Never catalog values, and never
   * mixed into `titles` - see the note above.
   */
  readonly freeTextTitles?: readonly string[];
  /** Internal `SENIORITIES` values, e.g. `C_LEVEL`. */
  readonly seniorities?: readonly string[];
  /** Internal `DEPARTMENTS` values, e.g. `ENGINEERING`. */
  readonly departments?: readonly string[];
}

export interface PeopleQueryCompany {
  /** ISO 3166-1 alpha-2 codes; the company's location, not the person's. */
  readonly countries?: readonly string[];
  readonly excludedCountries?: readonly string[];
  /** Internal `INDUSTRIES` values, e.g. `SOFTWARE_SAAS`. */
  readonly industries?: readonly string[];
  readonly employeeMin?: number;
  readonly employeeMax?: number;
}

export interface PeopleQuery {
  readonly buyer?: PeopleQueryBuyer;
  readonly company?: PeopleQueryCompany;
  /** 1-based page of the provider's result set. */
  readonly page: number;
  readonly perPage: number;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const PEOPLE_PER_PAGE_MIN = 1;
/**
 * Apollo's own ceiling for one page of people search, and a sensible one for
 * any provider: a page is what a person reads, not what a machine ingests.
 */
export const PEOPLE_PER_PAGE_MAX = 100;
/**
 * Modest by default, for the same reason the company limit is: a page costs
 * provider credits, and 25 leads is enough to judge whether an ICP is pointed
 * at the right people without paying for four times that first.
 */
export const PEOPLE_PER_PAGE_DEFAULT = 25;

export const PEOPLE_PAGE_MIN = 1;
/**
 * Providers cap how deep a result set can be browsed - Apollo stops at 500
 * pages - and requesting past the end returns an empty page that reads like
 * "no more leads" rather than "you asked for something impossible". Bounded
 * here so the request is refused where the mistake is.
 */
export const PEOPLE_PAGE_MAX = 500;

// ---------------------------------------------------------------------------
// API request contract
// ---------------------------------------------------------------------------

/**
 * Body of `POST /api/icps/:id/prospects`.
 *
 * Everything is optional: the ICP already says who to look for, so a bare `{}`
 * is a valid request and means "the first page, at the default size".
 */
export const discoverProspectsRequestSchema = z
  .object({
    page: z.coerce.number().int().min(PEOPLE_PAGE_MIN).max(PEOPLE_PAGE_MAX).default(PEOPLE_PAGE_MIN),
    perPage: z.coerce
      .number()
      .int()
      .min(PEOPLE_PER_PAGE_MIN)
      .max(PEOPLE_PER_PAGE_MAX)
      .default(PEOPLE_PER_PAGE_DEFAULT),
    /**
     * A stored analysis whose buyer strategy should widen the title list.
     *
     * Opt-in rather than automatic: the analysis is a model's inference, and
     * folding it into a search without the caller asking would make the filters
     * depend on which analysis happened to run last. The UI passes the analysis
     * the user is looking at.
     */
    analysisId: z.string().uuid('An analysis id must be a UUID').optional(),
  })
  .strict();

export type DiscoverProspectsRequest = z.output<typeof discoverProspectsRequestSchema>;
export type DiscoverProspectsRequestInput = z.input<typeof discoverProspectsRequestSchema>;

/**
 * Shape of a `PeopleQuery` on the wire.
 *
 * Used to validate a query that crossed a boundary - a stored run, a queued
 * job - rather than one this process just built. Enum lists are checked against
 * the catalogs so a query can never carry a seniority or an industry the
 * criteria contract does not know; `freeTextTitles` is the one list that is
 * not, because by definition it holds values no catalog contains.
 */
export const peopleQuerySchema = z
  .object({
    buyer: z
      .object({
        titles: z.array(z.enum(TARGET_TITLES)).optional(),
        freeTextTitles: z.array(z.string().trim().min(2).max(200)).optional(),
        seniorities: z.array(z.enum(SENIORITIES)).optional(),
        departments: z.array(z.enum(DEPARTMENTS)).optional(),
      })
      .strict()
      .optional(),
    company: z
      .object({
        countries: z.array(z.enum(COUNTRIES)).optional(),
        excludedCountries: z.array(z.enum(COUNTRIES)).optional(),
        industries: z.array(z.enum(INDUSTRIES)).optional(),
        employeeMin: z.number().int().min(0).max(1000000).optional(),
        employeeMax: z.number().int().min(0).max(1000000).optional(),
      })
      .strict()
      .optional(),
    page: z.number().int().min(PEOPLE_PAGE_MIN).max(PEOPLE_PAGE_MAX),
    perPage: z.number().int().min(PEOPLE_PER_PAGE_MIN).max(PEOPLE_PER_PAGE_MAX),
  })
  .strict();
