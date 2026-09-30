import type {
  CandidateProcessingCounts,
  CandidateState,
  CanonicalCompany,
  ProcessedCandidate,
  ProspectEnrichmentResult,
} from '@pursuit/shared';

/**
 * Persistence boundary for a processed discovery run.
 *
 * The plan's stage-1 audit trail, and the smallest version of it that is
 * actually true:
 *
 *   search run  ->  candidate  ->  company  ->  provider source
 *
 * Every candidate is written against the run that produced it, every candidate
 * points at a canonical company, and every company keeps one row per provider
 * account that resolved to it. That is enough to answer the two questions the
 * plan asks of this table set - "which run produced this candidate?" and "where
 * did we learn this company?" - and nothing more is added on the chance it
 * might be wanted later.
 *
 * The interface exists for the same reason `IcpRepository` does: the services
 * above it are tested without a live PostgreSQL, and a run is persisted by
 * whichever implementation the process was built with.
 */

/**
 * A company, exactly as entity resolution produced it.
 *
 * An alias rather than a narrower shape: the store's job is to keep what was
 * resolved, and a persistence-specific projection would be one more place for
 * a field to be quietly dropped on the way to the table.
 */
export type PersistCompanyInput = CanonicalCompany;

export interface PersistCandidateInput extends ProcessedCandidate {
  /** Restated so a caller cannot hand over a candidate with no outcome. */
  readonly state: CandidateState;
}

export interface PersistSearchRunInput {
  readonly icpProfileId: string;
  readonly icpVersion: number;
  /** The analysis that widened the query, when one was applied. */
  readonly analysisId?: string;
  readonly provider: string;
  readonly queryVersion: string;
  readonly processingVersion: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly counts: CandidateProcessingCounts;
  readonly companies: readonly PersistCompanyInput[];
  readonly candidates: readonly PersistCandidateInput[];
  /**
   * Contact enrichment for the candidates that reached that stage.
   *
   * Absent when the process has no enrichment provider. Present, each prospect
   * is written against the candidate row it belongs to - joined on
   * `personRef` - so every stored contact detail stays traceable back through
   *
   *   ICP -> search run -> candidate -> provider person -> enrichment
   *
   * which is the trail this table set exists to keep. Prospects whose
   * `personRef` matches no candidate in the run are not written: a contact
   * record with nothing to hang off is untraceable, which is precisely what it
   * would exist to prevent.
   */
  readonly enrichment?: ProspectEnrichmentResult;
}

export interface PersistedSearchRun {
  readonly searchRunId: string;
}

export interface CandidateRepository {
  /**
   * Writes one completed run: the run row, its companies and their provider
   * sources, and every candidate including the cold pool.
   *
   * One call rather than a create/append pair, because a discovery run is
   * processed in memory and is only interesting once it is complete - there is
   * no long-running lifecycle to keep a row open for, unlike an analysis, where
   * the model call can hang and the row is what proves it started.
   */
  saveRun(input: PersistSearchRunInput): Promise<PersistedSearchRun>;
}

/**
 * There is deliberately no null implementation of this port.
 *
 * A process built without a candidate store simply has no repository, the
 * pipeline is handed `undefined`, and the run reports `persisted: false` with
 * a reason. A null object would have to either throw - turning the ordinary
 * no-database case into an exception in every test - or resolve with an
 * invented run id, which is worse: a client would be told a search run was
 * stored when nothing was.
 */
