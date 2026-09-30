import {
  PROSPECT_ENRICHMENT_VERSION,
  countEnrichment,
  countReachability,
  enrichmentIdentityFor,
  type EnrichPersonInput,
  type EnrichedProspect,
  type PeopleEnrichmentProvider,
  type PersonCandidate,
  type ProcessedCandidate,
  type ProspectEnrichmentResult,
} from '@pursuit/shared';
import { describeErrorForLog } from './discovery-error-mapping.js';
import type { CandidateProcessingLogger } from './candidate-processing-service.js';

/**
 * `ProspectEnrichmentService` - the domain side of contact enrichment.
 *
 * It sits between the candidate pipeline and a `PeopleEnrichmentProvider`, and
 * owns the three decisions that are *not* the provider's to make:
 *
 *  1. **Who gets enriched.** Candidates that survived the hard filters, capped
 *     by a per-run budget, and only those carrying an identity strong enough to
 *     act on.
 *  2. **What counts as a strong enough identity.** Delegated to
 *     `enrichmentIdentityFor`, so the rule is one rule rather than one per
 *     provider. A candidate with no provider id, no LinkedIn profile and no
 *     name-plus-domain is *not sent* - asking a third party to guess which human
 *     we meant produces contact details for somebody else, and there is no way
 *     to tell afterwards that it happened.
 *  3. **How the run is summarised.** Counts, never rates and never scores.
 *
 * What it explicitly does not do: score, rank, judge, or reject. A prospect the
 * provider could not match is returned with `NO_MATCH`, not dropped - the
 * question "did we try, and what came back?" has to stay answerable.
 *
 * ## Why a provider failure is not a run failure
 *
 * Enrichment is a second, separately-billed call against a third party that
 * happens *after* the search credit is already spent. A run that discovered
 * twenty-five real people and could not enrich them is still a run with
 * twenty-five real people in it. So every failure below becomes a status on a
 * prospect and a `detail` on the summary, and the caller gets its results.
 */

export interface ProspectEnrichmentServiceOptions {
  readonly provider: PeopleEnrichmentProvider;
  /**
   * Whether to ask the provider to reveal phone numbers.
   *
   * Off unless an operator turns it on. Phone reveal consumes a separate credit
   * type at Apollo and resolves asynchronously, so it is a deliberate spend
   * rather than something a search should incur by default.
   */
  readonly revealPhoneNumbers: boolean;
  /**
   * Hard ceiling on candidates enriched per run.
   *
   * A spend control, independent of the caller's page size, so a large page
   * cannot quietly turn into a large bill. Survivors beyond it are counted as
   * `skipped` rather than silently ignored.
   */
  readonly maxCandidatesPerRun: number;
  readonly logger?: CandidateProcessingLogger;
}

const NOOP_LOGGER: CandidateProcessingLogger = { info: () => undefined, warn: () => undefined };

export interface EnrichCandidatesInput {
  /** The candidates that survived suppression and the hard ICP criteria. */
  readonly candidates: readonly ProcessedCandidate[];
  /** The people those candidates reference, keyed by `rawSourceRef`. */
  readonly peopleByRef: ReadonlyMap<string, PersonCandidate>;
  /** For the log. Never a person, a company or a contact detail. */
  readonly icpId: string;
}

export class ProspectEnrichmentService {
  private readonly logger: CandidateProcessingLogger;

