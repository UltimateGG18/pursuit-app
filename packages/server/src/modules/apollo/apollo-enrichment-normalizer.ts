import {
  canonicalLinkedinUrl,
  normalizeCandidateDomain,
  reachabilityFor,
  type EnrichedPhoneNumber,
  type EnrichedProspect,
  type EnrichmentMatchConfidence,
  type PhoneEnrichmentState,
  type ProspectEnrichmentStatus,
} from '@pursuit/shared';
import { APOLLO_PROVIDER_ID } from './apollo-errors.js';
import { normalizeWebsite } from './apollo-normalizer.js';
import { normalizePersonLocation } from './apollo-people-normalizer.js';
import type { ApolloEnrichedPersonDto, ApolloPhoneNumberDto } from './apollo-enrichment-dto.js';

/**
 * Apollo enriched person -> `EnrichedProspect`.
 *
 * The enrichment counterpart to `apollo-people-normalizer.ts`, and the single
 * crossing point for the enrichment path: everything above this file speaks
 * Apollo, everything below it speaks the domain.
 *
 * The rules are the ones the whole adapter layer follows, with one addition
 * that only matters here:
 *
 *  - **Nothing is invented.** No address is patterned from a name and a domain,
 *    no profile URL is built from a slug, no number is formatted into existence.
 *    A field Apollo did not return is absent.
 *  - **Nothing is judged.** `matchConfidence` is Apollo's confidence that it
 *    identified the right human. It is not a lead score and nothing here turns
 *    it into one.
 *  - **A masked value is not a value.** Apollo answers with placeholder
 *    addresses for records an account may not see. Those are refusals wearing
 *    the shape of data, and letting one through would put
 *    `email_not_unlocked@domain.com` in front of a user as a real address.
 */

