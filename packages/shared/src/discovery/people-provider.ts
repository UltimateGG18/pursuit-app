import type { PersonCandidate } from './person-candidate.js';
import type { PeopleQuery } from './people-query.js';
import type { DiscoveryProviderDescriptor, DiscoveryProviderHealth } from './provider.js';
import { DiscoveryProviderNotConfiguredError } from './errors.js';

/**
 * `PeopleDiscoveryProvider` - the seam a *contact* data provider plugs into.
 *
 * A sibling of `CompanyDiscoveryProvider`, not an extension of it, because the
 * two answer different questions against different provider endpoints and
 * return different contracts. One adapter class may implement both - Apollo
 * does - but a provider that only sells firmographics, or only sells contacts,
 * implements exactly the one it can honour rather than stubbing the other.
 *
 * The pipeline is the same shape as the company one:
 *
 *   ICP -> PeopleQuery -> provider adapter -> provider API -> provider DTO
 *     -> normalizer -> PersonCandidate
 *
 * And the same constraints carry over:
 *  - a provider returns *normalized* candidates, never its own DTOs;
 *  - a provider never scores, ranks, filters or rejects a person;
 *  - provider references are preserved so entity resolution can merge later.
 */

/**
 * One page of results, as the provider reported it.
 *
 * `page` and `perPage` are always known - they are what was asked for. The
 * totals are **optional**, because a provider is not obliged to count: Apollo's
 * people search answers some requests with results and no pagination block at
 * all. Absent means "not reported", never zero, so a caller can tell "no
 * further leads" from "the provider did not say how many there are".
 */
export interface PeoplePageInfo {
  /** 1-based page this result is. */
  readonly page: number;
  readonly perPage: number;
  /** Total people the provider says match the filters, when it says. */
  readonly totalEntries?: number;
  readonly totalPages?: number;
  /**
   * Whether another page is worth requesting.
   *
   * Present because it is answerable even when the totals are not: a full page
   * means there is plausibly more, a short one means the result set ran out.
   * A caller paging through results needs this exact question answered, and
   * deriving it from a total it may not have is not possible.
   */
  readonly hasMore: boolean;
}

export interface PeopleSearchResult {
  readonly people: readonly PersonCandidate[];
  readonly pagination: PeoplePageInfo;
  /** People dropped as provider-level duplicates on this page. */
  readonly duplicatesRemoved: number;
  /**
   * Paths in the internal query this provider could not express, e.g.
   * `buyer.departments`.
   *
   * Reported rather than dropped in silence, for exactly the reason the
   * company port gives: a caller who asked for procurement leads has to be able
   * to tell "the provider cannot filter on that department" from "there are no
   * such people".
   */
  readonly unsupportedFilters?: readonly string[];
}

export interface PeopleDiscoveryProvider {
  describePeople(): DiscoveryProviderDescriptor;

  /** Cheap reachability probe. Never throws; reports unavailability instead. */
  peopleHealthCheck(): Promise<DiscoveryProviderHealth>;

  /**
   * Runs one internal people query and returns normalized, de-duplicated
   * candidates for a single page.
   *
   * One page per call, deliberately: unlike firmographic discovery - which
   * walks pages to fill a server-side budget - people search is browsed by a
   * person, so the caller decides when the next page is worth its credit.
   */
  searchPeople(query: PeopleQuery): Promise<PeopleSearchResult>;
}

/**
 * The people provider selected by `DISCOVERY_PROVIDER=none`.
 *
 * Keeps "the system works with no data provider configured" enforceable rather
 * than aspirational: the API boots, ICPs and analyses keep working, and only a
 * prospect search reports the provider as unavailable.
 */
export class NullPeopleDiscoveryProvider implements PeopleDiscoveryProvider {
  describePeople(): DiscoveryProviderDescriptor {
    return {
      id: 'none',
      displayName: 'No contact data provider configured',
      version: '0.0.0',
      maxPageSize: 0,
      available: false,
    };
  }

  peopleHealthCheck(): Promise<DiscoveryProviderHealth> {
    return Promise.resolve({
      available: false,
      provider: 'none',
      checkedAt: new Date().toISOString(),
      detail: 'DISCOVERY_PROVIDER is set to "none", so no contact data provider is connected.',
    });
  }

  searchPeople(_query: PeopleQuery): Promise<PeopleSearchResult> {
    return Promise.reject(
      new DiscoveryProviderNotConfiguredError(
        'none',
        'No contact data provider is configured. Set DISCOVERY_PROVIDER=apollo and provide APOLLO_API_KEY.',
      ),
    );
  }
}
