/**
 * The contract for the stage after deterministic candidate processing:
 * **provider-backed person enrichment**.
 *
 *   survivor candidate  ->  provider person match  ->  enriched prospect
 *
 * It exists because the discovery endpoint cannot answer the question a
 * prospecting tool is actually for. A people *search* returns who matches the
 * criteria; it does not return an email address or a phone number, and it is
 * not billed as though it did. Those come from a separate, per-person
 * enrichment call, which is why this is a stage rather than a field.
 *
 * Four rules define what may live here, and each one is a mistake this contract
 * is shaped to make impossible:
 *
 *  - **Provider-backed only.** Every value in an `EnrichedProspect` was
 *    returned by the provider for that person. Nothing is derived, guessed,
 *    patterned (`first.last@domain`), scraped or inferred. A field the provider
 *    did not supply is absent, and absent is a fact worth reporting.
 *  - **Not a judgement.** `matchConfidence` is the provider's confidence that
 *    it identified *the right human*. It is not a lead score, it does not rank,
 *    and nothing downstream may read it as quality. A `high` match on a person
 *    who is a terrible prospect is still `high`.
 *  - **Reachability is a set of channels, not a number.** A prospect with only
 *    a LinkedIn profile is reachable *through LinkedIn*. Collapsing three
 *    independent channels into one score would throw away the only part a
 *    person acts on - which channel to actually use.
 *  - **Partial success is the normal case.** Enrichment is per person against a
 *    third party, so some succeed, some do not match, and some are refused by
 *    the account's plan. Every one of those outcomes is a recorded status on
 *    that prospect, never a failure of the run.
 */

import type { PersonCandidate } from './person-candidate.js';

/** Version of this contract, stamped onto every enrichment run. */
export const PROSPECT_ENRICHMENT_VERSION = 'prospect-enrichment.v1';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * What happened when this candidate was handed to the enrichment provider.
 *
 * Six outcomes, and the distinctions between them are the point: three of them
 * mean "no contact data", and they call for three different responses - fix the
 * plan, accept that the provider does not know this person, or retry.
 */
export const PROSPECT_ENRICHMENT_STATUSES = [
  /** Not sent. The stage did not run, or this candidate was outside its budget. */
  'NOT_REQUESTED',
  /** The provider matched the person and returned contact data. */
  'ENRICHED',
  /**
   * The provider matched the person but returned none of the contact fields -
   * no email, no phone, no profile URL. A real answer ("we know who this is and
   * hold nothing you can reach them on"), and distinct from NO_MATCH.
   */
  'PARTIAL',
  /** The provider could not confidently identify this person. Not an error. */
  'NO_MATCH',
  /**
   * The provider or the account's plan does not permit this enrichment - an
   * unauthorized key, a missing scope, exhausted credits. The repair is in the
   * provider's console, not in a retry, so it is never reported as a failure.
   */
  'UNAVAILABLE',
  /** An unexpected provider or transport error. Retrying may work. */
  'FAILED',
] as const;
export type ProspectEnrichmentStatus = (typeof PROSPECT_ENRICHMENT_STATUSES)[number];

/**
 * The provider's confidence that it identified the right person.
 *
 * Kept in the provider's own four-valued vocabulary rather than converted into
 * a number, because a number invites arithmetic that means nothing: the
 * midpoint of `high` and `low` is not a claim any provider made.
 */
export const ENRICHMENT_MATCH_CONFIDENCES = ['high', 'medium', 'low', 'none'] as const;
export type EnrichmentMatchConfidence = (typeof ENRICHMENT_MATCH_CONFIDENCES)[number];

/**
 * Whether a phone number was asked for, and what came back.
 *
 * Phone reveal is *asynchronous* at every provider that sells it, so "we have
 * no number for this person" and "the number is still being fetched" are
 * genuinely different states that a UI must not render identically. The fourth
 * value exists so a run that never asked is not mistaken for one that asked and
 * got nothing.
 */
export const PHONE_ENRICHMENT_STATES = [
  /** Phone reveal was not requested for this run. */
  'NOT_REQUESTED',
  /** At least one usable number came back. */
  'AVAILABLE',
  /** The provider reported the reveal as still running. Ask again later. */
  'PENDING',
  /** Asked for, and the provider holds no number for this person. */
  'NONE',
] as const;
export type PhoneEnrichmentState = (typeof PHONE_ENRICHMENT_STATES)[number];

