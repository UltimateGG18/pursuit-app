import {
  normalizeLinkedinUrl,
  type CanonicalCompany,
  type EnrichedProspect,
  type PersonCandidate,
} from '@pursuit/shared';

/**
 * The reachability *sanity* check - the last gate before a candidate becomes a
 * survivor.
 *
 * The word that matters is sanity. This asks one question: does this record
 * carry any handle at all that a later stage could act on? It does not verify
 * an email address, does not call an enrichment provider, does not check
 * whether a mailbox exists, and does not judge whether the person is the right
 * person to contact. Those are expensive, they belong to qualification and
 * outreach, and doing any of them here would make a filtering pass cost money
 * per candidate.
 *
 * What it catches is the genuinely useless row: a person with no LinkedIn
 * profile, no reported email status, and no company domain. Such a record names
 * somebody nobody can reach through any channel this system has, and carrying
 * it forward into research and scoring would spend effort on an address that
 * does not exist.
 *
 * ## Why the provider's own person id does not count as a handle
 *
 * Every candidate has one - it is required by the contract - so counting it
 * would make the check unconditionally true and the stage decorative. It
 * identifies the record, not the human.
 *
 * ## Why `reachabilityRequirement: NOT_REQUIRED` skips the check entirely
 *
 * That setting is the ICP author saying reachability is not part of what they
 * are looking for - an account-mapping exercise, say. Applying the check anyway
 * would override an explicit choice. Every other setting
 * (DECISION_MAKER_REQUIRED, INFLUENCER_ACCEPTED, ANY_CONTACT) requires *some*
 * contact, which is exactly what this checks; telling them apart needs buyer
 * roles that no provider field reports, so the stricter settings are not
 * enforced more strictly here, and the limitation is reported rather than
 * faked.
 */

export interface ReachabilityInput {
  readonly person: PersonCandidate;
  readonly company?: CanonicalCompany;
  /**
   * What contact enrichment found, when the stage ran for this person.
   *
   * The reason this check is placed *after* enrichment rather than before it. A
   * people search returns no email address and no phone number at any provider,
   * so a prospect judged on search data alone can only ever be assessed on a
   * LinkedIn profile and a company domain - and one with neither would be
   * rejected for lacking data that was never going to be in that response.
   * Given enrichment, this is a question about what we actually know.
   */
  readonly enriched?: EnrichedProspect;
}

export interface ReachabilityResult {
  readonly reachable: boolean;
  /** The handles found, or why none were. Frontend-safe; never an address. */
  readonly detail: string;
}

/**
 * Email statuses that are a *report of absence* rather than a usable handle.
 *
 * Kept as a small list of the values providers actually use for "we hold
 * nothing": anything else - `verified`, `likely_to_engage`, an unfamiliar
 * label - counts as a handle, because an unrecognised status is not evidence
 * that there is no address behind it.
 */
const EMPTY_EMAIL_STATUSES = new Set(['unavailable', 'none', 'no_status', 'null', '']);

export function checkReachability(input: ReachabilityInput): ReachabilityResult {
  const { person, company, enriched } = input;
  const handles: string[] = [];

  /**
   * Enriched channels first, because they are the *verified* ones.
   *
   * A work email or a phone number the provider actually returned is a channel
   * that exists, where an email *status* is only a claim that an address
   * exists somewhere. Both count, but naming the stronger one in the detail is
   * what makes the verdict readable afterwards.
   *
   * Counted by presence, not by value: no address and no number reaches this
   * function's output, which is read by a UI and written to a log.
   */
  if (enriched) {
    if (enriched.reachability.hasWorkEmail) handles.push('work email');
    if (enriched.reachability.hasPhone) handles.push('phone number');
    if (enriched.reachability.hasLinkedIn) handles.push('LinkedIn profile');
  }

  if (
    !handles.includes('LinkedIn profile') &&
    normalizeLinkedinUrl(person.linkedinUrl) !== undefined
  ) {
    handles.push('LinkedIn profile');
  }

  const emailStatus = person.emailStatus?.trim().toLowerCase();
  if (emailStatus !== undefined && !EMPTY_EMAIL_STATUSES.has(emailStatus)) {
    // The *status*, never an address: the candidate contract carries no email,
    // and this check does not need one to know whether a handle exists.
    handles.push(`email status "${person.emailStatus ?? ''}"`);
  }

  const domain = company?.domain ?? person.company?.domain;
  if (domain !== undefined && domain.length > 0) handles.push(`company domain ${domain}`);

  if (handles.length > 0) {
    return { reachable: true, detail: `Reachable through ${handles.join(', ')}` };
  }
  return {
    reachable: false,
    detail: enriched
      ? 'Contact enrichment returned no LinkedIn profile, work email or phone number, and there is no reported email status or company domain either, so there is no channel to reach this person through'
      : 'No LinkedIn profile, no reported email status and no company domain, so there is no channel to reach this person through',
  };
}