/** Trims, and treats an empty or whitespace-only string as absent. */
function text(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Local parts Apollo uses to say "this account may not see the address".
 *
 * A short, exact list rather than a heuristic: anything cleverer would start
 * rejecting real addresses, and a false positive here silently deletes a
 * working contact channel. An unfamiliar placeholder Apollo adds later is
 * therefore let through - which is the safer failure, because it is visible.
 */
const MASKED_EMAIL_LOCAL_PARTS = new Set([
  'email_not_unlocked',
  'email_not_found',
  'not_unlocked',
]);

/**
 * The work email, when Apollo actually returned one.
 *
 * Apollo's masked placeholders (`email_not_unlocked@domain.com`) are dropped
 * rather than carried: they are Apollo declining to reveal an address, and
 * showing one to a user - or worse, mailing it - would be acting on a refusal
 * as though it were data.
 */
export function normalizeWorkEmail(value: string | undefined): string | undefined {
  const email = text(value);
  if (email === undefined) return undefined;

  const atIndex = email.lastIndexOf('@');
  // Not an address at all. Absent is the honest reading, not a repair.
  if (atIndex <= 0 || atIndex === email.length - 1) return undefined;

  const localPart = email.slice(0, atIndex).toLowerCase();
  if (MASKED_EMAIL_LOCAL_PARTS.has(localPart)) return undefined;

  return email;
}

/**
 * Apollo phone statuses that mean "still being revealed", not "here it is".
 *
 * Phone reveal is asynchronous, so under poll-only Apollo can answer with a
 * placeholder record whose status says the lookup is running. Treating that as
 * a number would show a user something nobody can dial.
 */
const PENDING_PHONE_STATUSES = new Set(['pending', 'processing', 'in_progress', 'queued']);

function isPendingStatus(status: string | undefined): boolean {
  const normalized = status?.trim().toLowerCase();
  return normalized !== undefined && PENDING_PHONE_STATUSES.has(normalized);
}

export interface NormalizedPhones {
  readonly phoneNumbers: readonly EnrichedPhoneNumber[];
  /** True when Apollo reported at least one reveal as still running. */
  readonly pending: boolean;
}

/**
 * Apollo's phone records, as the neutral contract holds them.
 *
 * `sanitized_number` wins over `raw_number` when both are present: it is
 * Apollo's own normalized rendering, and reformatting a number here would be
 * inventing a format the provider did not use. `type` and `status` pass through
 * verbatim - they are Apollo's vocabulary and mapping them onto one of ours
 * would have to invent a bucket for every value Apollo adds.
 */
export function normalizePhoneNumbers(
  phones: readonly ApolloPhoneNumberDto[] | undefined,
): NormalizedPhones {
  const phoneNumbers: EnrichedPhoneNumber[] = [];
  let pending = false;

  for (const phone of phones ?? []) {
    if (isPendingStatus(phone.status)) {
      pending = true;
      continue;
    }
    const number = text(phone.sanitized_number) ?? text(phone.raw_number);
    if (number === undefined) continue;

    const type = text(phone.type);
    const status = text(phone.status);
    phoneNumbers.push({
      number,
      ...(type !== undefined ? { type } : {}),
      ...(status !== undefined ? { status } : {}),
    });
  }

  return { phoneNumbers, pending };
}

/**
 * What state the phone channel is in for one person.
 *
 * Four states rather than a boolean, because "we did not ask", "we asked and
 * Apollo holds nothing", "the reveal is still running" and "here is a number"
 * are four different things a caller does four different things about - and
 * three of them render as an empty phone field if they are collapsed.
 */
export function phoneStateFor(input: {
  readonly requested: boolean;
  readonly found: number;
  readonly pending: boolean;
}): PhoneEnrichmentState {
  if (!input.requested) return 'NOT_REQUESTED';
  if (input.found > 0) return 'AVAILABLE';
  if (input.pending) return 'PENDING';
  return 'NONE';
}

/**
 * Apollo's match confidence, when Apollo reported one.
 *
 * Returned verbatim in Apollo's own four-valued vocabulary rather than
 * converted into a number, because a number invites arithmetic that means
 * nothing - the midpoint of `high` and `low` is not a claim Apollo made.
 *
 * Two spellings are read because Apollo is not consistent about which it sends,
 * and an unrecognised or absent value yields undefined - *unknown* - rather
 * than a default, for the reason every other field in this layer does: a
 * fabricated `high` would be a claim about identity that nobody made.
 */
export function readMatchConfidence(
  person: Pick<ApolloEnrichedPersonDto, 'match_confidence' | 'confidence'>,
): EnrichmentMatchConfidence | undefined {
  const raw = person.match_confidence ?? person.confidence;
  if (typeof raw !== 'string') return undefined;

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') return normalized;
  if (normalized === 'none') return 'none';
  return undefined;
}

/**
 * Whether an enriched record carries anything a person could act on.
 *
 * The line between ENRICHED and PARTIAL, and it is drawn on *contact channels*
 * rather than on field count on purpose: a match that returned a title and a
 * seniority but no way to reach anybody has told us who they are and nothing
 * about how to talk to them, which is exactly what PARTIAL means here.
 */
function enrichmentStatusFor(input: {
  readonly linkedinUrl?: string;
  readonly workEmail?: string;
  readonly phoneCount: number;
}): ProspectEnrichmentStatus {
  const hasChannel =
    input.linkedinUrl !== undefined || input.workEmail !== undefined || input.phoneCount > 0;
  return hasChannel ? 'ENRICHED' : 'PARTIAL';
}

export interface NormalizeEnrichedPersonOptions {
  /** How the result is joined back to the candidate it belongs to. */
  readonly personRef: string;
  /** Whether phone reveal was asked for; shapes `phoneState`, never the data. */
  readonly revealPhoneNumbers: boolean;
  /** ISO 8601 timestamp for the provenance block. */
  readonly enrichedAt: string;
}

/** One Apollo enriched person as a provider-neutral prospect. */
export function normalizeApolloEnrichedPerson(
  person: ApolloEnrichedPersonDto,
  options: NormalizeEnrichedPersonOptions,
): EnrichedProspect {
  const firstName = text(person.first_name);
  const lastName = text(person.last_name);
  // The provider's own rendering wins when it sent one; the parts joined are
  // the fallback; and a person with neither stays unnamed rather than carrying
  // an empty string a UI would render as a blank line.
  const joinedName = [firstName, lastName].filter((part) => part !== undefined).join(' ');
  const fullName = text(person.name) ?? (joinedName.length > 0 ? joinedName : undefined);
  const title = text(person.title);
  const seniority = text(person.seniority);
  // Apollo sends a list; a person has one primary department and the rest are
  // sub-departments of it. Taking the first matches what the search normalizer
  // does, so the same person spells the same way on both paths.
  const department = text(person.departments?.[0]);
  const linkedinUrl = canonicalLinkedinUrl(person.linkedin_url);
  const location = normalizePersonLocation({
    ...(person.city !== undefined ? { city: person.city } : {}),
    ...(person.state !== undefined ? { state: person.state } : {}),
    ...(person.country !== undefined ? { country: person.country } : {}),
  });

  const organization = person.organization;
  const companyName = text(organization?.name) ?? text(person.organization_name);
  const companyDomain =
    normalizeCandidateDomain(organization?.primary_domain) ??
    normalizeCandidateDomain(organization?.website_url);
  const website = normalizeWebsite(organization?.website_url);
  const organizationId = text(organization?.id) ?? text(person.organization_id);

  const workEmail = normalizeWorkEmail(person.email);
  const emailStatus = text(person.email_status);
  const { phoneNumbers, pending } = normalizePhoneNumbers(person.phone_numbers);
  const matchConfidence = readMatchConfidence(person);

  return {
    personRef: options.personRef,
    provider: APOLLO_PROVIDER_ID,
    externalPersonId: person.id,
    ...(organizationId !== undefined ? { externalOrganizationId: organizationId } : {}),
    person: {
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
      ...(fullName !== undefined ? { fullName } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(seniority !== undefined ? { seniority } : {}),
      ...(department !== undefined ? { department } : {}),
      ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
      ...(location !== undefined ? { location } : {}),
    },
    company: {
      ...(companyName !== undefined ? { name: companyName } : {}),
      ...(companyDomain !== undefined ? { domain: companyDomain } : {}),
      ...(website !== undefined ? { website } : {}),
      ...(organizationId !== undefined ? { organizationId } : {}),
    },
    contact: {
      ...(workEmail !== undefined ? { workEmail } : {}),
      ...(emailStatus !== undefined ? { emailStatus } : {}),
      phoneNumbers,
      phoneState: phoneStateFor({
        requested: options.revealPhoneNumbers,
        found: phoneNumbers.length,
        pending,
      }),
    },
    enrichment: {
      status: enrichmentStatusFor({
        ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
        ...(workEmail !== undefined ? { workEmail } : {}),
        phoneCount: phoneNumbers.length,
      }),
      ...(matchConfidence !== undefined ? { matchConfidence } : {}),
      provider: APOLLO_PROVIDER_ID,
      enrichedAt: options.enrichedAt,
    },
    reachability: reachabilityFor({
      ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
      ...(workEmail !== undefined ? { workEmail } : {}),
      phoneNumbers,
    }),
  };
}

/**
 * The prospect for a candidate Apollo did not enrich.
 *
 * Returned rather than omitted, because the funnel has to add up: a candidate
 * with no entry at all is indistinguishable from one that was never sent, and
 * "Apollo does not know this person" is a finding worth keeping.
 */
export function unenrichedProspect(input: {
  readonly personRef: string;
  readonly status: ProspectEnrichmentStatus;
  readonly detail: string;
  readonly enrichedAt?: string;
  readonly externalPersonId?: string;
}): EnrichedProspect {
  return {
    personRef: input.personRef,
    provider: APOLLO_PROVIDER_ID,
    ...(input.externalPersonId !== undefined ? { externalPersonId: input.externalPersonId } : {}),
    person: {},
    company: {},
    contact: { phoneNumbers: [], phoneState: 'NOT_REQUESTED' },
    enrichment: {
      status: input.status,
      // Only for a genuine no-match: Apollo was asked and said it could not
      // identify the person, which *is* a confidence of none. A failure or a
      // plan refusal reports no confidence, because Apollo never got to judge.
      ...(input.status === 'NO_MATCH' ? { matchConfidence: 'none' as const } : {}),
      provider: APOLLO_PROVIDER_ID,
      ...(input.enrichedAt !== undefined ? { enrichedAt: input.enrichedAt } : {}),
      detail: input.detail,
    },
    reachability: { hasLinkedIn: false, hasWorkEmail: false, hasPhone: false, channels: [] },
  };
}