// ---------------------------------------------------------------------------
// The enriched prospect
// ---------------------------------------------------------------------------

/**
 * One phone number, carrying only what the provider actually said about it.
 *
 * `type` and `status` are the provider's own labels, kept verbatim and
 * deliberately not mapped onto an internal enum: a vocabulary of our own would
 * have to invent a bucket for every unfamiliar value, and "mobile" versus
 * "work_hq" is exactly the distinction a caller is deciding on.
 */
export interface EnrichedPhoneNumber {
  /** As the provider rendered it. Never reformatted, never re-derived. */
  readonly number: string;
  /** The provider's own label, e.g. `mobile`, `work_hq`. */
  readonly type?: string;
  /** The provider's own status for this number, e.g. `valid_number`. */
  readonly status?: string;
}

export interface EnrichedPerson {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly fullName?: string;
  readonly title?: string;
  /** The provider's own seniority label, kept verbatim. */
  readonly seniority?: string;
  /** The provider's own department label, kept verbatim. */
  readonly department?: string;
  /**
   * Canonical profile URL, e.g. `https://www.linkedin.com/in/jan-de-vries`.
   *
   * Only ever the URL the provider returned, canonicalised - never one built
   * from a name. See `canonicalLinkedinUrl`.
   */
  readonly linkedinUrl?: string;
  /** Human-readable, e.g. `Utrecht, Utrecht, Netherlands`. */
  readonly location?: string;
}

export interface EnrichedCompany {
  readonly name?: string;
  /** Lowercased registrable domain, e.g. `example.com`. */
  readonly domain?: string;
  readonly website?: string;
  /** The provider's own key for the employer. */
  readonly organizationId?: string;
}

export interface EnrichedContact {
  /**
   * The professional address the provider holds, when it holds one.
   *
   * Never a personal address, never a pattern-generated one. Absent means the
   * provider returned nothing, which is a usable fact: the prospect may still
   * be reachable on another channel.
   */
  readonly workEmail?: string;
  /** The provider's own label, e.g. `verified`, `guessed`. Kept verbatim. */
  readonly emailStatus?: string;
  /** Empty rather than absent: "no numbers" is a complete answer. */
  readonly phoneNumbers: readonly EnrichedPhoneNumber[];
  readonly phoneState: PhoneEnrichmentState;
}

/**
 * Which channels this prospect can actually be approached on.
 *
 * Three independent booleans and the list they imply - not a score, not a
 * ranking, and deliberately not a single "reachable" flag. The three channels
 * have different costs, different response rates and different tooling, and a
 * caller choosing between them needs to know which exist rather than how many.
 */
export const REACHABILITY_CHANNELS = ['LINKEDIN', 'EMAIL', 'PHONE'] as const;
export type ReachabilityChannel = (typeof REACHABILITY_CHANNELS)[number];

export interface ProspectReachability {
  readonly hasLinkedIn: boolean;
  readonly hasWorkEmail: boolean;
  readonly hasPhone: boolean;
  /** The channels above, as a list, in a stable order. */
  readonly channels: readonly ReachabilityChannel[];
}

export interface EnrichmentProvenance {
  readonly status: ProspectEnrichmentStatus;
  /** The provider's identification confidence; absent when it reported none. */
  readonly matchConfidence?: EnrichmentMatchConfidence;
  readonly provider: string;
  /** ISO 8601. Absent when the stage never ran for this candidate. */
  readonly enrichedAt?: string;
  /**
   * Frontend-safe explanation, for every status except ENRICHED.
   *
   * Contractually free of credentials, provider URLs, request headers and raw
   * provider payloads - it is written for the person reading the result, and it
   * is the only account they get of why a row has no contact data.
   */
  readonly detail?: string;
}

/**
 * One enriched prospect - the provider-neutral result of the whole stage.
 *
 * Present for **every** candidate that entered enrichment, including the ones
 * that did not match: a prospect with `status: NO_MATCH` and no contact data is
 * the answer to "did we try?", and dropping it would make an unenriched
 * candidate indistinguishable from one the provider does not know.
 */
