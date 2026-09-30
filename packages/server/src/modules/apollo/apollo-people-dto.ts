import { z } from 'zod';
import { apolloPaginationSchema } from './apollo-dto.js';

/**
 * Apollo's *people search* response contract.
 *
 * The people counterpart to `apollo-dto.ts`, and it follows the same two rules
 * for the same reasons:
 *
 *  - **`id` is the only required field.** Apollo populates the rest per person
 *    and per plan. A schema demanding `title` would reject a perfectly usable
 *    lead for having none, and the domain contract already treats missing data
 *    as unknown.
 *  - **Unknown keys are stripped, not rejected.** Apollo adds response fields
 *    without notice; a strict object would turn every Apollo release into an
 *    outage. What validation is for here is catching a payload that is *not* a
 *    people search response at all - an error body, an HTML error page from a
 *    proxy - before any of it is normalized.
 *
 * Shape from <https://docs.apollo.io/reference/people-search>. Fields Apollo
 * documents but this slice has no use for - phone numbers, employment history,
 * intent flags - are deliberately absent rather than declared and ignored.
 *
 * ## What is deliberately *not* declared: the email address
 *
 * `email` is documented and is not read. The status is - "does this lead have a
 * verified address?" is what a prospecting UI needs - but the address itself is
 * personal data with a retention question attached, this slice persists
 * nothing, and a field that is never parsed cannot leak into a log, a response
 * or a snapshot. It is one line to add when there is somewhere lawful to put
 * it.
 */

const nullableString = z.string().nullish().transform((value) => value ?? undefined);

const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? undefined);

/**
 * The `organization` block Apollo nests inside a person.
 *
 * A lighter projection than the organization search object - Apollo returns the
 * employer as context here, not as a full firmographic record - so only the
 * fields that actually appear are declared.
 */
export const apolloPersonOrganizationSchema = z.object({
  id: nullableString,
  name: nullableString,
  website_url: nullableString,
  primary_domain: nullableString,
  linkedin_url: nullableString,
  industry: nullableString,
  estimated_num_employees: nullableInt,
  city: nullableString,
  state: nullableString,
  country: nullableString,
});

export type ApolloPersonOrganizationDto = z.output<typeof apolloPersonOrganizationSchema>;

/** One person, as `people[]` and `contacts[]` carry them. */
export const apolloPersonSchema = z.object({
  /** Apollo's primary key. The one field a candidate cannot do without. */
  id: z.string().min(1),
  first_name: nullableString,
  last_name: nullableString,
  name: nullableString,
  title: nullableString,
  /** Apollo's own vocabulary, e.g. `c_suite`. Kept verbatim by the normalizer. */
  seniority: nullableString,
  /**
   * Apollo reports departments as a list even though a person has one primary
   * department; the normalizer takes the first and keeps Apollo's own label.
   */
  departments: z.array(z.string()).nullish().transform((value) => value ?? undefined),
  linkedin_url: nullableString,
  city: nullableString,
  state: nullableString,
  country: nullableString,
  /** `verified`, `guessed`, `unavailable`, ... The status, never the address. */
  email_status: nullableString,
  /** Present on a people-search row; absent on a person with no employer. */
  organization: apolloPersonOrganizationSchema.nullish().transform((value) => value ?? undefined),
  /** Apollo's denormalized copies of the employer, used only as a fallback. */
  organization_name: nullableString,
  organization_id: nullableString,
});

export type ApolloPersonDto = z.output<typeof apolloPersonSchema>;

/**
 * The people search response.
 *
 * Apollo splits the result in two: `people` are records from its database, and
 * `contacts` are the same search's matches inside *this* workspace's own CRM.
 * Both are accepted so the payload validates either way, and - unlike the
 * organization endpoint, where `accounts` is deliberately discarded - both are
 * normalized. A contact is still a person matching the ICP; seeding a prospect
 * list with people the workspace already knows is useful rather than
 * misleading, and the provider reference records which list each came from.
 */
/**
 * Keys that identify this payload as a people search response at all.
 *
 * The gate exists because every field below is optional, and an all-optional
 * object schema accepts *anything* - `{"error": "..."}`, a response from a
 * different endpoint - and would silently turn it into "0 people found". That
 * failure is worse than the one that loosening `pagination` fixed: an empty
 * result is indistinguishable from a successful search that matched nobody, so
 * a broken integration would look like a narrow ICP.
 *
 * So the requirement moved from "pagination must be present" to "this must be
 * recognisably a people search response", which is what validation was for.
 */
const PEOPLE_ENVELOPE_KEYS = ['people', 'contacts', 'pagination'] as const;

export const apolloPeopleSearchResponseSchema = z
  .object({
    /**
     * Left un-defaulted at this level so the refinement below can still tell an
     * *absent* key from an empty list. Zod drops an absent optional key from
     * its output, where a `.transform(v => v ?? [])` would leave every response
     * looking as though Apollo had sent both lists. The defaults are applied in
     * the final transform instead, so consumers still get plain arrays.
     */
    people: z.array(apolloPersonSchema).nullish(),
    contacts: z.array(apolloPersonSchema).nullish(),
    /**
     * Optional, unlike the organization endpoint's.
     *
     * Observed against the live API: `mixed_people/api_search` can answer 200
     * with **no `pagination` block at all**. Requiring it threw away an
     * otherwise usable page over a field carrying no lead data - the page and
     * page size are already known, because we sent them, and only the totals
     * are genuinely lost.
     *
     * `ApolloPeopleService` reconstructs what it knows and leaves the totals
     * unknown, which is the same rule every other field here follows.
     */
    pagination: apolloPaginationSchema.nullish(),
  })
  .superRefine((body, ctx) => {
    if (PEOPLE_ENVELOPE_KEYS.some((key) => key in body)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Not a people search response: none of ${PEOPLE_ENVELOPE_KEYS.join(', ')} is present`,
    });
  })
  .transform((body) => ({
    people: body.people ?? [],
    contacts: body.contacts ?? [],
    pagination: body.pagination ?? undefined,
  }));

export type ApolloPeopleSearchResponseDto = z.output<typeof apolloPeopleSearchResponseSchema>;
