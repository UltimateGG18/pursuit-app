import type { CompanyCandidate } from './candidate.js';
import type { DiscoveryQuery } from './query.js';
import { DiscoveryProviderNotConfiguredError } from './errors.js';

/**
 * `CompanyDiscoveryProvider` - the seam a company data provider plugs into.
 *
 * The pipeline this port belongs to is:
 *
 *   ICP -> DiscoveryService -> DiscoveryStrategy -> provider adapter
 *     -> provider API -> provider DTO -> normalizer -> CompanyCandidate
 *
 * Only the Apollo firmographic path is implemented. Everything downstream of
 * `CompanyCandidate` - entity resolution, suppression, hard filtering, scoring -
 * sits behind later seams, so adding it changes nothing here.
 *
 * Deliberate constraints, carried from the implementation plan:
 *  - a provider returns *normalized* candidates, never its own DTOs;
 *  - a provider never scores, ranks, filters or rejects a company;
 *  - provider references are preserved so entity resolution can merge later.
 */

export interface DiscoveryProviderDescriptor {
  /** Stable identifier, e.g. `none` or `apollo`. */
  readonly id: string;
  readonly displayName: string;
  /** Which provider API/endpoint version answers; stored with each run. */
  readonly version: string;
  /** Largest page the provider will serve, so a caller can size its request. */
  readonly maxPageSize: number;
  /** False when no provider is wired up or a credential is missing. */
  readonly available: boolean;
}

export interface DiscoveryProviderHealth {
  readonly available: boolean;
  readonly provider: string;
  readonly checkedAt: string;
  /** Operator-facing explanation. Never contains a credential. */
  readonly detail: string;
}

export interface DiscoverySearchResult {
  readonly candidates: readonly CompanyCandidate[];
  /**
   * Continuation token for the next call, absent when the provider has no more
   * results. Opaque to every caller.
   */
  readonly nextCursor?: string;
  /** What the provider said it holds in total, when it said. */
  readonly totalAvailable?: number;
  /** Pages actually fetched, so credit spend stays observable. */
  readonly pagesFetched: number;
  /** Candidates dropped as provider-level duplicates. */
  readonly duplicatesRemoved: number;
  /**
   * Paths in the internal query this provider could not express, e.g.
   * `companyProfile.companyTypes`.
   *
   * Reported rather than dropped in silence. A caller who asked for
   * VC-backed manufacturers has to be able to tell "Apollo cannot filter on
   * ownership" from "there are no such companies", and a recall-first stage
   * legitimately returns candidates a later filter still has to cut.
   */
  readonly unsupportedFilters?: readonly string[];
}

export interface CompanyDiscoveryProvider {
  describe(): DiscoveryProviderDescriptor;

  /** Cheap reachability probe. Never throws; reports unavailability instead. */
  healthCheck(): Promise<DiscoveryProviderHealth>;

  /**
   * Runs one internal query against the provider and returns normalized,
   * de-duplicated candidates.
   *
   * Implementations must validate the provider payload before normalizing it,
   * and must reject rather than repair anything that does not fit.
   */
  search(query: DiscoveryQuery): Promise<DiscoverySearchResult>;
}

/**
 * The provider selected by `DISCOVERY_PROVIDER=none`.
 *
 * It advertises nothing and throws on use, which keeps "the system works with
 * no discovery provider configured" an enforceable configuration rather than an
 * aspiration: the API boots, ICPs keep working, and only a discovery attempt
 * reports the provider as unavailable.
 */
export class NullDiscoveryProvider implements CompanyDiscoveryProvider {
  describe(): DiscoveryProviderDescriptor {
    return {
      id: 'none',
      displayName: 'No discovery provider configured',
      version: '0.0.0',
      maxPageSize: 0,
      available: false,
    };
  }

  healthCheck(): Promise<DiscoveryProviderHealth> {
    return Promise.resolve({
      available: false,
      provider: 'none',
      checkedAt: new Date().toISOString(),
      detail: 'DISCOVERY_PROVIDER is set to "none", so no company data provider is connected.',
    });
  }

  search(_query: DiscoveryQuery): Promise<DiscoverySearchResult> {
    return Promise.reject(
      new DiscoveryProviderNotConfiguredError(
        'none',
        'No discovery provider is configured. Set DISCOVERY_PROVIDER=apollo and provide APOLLO_API_KEY.',
      ),
    );
  }
}