export interface EnrichedProspect {
  /**
   * `PersonCandidate.rawSourceRef` - the same key the people list and the
   * processing block are joined on, so the UI needs no third index.
   */
  readonly personRef: string;
  readonly provider: string;
  /** The provider's own key for the person, preserved for re-fetching. */
  readonly externalPersonId?: string;
  /** The provider's own key for the employer, preserved for the same reason. */
  readonly externalOrganizationId?: string;
  readonly person: EnrichedPerson;
  readonly company: EnrichedCompany;
  readonly contact: EnrichedContact;
  readonly enrichment: EnrichmentProvenance;
  readonly reachability: ProspectReachability;
}

// ---------------------------------------------------------------------------
// Run-level result
// ---------------------------------------------------------------------------

/**
 * The enrichment funnel, as counts.
 *
 * Counts, never rates and never scores - the same discipline
 * `CandidateProcessingCounts` follows, and for the same reason: "18 of 25
 * enriched" is an operational fact, and knowing that the other 7 split into 5
 * no-match and 2 plan-refused is what decides whether anything can be done
 * about it.
 */
export interface EnrichmentCounts {
  /** Candidates handed to the provider. */
  readonly requested: number;
  readonly enriched: number;
  readonly partial: number;
  readonly noMatch: number;
  readonly unavailable: number;
  readonly failed: number;
  /**
   * Survivors deliberately not sent - over the per-run budget, or already
   * enriched in an earlier run. Counted so the funnel adds up.
   */
  readonly skipped: number;
}

/** How many prospects carry each channel. Independent, so these overlap. */
export interface ReachabilityCounts {
  readonly linkedin: number;
  readonly email: number;
  readonly phone: number;
}

