import {
  CANDIDATE_PROCESSING_VERSION,
  dedupePersonCandidates,
  type CandidatePersistence,
  type CandidateProcessingCounts,
  type CandidateProcessingResult,
  type CanonicalCompany,
  type IcpConfig,
  type PersonCandidate,
  type ProcessedCandidate,
  type ProspectEnrichmentResult,
} from '@pursuit/shared';
import { EntityResolutionService } from '../companies/entity-resolution-service.js';
import { FilteringService } from '../filtering/filtering-service.js';
import { checkReachability } from '../filtering/reachability.js';
import {
  SuppressionService,
  suppressionListFromIcp,
  type SuppressionList,
} from '../filtering/suppression-service.js';
import { describeErrorForLog } from './discovery-error-mapping.js';
import type { CandidateRepository, PersistSearchRunInput } from './candidate-repository.js';
import type { ProspectEnrichmentService } from './prospect-enrichment-service.js';

/**
 * `CandidateProcessingService` - the deterministic stage between discovery and
 * qualification (plan section 7, stage 1, steps 4-10).
 *
 *   PersonCandidate[]
 *     -> deduplication            provider-level, exact identity only
 *     -> entity resolution        canonical companies, merged provenance
 *     -> suppression              "excluded regardless of fit?"
 *     -> hard ICP filters         only criteria the ICP declares as hard
 *     -> contact enrichment       who are they, and how do we reach them?
 *     -> reachability sanity      is there any handle to act on at all?
 *     -> survivors + cold pool
 *
 * The order is not arbitrary. Each stage is cheaper and more certain than the
 * one after it, and each records a *more specific* reason than the one after
 * it, so a candidate is always rejected for the most fundamental thing wrong
 * with it: a duplicate is never reported as an industry mismatch, and a
 * suppressed account is never reported as unreachable.
 *
 * Enrichment is the one expensive stage, which is why it is second to last: it
 * costs a provider credit per person, so it runs only on candidates that
 * already survived every free check. And it runs *before* reachability rather
 * than after, because a people search returns neither email addresses nor phone
 * numbers at any provider - judging reachability on search data alone would
 * reject people for missing data that was never in that response, and record
 * the pipeline's own blind spot as a fact about the prospect.
 *
 * What this service is not allowed to do is the whole point of it existing:
 *
 *  - **no model, no score, no rank.** Every outcome is reproducible from the
 *    stored criteria and the stored candidate. "Survivor" means not suppressed,
 *    not rejected by a supported hard criterion, and not obviously unreachable.
 *    It does not mean good.
 *  - **no provider HTTP.** It receives candidates; it never fetches them.
 *  - **nothing discarded.** Rejected candidates come back with their reasons.
 */

export interface CandidateProcessingOptions {
  readonly icpId: string;
  readonly icpVersion: number;
  readonly analysisId?: string;
  readonly provider: string;
  readonly queryVersion: string;
  readonly startedAt: Date;
  /** Extra suppression sources, e.g. a CRM do-not-contact list. None today. */
  readonly suppressionLists?: readonly SuppressionList[];
}

export interface CandidateProcessingLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface CandidateProcessingServiceOptions {
  /** Absent when the process was built without a candidate store. */
  readonly repository?: CandidateRepository;
  /**
   * Contact enrichment for the candidates that clear the hard filters.
   *
   * Absent when no enrichment provider is configured, which is a supported
   * configuration: the pipeline still runs end to end and the result simply
   * carries no enrichment block. Injected rather than constructed here for the
   * reason the repository is - the stage's own dependencies are wired once,
   * where the rest of the application is wired.
   */
  readonly enrichment?: ProspectEnrichmentService;
  readonly logger?: CandidateProcessingLogger;
}

const NOOP_LOGGER: CandidateProcessingLogger = { info: () => undefined, warn: () => undefined };

export class CandidateProcessingService {
  private readonly entityResolution = new EntityResolutionService();
  private readonly logger: CandidateProcessingLogger;

