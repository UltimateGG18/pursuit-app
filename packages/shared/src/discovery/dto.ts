import type { DiscoveryStrategy } from '../icp/catalogs/evidence.js';
import type { CompanyCandidate } from './candidate.js';
import type { DiscoveryQuery } from './query.js';
import type { DiscoveryProviderHealth } from './provider.js';

/**
 * What `POST /api/icps/:id/discover` returns inside the `data` envelope.
 *
 * Candidates are the provider-neutral contract, never provider DTOs. The `meta`
 * block is the audit trail this slice can honestly produce without a
 * `search_runs` table: which ICP version was read, which strategies ran, which
 * provider answered, and what one run cost in pages.
 */
export interface DiscoveryRunMetaDto {
  readonly icpId: string;
  readonly icpVersion: number;
  /** Strategies that actually executed. */
  readonly strategies: readonly DiscoveryStrategy[];
  readonly provider: string;
  readonly providerVersion: string;
  readonly queryVersion: string;
  /** The internal query the strategy produced; provider-neutral by contract. */
  readonly query: DiscoveryQuery;
  readonly requestedLimit: number;
  readonly returned: number;
  readonly duplicatesRemoved: number;
  readonly pagesFetched: number;
  /** Total the provider reports as matching, when it reports one. */
  readonly totalAvailable?: number;
  /**
   * Query paths the provider could not filter on. Present so a caller is never
   * told a filter was applied when it was not; enforcing them belongs to the
   * hard-filter stage, which is a later slice.
   */
  readonly unsupportedFilters?: readonly string[];
  /** Pass back as `cursor` to continue; absent when the provider is exhausted. */
  readonly nextCursor?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface DiscoveryRunDto {
  readonly candidates: readonly CompanyCandidate[];
  readonly meta: DiscoveryRunMetaDto;
}

/** What `GET /api/discovery/health` returns. */
export type DiscoveryHealthDto = DiscoveryProviderHealth;
