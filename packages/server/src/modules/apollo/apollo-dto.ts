import { z } from 'zod';

/**
 * Apollo's own response contract.
 *
 * This file, and only this file, describes what Apollo sends. Nothing here is
 * exported past the `apollo` module - `snake_case` provider fields never become
 * the domain model, which is the separation the implementation plan requires
 * (plan section 3: "Apollo fields never reach the domain model").
 *
 * ## Where the shape comes from
 *
 * The organization search endpoint documented at
 * <https://docs.apollo.io/reference/organization-search> and the organization
 * object documented at <https://docs.apollo.io/reference/organization-enrichment>.
 * Every field below appears verbatim in one of those two contracts; none is
 * invented. Fields Apollo documents but this slice has no use for - funding,
 * job postings, social URLs, intent flags - are deliberately absent rather than
 * declared and ignored.
 *
 * ## Why it is tolerant
 *
 * Two decisions, both load-bearing:
 *
 *  - **`id` is the only required organization field.** Apollo populates the
 *    rest per company and per plan, and the search response is a lighter
 *    projection than the enrichment one. A schema demanding `industry` would
 *    reject a perfectly good company for having none, and the domain contract
 *    already treats missing data as unknown.
 *  - **Unknown keys are stripped, not rejected.** Apollo adds response fields
 *    without notice. A non-strict object means a new field is ignored; a strict
 *    one would turn every Apollo release into an outage. What validation is
 *    actually for here is catching a payload that is *not* an organization
 *    search response at all - an error body, an HTML error page, a shape change
 *    in `pagination` - before any of it is normalized.
 */

/**
 * Apollo sends JSON `null` for an absent scalar about as often as it omits the
 * key. Both mean "not reported", so both collapse to `undefined` and let the
 * normalizer treat unknown as unknown.
 */
const nullableString = z.string().nullish().transform((value) => value ?? undefined);

const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? undefined);

const nullableStringArray = z
  .array(z.string())
  .nullish()
  .transform((value) => value ?? undefined);

/**
 * One organization, as `organizations[]` carries it.
 *
 * `country`, `city`, `state`, `industry`, `estimated_num_employees`,
 * `keywords`, `technology_names` and `short_description` are documented on the
 * organization object and are the firmographic fields this slice normalizes.
 */
export const apolloOrganizationSchema = z.object({
  /** Apollo's primary key. The one field a candidate cannot do without. */
  id: z.string().min(1),
  name: nullableString,
  website_url: nullableString,
  primary_domain: nullableString,
  linkedin_url: nullableString,
  industry: nullableString,
  keywords: nullableStringArray,
  estimated_num_employees: nullableInt,
  founded_year: nullableInt,
  short_description: nullableString,
  technology_names: nullableStringArray,
  city: nullableString,
  state: nullableString,
  country: nullableString,
  postal_code: nullableString,
  street_address: nullableString,
});

export type ApolloOrganizationDto = z.output<typeof apolloOrganizationSchema>;

/** `pagination`, as documented. All four fields are always present. */
export const apolloPaginationSchema = z.object({
  page: z.number().int(),
  per_page: z.number().int(),
  total_entries: z.number().int(),
  total_pages: z.number().int(),
});

export type ApolloPaginationDto = z.output<typeof apolloPaginationSchema>;

/**
 * The organization search response.
 *
 * `accounts` is the caller's own CRM accounts matching the same filters. It is
 * accepted so a response carrying it still validates, and deliberately not
 * normalized: an account is a record in *this* Apollo workspace, not a company
 * discovered in Apollo's database, and mixing the two would silently seed
 * discovery with companies the user already owns.
 */
export const apolloOrganizationSearchResponseSchema = z.object({
  organizations: z.array(apolloOrganizationSchema).nullish().transform((value) => value ?? []),
  accounts: z.array(z.unknown()).nullish().transform((value) => value ?? []),
  pagination: apolloPaginationSchema,
});

export type ApolloOrganizationSearchResponseDto = z.output<
  typeof apolloOrganizationSearchResponseSchema
>;

/**
 * Apollo's error envelope: `{ "error": "...", "error_code": "..." }`.
 *
 * Parsed best-effort so a failure can be reported with Apollo's own account of
 * it - "This API key is not authorized to access ..." is the difference between
 * a fixable configuration problem and an unexplained 403.
 */
export const apolloErrorBodySchema = z.object({
  error: z.string().nullish(),
  error_code: z.string().nullish(),
  message: z.string().nullish(),
});

/** The auth probe: `GET /api/v1/auth/health`. */
export const apolloAuthHealthResponseSchema = z.object({
  healthy: z.boolean().nullish(),
  is_logged_in: z.boolean().nullish(),
});
