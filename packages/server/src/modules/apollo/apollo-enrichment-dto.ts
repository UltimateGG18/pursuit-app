import { z } from 'zod';

/**
 * Apollo's *people enrichment* response contract.
 *
 * The enrichment counterpart to `apollo-people-dto.ts`, following the same two
 * rules for the same reasons - `id` is the only required field, and unknown
 * keys are stripped rather than rejected, so an Apollo release adding a field
 * is not an outage. What validation is for here is catching a payload that is
 * not an enrichment response at all before any of it is normalized.
 *
 * Shape from <https://docs.apollo.io/reference/people-enrichment> and
 * <https://docs.apollo.io/reference/bulk-people-enrichment>.
 *
 * ## What this schema declares that the search one deliberately does not
 *
 * `email` and `phone_numbers`. The search DTO omits both on purpose - the
 * search endpoint does not return them, and a field that is never parsed cannot
 * leak. Enrichment is the endpoint that *does* return them, this stage has a
 * lawful place to put them (a persisted prospect the user asked for), and
 * retrieving them is the entire point of the call. Everything downstream still
 * treats them as sensitive: they are never logged, and the normalizer carries
 * them only into the provider-neutral prospect.
 */

const nullableString = z.string().nullish().transform((value) => value ?? undefined);

const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? undefined);

/**
 * The employer block, as enrichment nests it inside a person.
 *
 * A near-copy of the search endpoint's organization projection rather than a
 * shared schema, because the two endpoints populate different subsets and
 * merging them into one "Apollo organization" schema would mean neither
 * endpoint's actual shape is written down anywhere.
 */
export const apolloEnrichedOrganizationSchema = z.object({
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

/**
 * One phone number, as Apollo returns it.
 *
 * `raw_number` and `sanitized_number` are both declared because Apollo
 * populates them unevenly and the normalizer prefers the sanitized form when
 * there is one - it is Apollo's own E.164-shaped rendering, and reformatting a
 * number ourselves would be inventing a format the provider did not use.
 *
 * `type` and `status` are Apollo's own labels and are carried through verbatim.
 * Nothing here maps them onto an internal vocabulary: a closed enum would have
 * to invent a bucket for every value Apollo adds, and "mobile" versus "work_hq"
 * is precisely the distinction a caller is acting on.
 */
export const apolloPhoneNumberSchema = z.object({
  raw_number: nullableString,
  sanitized_number: nullableString,
  type: nullableString,
  /** e.g. `valid_number`, or a pending state while a reveal is running. */
  status: nullableString,
});

export type ApolloPhoneNumberDto = z.output<typeof apolloPhoneNumberSchema>;

/** One enriched person, as `person` and `matches[]` carry them. */
export const apolloEnrichedPersonSchema = z.object({
  /** Apollo's primary key. The one field an enriched record cannot do without. */
  id: z.string().min(1),
  first_name: nullableString,
  last_name: nullableString,
  name: nullableString,
  title: nullableString,
  seniority: nullableString,
  departments: z.array(z.string()).nullish().transform((value) => value ?? undefined),
  linkedin_url: nullableString,
  city: nullableString,
  state: nullableString,
  country: nullableString,
  /**
   * The professional address, when Apollo holds one and the plan reveals it.
   *
   * Apollo also answers with a masked placeholder (`email_not_unlocked@...`)
   * for a record whose address the account may not see. That is not an address
   * and the normalizer drops it - see `normalizeWorkEmail`.
   */
  email: nullableString,
  /** `verified`, `guessed`, `unavailable`, ... Kept verbatim. */
  email_status: nullableString,
  phone_numbers: z.array(apolloPhoneNumberSchema).nullish().transform((value) => value ?? undefined),
  organization: apolloEnrichedOrganizationSchema
    .nullish()
    .transform((value) => value ?? undefined),
  organization_id: nullableString,
  organization_name: nullableString,
  /**
   * Apollo's confidence that it identified the right person.
   *
   * Two spellings are declared because Apollo is not consistent about which it
   * sends across the match and bulk_match shapes, and a field that is not
   * declared is *stripped* by this schema - so reading it off the parsed object
   * would silently always find nothing. Both stay optional: Apollo does not
   * document a confidence on every response, and an absent one is reported as
   * unknown rather than defaulted. See `readMatchConfidence`.
   *
   * Never a lead score. This says "we are sure this is the person you meant",
   * not "this is a good prospect".
   */
  match_confidence: nullableString,
  confidence: nullableString,
});

export type ApolloEnrichedPersonDto = z.output<typeof apolloEnrichedPersonSchema>;

/**
 * `POST /api/v1/people/match` - one person.
 *
 * `person` is nullish rather than required: Apollo answers 200 with no person
 * when it cannot identify who was meant, and that is a *result* - the
 * normalizer turns it into NO_MATCH - not a contract breach. Requiring the key
 * would turn every unmatched person into a validation error and lose the
 * distinction between "Apollo does not know them" and "Apollo is broken".
 */
export const apolloPeopleMatchResponseSchema = z
  .object({
    person: apolloEnrichedPersonSchema.nullish(),
  })
  .transform((body) => ({ person: body.person ?? undefined }));

export type ApolloPeopleMatchResponseDto = z.output<typeof apolloPeopleMatchResponseSchema>;

/**
 * Keys that identify a payload as a bulk enrichment response at all.
 *
 * The same gate `apolloPeopleSearchResponseSchema` uses, for the same reason:
 * every field below is optional, so an all-optional object schema would accept
 * an error body and turn it into "nobody was enriched" - a broken integration
 * that looks like a provider with no data.
 */
const BULK_ENVELOPE_KEYS = ['matches', 'status', 'total_requested_enrichments'] as const;

/**
 * `POST /api/v1/people/bulk_match` - up to ten people.
 *
 * `matches` is **positional**: Apollo returns one entry per requested record,
 * in the order they were sent, and an entry is null where that record could not
 * be identified. That positional contract is what lets a result be joined back
 * to the candidate it belongs to, and it is why the array is validated with
 * nullable elements rather than being filtered to the successful ones - drop a
 * null and every subsequent match is attributed to the wrong person.
 */
export const apolloBulkMatchResponseSchema = z
  .object({
    matches: z.array(apolloEnrichedPersonSchema.nullable()).nullish(),
    status: nullableString,
    error_code: nullableString,
    total_requested_enrichments: nullableInt,
    unique_enriched_records: nullableInt,
    missing_records: nullableInt,
    credits_consumed: z.number().nullish().transform((value) => value ?? undefined),
  })
  .superRefine((body, ctx) => {
    if (BULK_ENVELOPE_KEYS.some((key) => key in body)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Not a bulk enrichment response: none of ${BULK_ENVELOPE_KEYS.join(', ')} is present`,
    });
  })
  .transform((body) => ({
    matches: body.matches ?? [],
    status: body.status,
    errorCode: body.error_code,
    totalRequested: body.total_requested_enrichments,
    uniqueEnriched: body.unique_enriched_records,
    missingRecords: body.missing_records,
    creditsConsumed: body.credits_consumed,
  }));

export type ApolloBulkMatchResponseDto = z.output<typeof apolloBulkMatchResponseSchema>;
