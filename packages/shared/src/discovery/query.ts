import { z } from 'zod';
import { COUNTRIES, REGIONS } from '../icp/catalogs/geography.js';
import { COMPANY_TYPES, INDUSTRIES, MATURITY_STAGES } from '../icp/catalogs/company.js';
import { TECHNOLOGIES } from '../icp/catalogs/technology.js';
import { DISCOVERY_STRATEGIES } from '../icp/catalogs/evidence.js';

/**
 * The internal, provider-neutral discovery query (plan section 6).
 *
 * It is deliberately *derived* from `IcpConfig` rather than being a second
 * representation of it: the criteria contract stays the single source of truth
 * for what the user asked for, and this is the recall-shaped subset a provider
 * can actually filter on. Everything a provider cannot filter - must-have
 * rules, triggers, scoring weights - stays out, because it belongs to the
 * qualification stage.
 *
 * Values stay in the internal catalog vocabulary (ISO-2 country codes,
 * `SOFTWARE_SAAS`, `KUBERNETES`). Translating them into a provider's own
 * vocabulary is the adapter's job, so no provider term appears here.
 */

/** Version of the discovery query contract, stamped onto every run. */
export const DISCOVERY_QUERY_VERSION = 'discovery-query.v1';

export interface DiscoveryGeographyQuery {
  readonly countries?: readonly string[];
  readonly excludedCountries?: readonly string[];
  readonly regions?: readonly string[];
}

export interface DiscoveryCompanyProfileQuery {
  readonly industries?: readonly string[];
  readonly excludedIndustries?: readonly string[];
  readonly employeeMin?: number;
  readonly employeeMax?: number;
  readonly companyTypes?: readonly string[];
  readonly maturity?: readonly string[];
}

export interface DiscoveryTechnologyQuery {
  readonly requiredTechnologies?: readonly string[];
  readonly preferredTechnologies?: readonly string[];
}

export interface DiscoveryQuery {
  readonly geography?: DiscoveryGeographyQuery;
  readonly companyProfile?: DiscoveryCompanyProfileQuery;
  readonly technology?: DiscoveryTechnologyQuery;
  /** Upper bound on candidates to return across all pages. */
  readonly limit?: number;
  /**
   * Opaque provider continuation token. A caller passes back whatever the
   * previous result reported and never constructs one, so page-number vs.
   * cursor paging stays a provider detail.
   */
  readonly cursor?: string;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const DISCOVERY_LIMIT_MIN = 1;
export const DISCOVERY_LIMIT_MAX = 200;
/**
 * Modest by default. Discovery spends provider credits per page, so a caller
 * poking the endpoint gets one page of evidence that the pipeline works rather
 * than an unbounded crawl.
 */
export const DISCOVERY_LIMIT_DEFAULT = 25;

// ---------------------------------------------------------------------------
// API request contract
// ---------------------------------------------------------------------------

/**
 * Body of `POST /api/icps/:id/discover`.
 *
 * Everything is optional: the ICP already says what to look for, so a bare
 * `{}` is a valid request. The overrides exist so the endpoint is usable for
 * testing a narrower slice without editing the ICP.
 */
export const discoverIcpRequestSchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(DISCOVERY_LIMIT_MIN)
      .max(DISCOVERY_LIMIT_MAX)
      .default(DISCOVERY_LIMIT_DEFAULT),
    cursor: z.string().trim().min(1).max(256).optional(),
    /**
     * Which strategies to run. Only `FIRMOGRAPHIC` is implemented in this
     * slice; naming an unimplemented one is reported rather than ignored, so a
     * caller is never told a strategy ran when it did not.
     */
    strategies: z.array(z.enum(DISCOVERY_STRATEGIES)).min(1).max(DISCOVERY_STRATEGIES.length).optional(),
  })
  .strict();

export type DiscoverIcpRequest = z.output<typeof discoverIcpRequestSchema>;
export type DiscoverIcpRequestInput = z.input<typeof discoverIcpRequestSchema>;

/**
 * Shape of a `DiscoveryQuery` on the wire.
 *
 * Used to validate a query that crossed a boundary - a stored run, a queued
 * job - rather than one this process just built. Enum lists are validated
 * against the catalogs so a query can never carry a country or industry the
 * criteria contract does not know.
 */
export const discoveryQuerySchema = z
  .object({
    geography: z
      .object({
        countries: z.array(z.enum(COUNTRIES)).optional(),
        excludedCountries: z.array(z.enum(COUNTRIES)).optional(),
        regions: z.array(z.enum(REGIONS)).optional(),
      })
      .strict()
      .optional(),
    companyProfile: z
      .object({
        industries: z.array(z.enum(INDUSTRIES)).optional(),
        excludedIndustries: z.array(z.enum(INDUSTRIES)).optional(),
        employeeMin: z.number().int().min(0).max(1000000).optional(),
        employeeMax: z.number().int().min(0).max(1000000).optional(),
        companyTypes: z.array(z.enum(COMPANY_TYPES)).optional(),
        maturity: z.array(z.enum(MATURITY_STAGES)).optional(),
      })
      .strict()
      .optional(),
    technology: z
      .object({
        requiredTechnologies: z.array(z.enum(TECHNOLOGIES)).optional(),
        preferredTechnologies: z.array(z.enum(TECHNOLOGIES)).optional(),
      })
      .strict()
      .optional(),
    limit: z.number().int().min(DISCOVERY_LIMIT_MIN).max(DISCOVERY_LIMIT_MAX).optional(),
    cursor: z.string().min(1).max(256).optional(),
  })
  .strict();