  constructor(private readonly options: ProspectEnrichmentServiceOptions) {
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  /**
   * Enriches a set of candidates and summarises the outcome.
   *
   * Total by design: it never throws. The provider port already contracts to
   * resolve rather than reject, and the catch below covers the case where an
   * adapter breaks that contract - because a bug in an enrichment adapter must
   * not destroy a search the user already paid for.
   */
  async enrich(input: EnrichCandidatesInput): Promise<ProspectEnrichmentResult> {
    const provider = this.options.provider.describeEnrichment();
    const { sendable, notRequested } = this.selectCandidates(input);

    this.logger.info(
      {
        icpId: input.icpId,
        provider: provider.id,
        candidates: input.candidates.length,
        requested: sendable.length,
        skipped: notRequested.length,
        revealPhoneNumbers: this.options.revealPhoneNumbers,
      },
      'prospect enrichment started',
    );

    let enriched: readonly EnrichedProspect[];
    let detail: string | undefined;

    try {
      enriched = await this.options.provider.enrichPeople(sendable, {
        revealPhoneNumbers: this.options.revealPhoneNumbers,
      });
    } catch (error) {
      // An adapter that rejected rather than reporting per-person statuses.
      // Logged with its reason, reported to the caller in our own words.
      this.logger.warn(
        { icpId: input.icpId, provider: provider.id, reason: describeErrorForLog(error) },
        'prospect enrichment failed',
      );
      detail = 'Contact enrichment failed, so no contact details were retrieved for this run.';
      enriched = sendable.map((person) => ({
        personRef: person.personRef,
        provider: provider.id,
        ...(person.identity.externalPersonId !== undefined
          ? { externalPersonId: person.identity.externalPersonId }
          : {}),
        person: {},
        company: {},
        contact: { phoneNumbers: [], phoneState: 'NOT_REQUESTED' as const },
        enrichment: { status: 'FAILED' as const, provider: provider.id, detail },
        reachability: { hasLinkedIn: false, hasWorkEmail: false, hasPhone: false, channels: [] },
      }));
    }

    /**
     * Every candidate that entered the stage, sent or not.
     *
     * The not-sent ones are included rather than omitted so the block is
     * complete: a survivor with no entry at all would be indistinguishable from
     * one the response forgot, and NOT_REQUESTED is a different - and
     * actionable - answer from NO_MATCH.
     */
    const prospects = [...enriched, ...notRequested];
    const counts = countEnrichment(prospects, notRequested.length);
    const reachability = countReachability(prospects);

    /**
     * A run-level note when *nothing* could be enriched for an account reason.
     *
     * Raised from the per-prospect statuses rather than tracked separately, so
     * the summary and the rows can never disagree. Only when every prospect
     * says UNAVAILABLE: a mixed result is a working integration with gaps, and
     * labelling that "enrichment is unavailable" would be wrong.
     */
    if (detail === undefined && counts.requested > 0 && counts.unavailable === counts.requested) {
      detail =
        prospects[0]?.enrichment.detail ??
        'Contact enrichment is not available for the current provider account.';
    }

    this.logger.info(
      {
        icpId: input.icpId,
        provider: provider.id,
        ...counts,
        linkedin: reachability.linkedin,
        email: reachability.email,
        phone: reachability.phone,
      },
      'prospect enrichment completed',
    );

    return {
      version: PROSPECT_ENRICHMENT_VERSION,
      provider: provider.id,
      prospects,
      counts,
      reachability,
      phoneRevealRequested: this.options.revealPhoneNumbers,
      ...(detail !== undefined ? { detail } : {}),
    };
  }

  /**
   * Which candidates are actually sent, and how many are not.
   *
   * Two reasons to hold one back, and both are counted rather than hidden:
   *
   *  - **Over budget.** The run's ceiling is reached. The candidate is a
   *    perfectly good prospect that simply was not paid for.
   *  - **Identity too weak.** No provider id, no LinkedIn profile, and no name
   *    with a company domain. There is no honest question to ask the provider
   *    about this person, so none is asked.
   *
   * The order is stable - the candidates arrive in it - so a repeated run with
   * the same budget enriches the same people rather than a random subset.
   */
  private selectCandidates(input: EnrichCandidatesInput): {
    sendable: EnrichPersonInput[];
    notRequested: EnrichedProspect[];
  } {
    const provider = this.options.provider.describeEnrichment();
    const sendable: EnrichPersonInput[] = [];
    const notRequested: EnrichedProspect[] = [];

    const hold = (personRef: string, detail: string): void => {
      notRequested.push({
        personRef,
        provider: provider.id,
        person: {},
        company: {},
        contact: { phoneNumbers: [], phoneState: 'NOT_REQUESTED' },
        enrichment: { status: 'NOT_REQUESTED', provider: provider.id, detail },
        reachability: { hasLinkedIn: false, hasWorkEmail: false, hasPhone: false, channels: [] },
      });
    };

    for (const candidate of input.candidates) {
      if (sendable.length >= this.options.maxCandidatesPerRun) {
        hold(
          candidate.personRef,
          `Not enriched: this run's limit of ${String(this.options.maxCandidatesPerRun)} contact lookups was reached.`,
        );
        continue;
      }

      const person = input.peopleByRef.get(candidate.personRef);
      if (!person) {
        // The two halves of the run disagree about who was processed. Held
        // rather than dropped, so the discrepancy is visible instead of silent.
        hold(candidate.personRef, 'Not enriched: this candidate has no matching person record.');
        continue;
      }

      const identity = enrichmentIdentityFor(person, provider.id);
      if (!identity) {
        hold(
          candidate.personRef,
          'Not enriched: this record carries no provider id, LinkedIn profile or name with a company domain, which is the least it takes to identify a person without guessing.',
        );
        continue;
      }

      sendable.push({ personRef: candidate.personRef, identity });
    }

    return { sendable, notRequested };
  }
}
