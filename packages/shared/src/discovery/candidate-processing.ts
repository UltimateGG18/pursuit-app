import type { ProviderRef } from './candidate.js';
import type { CanonicalCompany } from './canonical-company.js';
import type { ProspectEnrichmentResult } from './enrichment.js';

/**
 * The contract for the stage after discovery: deterministic candidate
 * processing (plan section 7, stage 1 steps 4-10).
 *
 *   PersonCandidate[]  ->  dedupe  ->  entity resolution  ->  suppression
 *     ->  hard ICP filters  ->  contact enrichment  ->  reachability sanity
 *     ->  survivors + cold pool
 *
 * **Enrichment sits before the reachability check, not after it**, and the
 * order is load-bearing rather than tidy. A people *search* does not return
 * email addresses or phone numbers at any provider - those are sold separately,
 * per person - so a reachability check run on search results alone would reject
 * people for lacking data that was never going to be in that response. The
 * result would be a funnel that quietly deletes real prospects and blames them
 * for it. So contact data is fetched first, and reachability is then a question
 * about what we actually know.
 *
 * Three rules define what may and may not live here, and they are the reason
 * this stage exists separately from qualification at all:
 *
 *  - **Deterministic only.** Every outcome in this contract is reproducible
 *    from the stored criteria and the stored candidate. No model is consulted,
 *    nothing is scored, nothing is ranked. "Survivor" means *not excluded* -
 *    it does not mean good, and this contract has no field in which to say so.
 *  - **Nothing is discarded.** A rejected candidate is returned with its
 *    reasons, not dropped. The cold pool is how a too-narrow ICP is diagnosed,
 *    and how a candidate comes back when new signals arrive.
 *  - **Missing data is unknown, not failure.** A filter that cannot see the
 *    field it filters on does not reject; it abstains. Provider coverage is
 *    uneven, and rejecting on absence would quietly delete real prospects.
 */

/** Version of this contract, stamped onto every processed run. */
export const CANDIDATE_PROCESSING_VERSION = 'candidate-processing.v1';

/**
 * Where a candidate ended up.
 *
 * A subset of the plan's candidate lifecycle - the three states this stage can
 * actually reach. QUALIFICATION_PENDING, QUALIFIED and OUTREACH belong to the
 * stages after this one and are deliberately absent rather than stubbed.
 */
export const CANDIDATE_STATES = ['SURVIVOR', 'SUPPRESSED', 'COLD'] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

/**
 * Why a candidate did not survive.
 *
 * Structured rather than prose so the cold pool is countable, filterable and
 * comparable between runs - "23 rejected" is not a diagnosis, "23 rejected on
 * employee range" is. Each rejection also carries a human-readable `detail`
 * saying which values disagreed.
 */
export const CANDIDATE_REJECTION_REASONS = [
  /** Collapsed into another candidate of the same run. */
  'DUPLICATE',
  /** On the ICP's suppression list. Never an ICP-fit judgement. */
  'SUPPRESSED',
  'HARD_LOCATION_MISMATCH',
  'HARD_INDUSTRY_MISMATCH',
  'HARD_EMPLOYEE_RANGE_MISMATCH',
  'HARD_TECHNOLOGY_MISMATCH',
  'HARD_SENIORITY_MISMATCH',
  'HARD_DEPARTMENT_MISMATCH',
  /** A `mustNiceExclude.mustHave` rule was evaluated and failed. */
  'HARD_RULE_MISMATCH',
  /** A `mustNiceExclude.exclusions` rule was evaluated and matched. */
  'HARD_EXCLUSION_MATCH',
  /** No usable identifier or contact handle at all. Not email verification. */
  'UNREACHABLE',
] as const;
export type CandidateRejectionReason = (typeof CANDIDATE_REJECTION_REASONS)[number];

export interface CandidateRejection {
  readonly reason: CandidateRejectionReason;
  /**
   * What disagreed, in terms a person can act on, e.g.
   * `Company industry TELECOM_MEDIA is not in the target industries`.
   *
   * Frontend-safe by contract: criteria values and normalized candidate values
   * only. Never a provider payload, a URL, a credential or a stack trace.
   */
  readonly detail: string;
}

/**
 * One candidate's outcome.
 *
 * Carries a *reference* to the person rather than a copy of them. The people
 * are already in the run's `people` list, and duplicating a lead record - which
 * is personal data - so that two arrays can each hold it would double the
 * payload to say nothing new. `personRef` is `PersonCandidate.rawSourceRef`,
 * which is unique per candidate and is what the UI already keys rows by.
 */
export interface ProcessedCandidate {
  readonly personRef: string;
  readonly providerRefs: readonly ProviderRef[];
  /** `CanonicalCompany.id`; absent when the provider reported no employer. */
  readonly companyId?: string;
  readonly state: CandidateState;
  /** Empty for a survivor. Every reason that applied, not just the first. */
  readonly rejections: readonly CandidateRejection[];
}

/**
 * The funnel, stage by stage.
 *
 * Every number is a count, never a rate and never a score. They are what makes
 * a run auditable without reading the candidates: a search that received 25
 * people and survived 2 is a different problem depending on whether 23 were
 * suppressed or 23 failed the employee range.
 */
export interface CandidateProcessingCounts {
  /** People handed to this stage by discovery. */
  readonly received: number;
  readonly duplicatesRemoved: number;
  readonly companiesResolved: number;
  readonly suppressed: number;
  readonly hardFilterRejected: number;
  readonly unreachable: number;
  readonly survivors: number;
  /** Everything not a survivor: suppressed + rejected + duplicates. */
  readonly cold: number;
}

/**
 * Whether the run was written down, and if not, why not.
 *
 * Reported rather than assumed. A processed run that could not be persisted is
 * still a valid answer to the question the caller asked - the provider credit
 * is already spent - but the caller must not be left believing a search run was
 * stored when it was not.
 */
export interface CandidatePersistence {
  readonly persisted: boolean;
  /** The stored `search_runs` row, when there is one. */
  readonly searchRunId?: string;
  /** Frontend-safe explanation when `persisted` is false. Never a DSN or a driver error. */
  readonly detail?: string;
}

export interface CandidateProcessingResult {
  readonly version: string;
  /** Canonical companies the survivors and the cold pool resolve to. */
  readonly companies: readonly CanonicalCompany[];
  readonly survivors: readonly ProcessedCandidate[];
  /** The cold pool: suppressed, filtered and duplicate candidates, with reasons. */
  readonly rejected: readonly ProcessedCandidate[];
  readonly counts: CandidateProcessingCounts;
  /**
   * Hard criteria in the ICP that this stage could not evaluate, named.
   *
   * The same honesty `PeopleSearchResult.unsupportedFilters` provides one stage
   * earlier, and for the same reason: a user whose ICP requires a technology
   * must be able to tell "no candidate uses it" from "no source reports
   * technologies, so the requirement was not applied". Silence would read as
   * the first while meaning the second.
   */
  readonly unsupportedHardCriteria?: readonly string[];
  /**
   * Contact enrichment for the candidates that reached that stage.
   *
   * Optional, because a process built without an enrichment provider is a
   * supported configuration rather than a degraded one - the run still
   * discovers, resolves, suppresses and filters, and the response simply has no
   * enrichment block rather than one full of empty prospects.
   *
   * Present, it carries one entry per candidate that entered the stage,
   * *including* the ones the provider could not match. See
   * `ProspectEnrichmentResult`.
   */
  readonly enrichment?: ProspectEnrichmentResult;
  readonly persistence: CandidatePersistence;
}
