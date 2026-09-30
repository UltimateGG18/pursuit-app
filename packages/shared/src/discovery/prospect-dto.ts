import type { CandidateProcessingResult } from './candidate-processing.js';
import type { PersonCandidate } from './person-candidate.js';
import type { PeopleQuery } from './people-query.js';
import type { PeoplePageInfo } from './people-provider.js';

/**
 * What `POST /api/icps/:id/prospects` returns inside the `data` envelope.
 *
 * `people` is the provider-neutral contract, never provider DTOs - the UI
 * renders this and has no idea which provider answered. `pagination` is the
 * provider's own account of the result set, passed through so the client can
 * offer next/previous without guessing where the end is. `meta` is the audit
 * trail this slice can honestly produce without a `search_runs` table.
 */
export interface ProspectRunMetaDto {
  readonly icpId: string;
  readonly icpVersion: number;
  /** The analysis whose buyer strategy widened the titles, when one was used. */
  readonly analysisId?: string;
  readonly provider: string;
  readonly providerVersion: string;
  readonly queryVersion: string;
  /** The internal query that was executed; provider-neutral by contract. */
  readonly query: PeopleQuery;
  readonly returned: number;
  readonly duplicatesRemoved: number;
  /**
   * Query paths the provider could not filter on. Present so a caller is never
   * told a filter was applied when it was not.
   */
  readonly unsupportedFilters?: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface ProspectRunDto {
  /**
   * Every person discovery returned, unchanged.
   *
   * Deliberately *not* narrowed to the survivors. This list is what the
   * provider was paid for and what the pagination describes, and replacing it
   * with a filtered subset would make `hasMore` and the page totals describe a
   * result set the caller cannot see. `processing` says which of these
   * survived; the two are joined on `rawSourceRef`.
   */
  readonly people: readonly PersonCandidate[];
  readonly pagination: PeoplePageInfo;
  readonly meta: ProspectRunMetaDto;
  /**
   * The deterministic stage after discovery: dedupe, entity resolution,
   * suppression, hard ICP filters and a reachability sanity check.
   *
   * Always present, even when every candidate survived - an empty cold pool is
   * a finding, and an absent `processing` block would be indistinguishable
   * from a run in which the stage never happened.
   */
  readonly processing: CandidateProcessingResult;
}

/** What `GET /api/prospects/health` returns. */
export type ProspectHealthDto = {
  readonly available: boolean;
  readonly provider: string;
  readonly checkedAt: string;
  readonly detail: string;
};