export interface ProspectEnrichmentResult {
  readonly version: string;
  readonly provider: string;
  /** One per candidate that entered the stage, matched or not. */
  readonly prospects: readonly EnrichedProspect[];
  readonly counts: EnrichmentCounts;
  readonly reachability: ReachabilityCounts;
  /**
   * Whether phone reveal was requested at all for this run.
   *
   * Present so a reader can tell "nobody has a phone number" from "we did not
   * ask for phone numbers" - two identical-looking result sets with opposite
   * meanings.
   */
  readonly phoneRevealRequested: boolean;
  /**
   * A run-level problem that affected every candidate - the account's plan does
   * not include enrichment, the credential was refused, the quota is spent.
   *
   * Frontend-safe by contract, and set *alongside* per-prospect statuses rather
   * than instead of them, so the failure is visible whether a reader is looking
   * at the summary or at one row.
   */
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/**
 * A LinkedIn profile URL in canonical, linkable form.
 *
 * The display counterpart to `normalizeLinkedinUrl`, which produces a *key* for
 * comparison (`linkedin.com/in/x`) and is not a URL you can put in an `href`.
 * This keeps the same discipline - locale subdomain, query string, fragment and
 * trailing slash removed, because none of them identify the profile and a
 * tracking parameter carries where the link was found - and returns something a
 * browser can open.
 *
 * Anything that is not recognisably a LinkedIn profile path returns undefined
 * rather than a best guess: a broken profile link is worse than an absent one,
 * because a reader clicks it before discovering it is wrong.
 */
export function canonicalLinkedinUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const hostAndPath = withoutScheme.split(/[?#]/, 1)[0] ?? '';
  const slashIndex = hostAndPath.indexOf('/');
  if (slashIndex < 0) return undefined;

  const host = hostAndPath.slice(0, slashIndex).toLowerCase();
  // `linkedin.com`, `www.linkedin.com` and `nl.linkedin.com` are one host.
  if (!/(^|\.)linkedin\.com$/.test(host)) return undefined;

  // The path keeps its original case: a profile slug is case-sensitive at
  // LinkedIn, and lowercasing one can produce a URL that 404s.
  const path = hostAndPath.slice(slashIndex).replace(/\/+$/, '');
  if (!/^\/(in|pub)\/[^/]+/.test(path)) return undefined;
  return `https://www.linkedin.com${path}`;
}

/**
 * Which channels an enriched prospect actually has.
 *
 * Derived from the contact data rather than stored alongside it, so the two can
 * never disagree - a `hasWorkEmail: true` next to an absent address would be a
 * lie the storage layer told, and there is no way for a reader to tell which
 * half is right.
 *
 * A phone number that is still being revealed does **not** count: the channel
 * does not exist yet, and `phoneState: PENDING` is how a caller learns to ask
 * again rather than to act on a number nobody has.
 */
export function reachabilityFor(input: {
  readonly linkedinUrl?: string;
  readonly workEmail?: string;
  readonly phoneNumbers: readonly EnrichedPhoneNumber[];
}): ProspectReachability {
  const hasLinkedIn = (input.linkedinUrl ?? '').length > 0;
  const hasWorkEmail = (input.workEmail ?? '').length > 0;
  const hasPhone = input.phoneNumbers.length > 0;

  const channels: ReachabilityChannel[] = [];
  if (hasLinkedIn) channels.push('LINKEDIN');
  if (hasWorkEmail) channels.push('EMAIL');
  if (hasPhone) channels.push('PHONE');

  return { hasLinkedIn, hasWorkEmail, hasPhone, channels };
}

/**
 * The strongest identity a candidate carries, for the enrichment request.
 *
 * Ordered, and the order is the whole safety property: the provider's own
 * person id is *exact*, a LinkedIn profile URL is exact, and a name plus a
 * company domain is a lookup the provider performs against its own records. A
 * candidate with none of the three is not enriched at all, because the only
 * remaining option would be asking a third party to guess which human we meant,
 * and a wrongly matched person produces contact details for somebody else.
 *
 * Returns undefined when the identity is insufficient - never a partial one.
 */
export interface EnrichmentIdentity {
  /** Which identity was used. Recorded so a match can be explained later. */
  readonly basis: 'PROVIDER_ID' | 'LINKEDIN_URL' | 'NAME_AND_DOMAIN';
  readonly provider: string;
  readonly externalPersonId?: string;
  readonly linkedinUrl?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly name?: string;
  readonly domain?: string;
}

export function enrichmentIdentityFor(
  candidate: PersonCandidate,
  provider: string,
): EnrichmentIdentity | undefined {
  const ref = candidate.providerRefs.find((candidateRef) => candidateRef.provider === provider);
  if (ref && ref.externalId.length > 0) {
    return { basis: 'PROVIDER_ID', provider, externalPersonId: ref.externalId };
  }

  const linkedinUrl = canonicalLinkedinUrl(candidate.linkedinUrl);
  if (linkedinUrl !== undefined) {
    return { basis: 'LINKEDIN_URL', provider, linkedinUrl };
  }

  // Last resort, and only when *both* halves are present. A name alone matches
  // every namesake the provider holds; a domain alone matches a company.
  const domain = candidate.company?.domain;
  const hasName = candidate.name.trim().length > 0;
  if (domain !== undefined && domain.length > 0 && hasName) {
    return {
      basis: 'NAME_AND_DOMAIN',
      provider,
      name: candidate.name,
      ...(candidate.firstName !== undefined ? { firstName: candidate.firstName } : {}),
      ...(candidate.lastName !== undefined ? { lastName: candidate.lastName } : {}),
      domain,
    };
  }

  return undefined;
}

/** Tallies the funnel over a finished set of prospects. */
export function countEnrichment(
  prospects: readonly EnrichedProspect[],
  skipped: number,
): EnrichmentCounts {
  const withStatus = (status: ProspectEnrichmentStatus): number =>
    prospects.filter((prospect) => prospect.enrichment.status === status).length;

  return {
    // Everything that reached the provider: the NOT_REQUESTED rows are the ones
    // that did not, and they are `skipped` instead.
    requested: prospects.filter(
      (prospect) => prospect.enrichment.status !== 'NOT_REQUESTED',
    ).length,
    enriched: withStatus('ENRICHED'),
    partial: withStatus('PARTIAL'),
    noMatch: withStatus('NO_MATCH'),
    unavailable: withStatus('UNAVAILABLE'),
    failed: withStatus('FAILED'),
    skipped,
  };
}

/** Tallies channels over a finished set of prospects. Overlapping by design. */
export function countReachability(
  prospects: readonly EnrichedProspect[],
): ReachabilityCounts {
  return {
    linkedin: prospects.filter((prospect) => prospect.reachability.hasLinkedIn).length,
    email: prospects.filter((prospect) => prospect.reachability.hasWorkEmail).length,
    phone: prospects.filter((prospect) => prospect.reachability.hasPhone).length,
  };
}