  constructor(private readonly options: CandidateProcessingServiceOptions = {}) {
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  async process(
    config: IcpConfig,
    people: readonly PersonCandidate[],
    options: CandidateProcessingOptions,
  ): Promise<CandidateProcessingResult> {
    // Counts and ids only. A lead list is personal data and never reaches a log.
    this.logger.info(
      { icpId: options.icpId, received: people.length },
      'candidate processing started',
    );

    const { kept, duplicates } = this.deduplicate(people);
    const resolution = this.entityResolution.resolve(kept);
    const companyByPerson = new Map(
      resolution.assignments.map((assignment) => [assignment.personRef, assignment.companyId]),
    );

    const suppression = new SuppressionService([
      suppressionListFromIcp(config),
      ...(options.suppressionLists ?? []),
    ]);
    const filtering = new FilteringService(config);
    const reachabilityRequired = config.targetBuyer.reachabilityRequirement !== 'NOT_REQUIRED';

    const survivors: ProcessedCandidate[] = [];
    const rejected: ProcessedCandidate[] = [...duplicates];
    /**
     * Candidates that cleared suppression and the hard criteria, held until
     * enrichment has run.
     *
     * The loop is split in two for exactly one reason: enrichment is a *batched*
     * provider call, and deciding reachability per candidate inside the loop
     * would mean one request per person - ten times the requests and ten times
     * the credits for the same answer.
     */
    const passed: { base: ProcessedCandidate; person: PersonCandidate }[] = [];

    for (const person of kept) {
      const companyId = companyByPerson.get(person.rawSourceRef);
      const company = companyId === undefined ? undefined : resolution.byId.get(companyId);
      const base = {
        personRef: person.rawSourceRef,
        providerRefs: person.providerRefs,
        ...(companyId !== undefined ? { companyId } : {}),
      };

      // 1. Suppression. First because it overrides fit entirely: an account we
      //    may not contact is not "a poor industry match", and recording it as
      //    one would make the cold pool lie about why the list is short.
      const suppressed = company === undefined ? undefined : suppression.check(company);
      if (suppressed) {
        rejected.push({
          ...base,
          state: 'SUPPRESSED',
          rejections: [{ reason: 'SUPPRESSED', detail: suppressed.detail }],
        });
        continue;
      }

      // 2. Hard ICP criteria. Every failing criterion is collected, not just
      //    the first - see `FilteringService.check`.
      const facts = { person, ...(company !== undefined ? { company } : {}) };
      const outcome = filtering.check(facts);
      if (!outcome.passed) {
        rejected.push({ ...base, state: 'COLD', rejections: outcome.rejections });
        continue;
      }

      passed.push({ base: { ...base, state: 'SURVIVOR', rejections: [] }, person });
    }

    // 3. Contact enrichment. Only on candidates that survived every free check,
    //    because this is the one stage that spends money per person.
    const enrichment = await this.enrich(passed, options, config);
    const enrichedByRef = new Map(
      (enrichment?.prospects ?? []).map((prospect) => [prospect.personRef, prospect]),
    );

    // 4. Reachability sanity, last because it is the weakest statement of the
    //    four: it says nothing about whether the candidate *should* be
    //    contacted, only whether they could be - and it is only now, with the
    //    enriched contact data in hand, an honest question to ask.
    for (const { base, person } of passed) {
      if (!reachabilityRequired) {
        survivors.push(base);
        continue;
      }

      const company = base.companyId === undefined ? undefined : resolution.byId.get(base.companyId);
      const enriched = enrichedByRef.get(base.personRef);
      const reachability = checkReachability({
        person,
        ...(company !== undefined ? { company } : {}),
        ...(enriched !== undefined ? { enriched } : {}),
      });

      if (!reachability.reachable) {
        rejected.push({
          ...base,
          state: 'COLD',
          rejections: [{ reason: 'UNREACHABLE', detail: reachability.detail }],
        });
        continue;
      }
      survivors.push(base);
    }

    const counts: CandidateProcessingCounts = {
      received: people.length,
      // Every collapsed row, including an identical record counted twice - which
      // `duplicates` deliberately does not carry a second copy of.
      duplicatesRemoved: people.length - kept.length,
      companiesResolved: resolution.companies.length,
      suppressed: rejected.filter((candidate) => candidate.state === 'SUPPRESSED').length,
      hardFilterRejected: rejected.filter((candidate) =>
        candidate.rejections.some((rejection) => rejection.reason.startsWith('HARD_')),
      ).length,
      unreachable: rejected.filter((candidate) =>
        candidate.rejections.some((rejection) => rejection.reason === 'UNREACHABLE'),
      ).length,
      survivors: survivors.length,
      cold: rejected.length,
    };

    const unsupported = filtering.unsupportedCriteria();
    const persistence = await this.persist({
      config,
      options,
      counts,
      companies: resolution.companies,
      survivors,
      rejected,
      ...(enrichment !== undefined ? { enrichment } : {}),
    });

    this.logger.info(
      {
        icpId: options.icpId,
        ...counts,
        persisted: persistence.persisted,
      },
      'candidate processing completed',
    );

    return {
      version: CANDIDATE_PROCESSING_VERSION,
      companies: resolution.companies,
      survivors,
      rejected,
      counts,
      ...(unsupported.length > 0 ? { unsupportedHardCriteria: unsupported } : {}),
      ...(enrichment !== undefined ? { enrichment } : {}),
      persistence,
    };
  }

  /**
   * Runs contact enrichment over the candidates that cleared the hard filters.
   *
   * Absent when no enrichment provider was wired into this process - which is a
   * supported configuration, not a degraded one: the run still discovers,
   * resolves, suppresses and filters, and the result simply carries no
   * enrichment block rather than one full of empty prospects.
   *
   * It is also skipped when the ICP does not require reachability at all. That
   * setting is the author saying contact channels are not part of what they are
   * looking for - an account-mapping exercise, say - and spending a credit per
   * person to answer a question nobody asked is the wrong default.
   */
  private async enrich(
    passed: readonly { base: ProcessedCandidate; person: PersonCandidate }[],
    options: CandidateProcessingOptions,
    config: IcpConfig,
  ): Promise<ProspectEnrichmentResult | undefined> {
    const enrichment = this.options.enrichment;
    if (!enrichment) return undefined;
    if (config.targetBuyer.reachabilityRequirement === 'NOT_REQUIRED') return undefined;
    if (passed.length === 0) return undefined;

    return enrichment.enrich({
      candidates: passed.map((entry) => entry.base),
      peopleByRef: new Map(passed.map((entry) => [entry.base.personRef, entry.person])),
      icpId: options.icpId,
    });
  }

  /**
   * Provider-level deduplication, run again here on purpose.
   *
   * The Apollo adapter already collapses duplicates inside one page, so this
   * normally removes nothing. It is not redundant: this stage's contract is
   * "given candidates, produce survivors", and a stage that assumed its input
   * was already de-duplicated would break the moment a second provider is
   * merged in, or a caller composes two pages before processing them. Running
   * an exact-identity dedupe over an already-deduplicated list costs one pass
   * and removes an assumption.
   *
   * A collapsed row is recorded as a DUPLICATE rejection rather than dropped,
   * because "nothing was discarded" has to hold here too.
   *
   * ## Two kinds of duplicate, and only one of them is a record
   *
   * A row merged away under a *different* source reference - the same human
   * reached through two provider records, matched on their LinkedIn profile -
   * is a distinct record that was removed, so it goes to the cold pool under
   * its own reference and can be looked at.
   *
   * The *same* source reference arriving twice - the shape a provider's own
   * `people` and `contacts` lists produce when a person is in both - is one
   * record counted twice. There is nothing separate to keep: a second cold-pool
   * entry would be byte-identical to the survivor, would say nothing the count
   * does not, and would collide with the stored run's one-row-per-person key.
   * It is counted in `duplicatesRemoved` and not duplicated in the output.
   *
   * So the invariant is per distinct source reference: every one of them ends
   * up in exactly one of `survivors` and `rejected`.
   */
  private deduplicate(people: readonly PersonCandidate[]): {
    kept: PersonCandidate[];
    duplicates: ProcessedCandidate[];
  } {
    const kept = dedupePersonCandidates(people);
    const keptRefs = new Set(kept.map((person) => person.rawSourceRef));
    const duplicates: ProcessedCandidate[] = [];
    const recorded = new Set<string>();

    for (const person of people) {
      const ref = person.rawSourceRef;
      if (keptRefs.has(ref) || recorded.has(ref)) continue;
      recorded.add(ref);
      duplicates.push({
        personRef: ref,
        providerRefs: person.providerRefs,
        state: 'COLD',
        rejections: [
          {
            reason: 'DUPLICATE',
            detail: 'Collapsed into another candidate with the same provider or LinkedIn identity',
          },
        ],
      });
    }
    return { kept, duplicates };
  }

  /**
   * Stores the run, and reports honestly when it could not.
   *
   * A write failure does **not** fail the request, and that is a deliberate
   * departure from how a failed analysis write is handled. The two are not
   * alike: an analysis whose row cannot be written has produced nothing a
   * caller can use, while a processed search has already spent a provider
   * credit and holds results the caller asked for. Throwing away paid-for,
   * correct results because an audit table is unavailable is the worse of the
   * two failures.
   *
   * It is not swallowed either. The failure is logged at warn with its reason,
   * and the response says `persisted: false` and why - so nobody is left
   * believing a search run exists.
   */
  private async persist(input: {
    config: IcpConfig;
    options: CandidateProcessingOptions;
    counts: CandidateProcessingCounts;
    companies: readonly CanonicalCompany[];
    survivors: readonly ProcessedCandidate[];
    rejected: readonly ProcessedCandidate[];
    enrichment?: ProspectEnrichmentResult;
  }): Promise<CandidatePersistence> {
    const repository = this.options.repository;
    if (!repository) {
      return {
        persisted: false,
        detail: 'No candidate store is configured, so this run was processed but not recorded.',
      };
    }

    const { options } = input;
    const payload: PersistSearchRunInput = {
      icpProfileId: options.icpId,
      icpVersion: options.icpVersion,
      ...(options.analysisId !== undefined ? { analysisId: options.analysisId } : {}),
      provider: options.provider,
      queryVersion: options.queryVersion,
      processingVersion: CANDIDATE_PROCESSING_VERSION,
      startedAt: options.startedAt,
      completedAt: new Date(),
      counts: input.counts,
      companies: input.companies,
      candidates: [...input.survivors, ...input.rejected],
      // Written against the candidates in the same transaction, so a stored run
      // can never hold contact details for a candidate row that was not
      // committed - or a candidate whose enrichment silently went missing.
      ...(input.enrichment !== undefined ? { enrichment: input.enrichment } : {}),
    };

    try {
      const { searchRunId } = await repository.saveRun(payload);
      return { persisted: true, searchRunId };
    } catch (error) {
      this.logger.warn(
        { icpId: options.icpId, reason: describeErrorForLog(error) },
        'could not store the processed search run',
      );
      return {
        persisted: false,
        // Our own copy. A driver message can carry a connection string, a
        // schema name or a constraint definition, and it stays in the log.
        detail: 'The results could not be recorded. They are shown but were not stored.',
      };
    }
  }
}
