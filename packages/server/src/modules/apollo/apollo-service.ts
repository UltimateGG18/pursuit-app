import {
  DISCOVERY_LIMIT_DEFAULT,
  DISCOVERY_LIMIT_MAX,
  dedupeCandidates,
  type CompanyCandidate,
  type CompanyDiscoveryProvider,
  type DiscoveryProviderDescriptor,
  type DiscoveryProviderHealth,
  type DiscoveryQuery,
  type DiscoverySearchResult,
} from '@pursuit/shared';
import {
  APOLLO_MAX_PAGE,
  APOLLO_MAX_PAGE_SIZE,
  type ApolloClient,
  type ApolloOrganizationSearchParams,
} from './apollo-client.js';
import {
  APOLLO_PROVIDER_ID,
  ApolloNotConfiguredError,
  ApolloValidationError,
} from './apollo-errors.js';
import { normalizeApolloOrganizations } from './apollo-normalizer.js';
import {
  toApolloEmployeeRanges,
  toApolloKeywordTags,
  toApolloLocations,
} from './apollo-vocabulary.js';

/**
 * Apollo as a `CompanyDiscoveryProvider`.
 *
 * The adapter proper: it turns an internal `DiscoveryQuery` into Apollo
 * filters, walks Apollo's pages until the caller's limit is met, normalizes
 * every organization into a `CompanyCandidate`, and collapses provider-level
 * duplicates before returning.
 *
 * What it deliberately does not do, per the plan's service boundaries:
 *
 *  - **no HTTP.** Every request goes through `ApolloClient`, which owns
 *    timeouts, retries, rate-limit handling and payload validation.
 *  - **no scoring, and no qualification.** Nothing here computes a fit, decides
 *    a company is unsuitable, or drops a row for being thinly populated. A
 *    company Apollo returned is a candidate; whether it survives is a later
 *    stage's decision, and errors from below are propagated rather than
 *    swallowed into a shorter result list.
 */

export interface ApolloServiceOptions {
  readonly client: ApolloClient;
  /**
   * Hard ceiling on pages per search, independent of the caller's limit.
   *
   * Apollo bills a credit per page, so an unbounded walk is a spend risk, not
   * just a latency one. This is the stop that does not depend on a caller
   * having asked for a sensible limit.
   */
  readonly maxPagesPerSearch: number;
}

/**
 * The Apollo filters one internal query becomes.
 *
 * Kept as its own step so the translation is inspectable - and testable -
 * without sending a request.
 */
export interface ApolloQueryTranslation {
  readonly filters: Omit<ApolloOrganizationSearchParams, 'page' | 'perPage'>;
  /**
   * Parts of the query Apollo's organization search cannot express, named so a
   * caller is never left believing a filter was applied. They are not dropped
   * quietly: the discovery run reports them, and the later hard-filter stage is
   * where they actually get enforced.
   */
  readonly unsupported: readonly string[];
}

/**
 * Internal query -> Apollo filters.
 *
 * Exported because what a provider *cannot* filter on is as important as what
 * it can, and a test should be able to assert both without a fetch mock.
 *
 * Four things are translated - included countries, excluded countries,
 * industries, employee bounds - because those are the four Apollo's
 * organization search documents a filter for. Everything else in the internal
 * query is reported as unsupported rather than approximated:
 *
 *  - **company types and maturity stages** have no documented Apollo filter.
 *    `PE_BACKED` could be guessed at through funding parameters, and a guess
 *    that silently narrows a search is worse than an honest omission.
 *  - **technologies** would use `currently_using_any_of_technology_uids[]`,
 *    whose values are opaque Apollo uids. They can only be discovered from an
 *    Apollo endpoint this key cannot reach, so sending invented uids would
 *    produce a filter matching nothing - a search that looks like it worked and
 *    returns an empty page. Section 11 of the task does not require technology
 *    discovery; this is why it is not smuggled in.
 *  - **excluded industries** cannot be expressed: Apollo's keyword tags are an
 *    OR-list with no negation. Suppression and exclusion are a later slice by
 *    design, and this is one of the reasons they have to be.
 */
export function translateQuery(query: DiscoveryQuery): ApolloQueryTranslation {
  const unsupported: string[] = [];

  const locations = toApolloLocations(query.geography?.countries ?? []);
  const notLocations = toApolloLocations(query.geography?.excludedCountries ?? []);
  const keywordTags = toApolloKeywordTags(query.companyProfile?.industries ?? []);
  const employeeRanges = toApolloEmployeeRanges(
    query.companyProfile?.employeeMin,
    query.companyProfile?.employeeMax,
  );

  // Regions are not sent: the criteria contract already requires at least one
  // included country, so countries are the precise filter and a region name
  // would only widen it back out.
  if ((query.geography?.regions?.length ?? 0) > 0) unsupported.push('geography.regions');
  if ((query.companyProfile?.excludedIndustries?.length ?? 0) > 0) {
    unsupported.push('companyProfile.excludedIndustries');
  }
  if ((query.companyProfile?.companyTypes?.length ?? 0) > 0) {
    unsupported.push('companyProfile.companyTypes');
  }
  if ((query.companyProfile?.maturity?.length ?? 0) > 0) {
    unsupported.push('companyProfile.maturity');
  }
  if ((query.technology?.requiredTechnologies?.length ?? 0) > 0) {
    unsupported.push('technology.requiredTechnologies');
  }
  if ((query.technology?.preferredTechnologies?.length ?? 0) > 0) {
    unsupported.push('technology.preferredTechnologies');
  }

  return {
    filters: {
      ...(locations.length > 0 ? { organizationLocations: locations } : {}),
      ...(notLocations.length > 0 ? { organizationNotLocations: notLocations } : {}),
      ...(employeeRanges.length > 0 ? { organizationNumEmployeesRanges: employeeRanges } : {}),
      ...(keywordTags.length > 0 ? { qOrganizationKeywordTags: keywordTags } : {}),
    },
    unsupported,
  };
}

/**
 * Reads the caller's opaque cursor as an Apollo page number.
 *
 * Apollo paginates by page, so the cursor is the page to resume at - but it is
 * still typed as an opaque string in the port, because the next provider may
 * paginate differently and no caller should be able to depend on this.
 *
 * A malformed cursor is rejected rather than reset to page 1: silently
 * restarting a paged walk would hand the caller the first page again and look
 * like Apollo had run out of results.
 */
export function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 1;
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1 || page > APOLLO_MAX_PAGE) {
    throw new ApolloValidationError(
      `"${cursor}" is not a valid Apollo pagination cursor`,
      [{ path: 'cursor', message: `must be an integer page between 1 and ${String(APOLLO_MAX_PAGE)}` }],
    );
  }
  return page;
}

export class ApolloService implements CompanyDiscoveryProvider {
  constructor(private readonly options: ApolloServiceOptions) {}

  describe(): DiscoveryProviderDescriptor {
    const client = this.options.client.describe();
    return {
      id: client.id,
      displayName: `Apollo organization search (API ${client.version})`,
      version: client.version,
      maxPageSize: client.maxPageSize,
      available: client.available,
    };
  }

  /**
   * Configuration and reachability probe. Total by design: callers render a
   * status from it, so an unreachable Apollo is a result, not an exception.
   *
   * It reports honestly on what it cannot know. `/auth/health` proves the key
   * is present and accepted, and nothing more - Apollo only reveals whether a
   * key's scope covers organization search by refusing the search - so a
   * healthy result says exactly that rather than implying discovery will work.
   */
  async healthCheck(): Promise<DiscoveryProviderHealth> {
    const base = { provider: APOLLO_PROVIDER_ID, checkedAt: new Date().toISOString() };

    try {
      const health = await this.options.client.authHealth();
      if (!health.healthy || !health.loggedIn) {
        return {
          ...base,
          available: false,
          detail: 'The Apollo API is reachable but did not accept the configured APOLLO_API_KEY.',
        };
      }
      return {
        ...base,
        available: true,
        detail:
          'Apollo API reachable and the configured APOLLO_API_KEY was accepted. Whether the key\'s scope includes organization search is only reported when a search is run.',
      };
    } catch (error) {
      if (error instanceof ApolloNotConfiguredError) {
        return { ...base, available: false, detail: error.reason ?? error.message };
      }
      // Every other failure is already in the port's vocabulary and carries a
      // credential-free message; see `apollo-errors.ts`.
      return {
        ...base,
        available: false,
        detail: error instanceof Error ? error.message : 'The Apollo health check failed.',
      };
    }
  }

  /**
   * One discovery search: translate, page, normalize, de-duplicate.
   *
   * Pages are walked *sequentially* rather than in parallel. Apollo's rate
   * limits are per minute and a burst of concurrent pages is the fastest way to
   * a 429; a serial walk also means the page that fails is the page reported,
   * and everything already collected stays coherent.
   */
  async search(query: DiscoveryQuery): Promise<DiscoverySearchResult> {
    const limit = this.effectiveLimit(query.limit);
    const { filters, unsupported } = translateQuery(query);
    const startPage = parseCursor(query.cursor);

    const collected: CompanyCandidate[] = [];
    /** The page a continuation would start from; never one already fetched. */
    let nextPage = startPage;
    let pagesFetched = 0;
    let totalAvailable: number | undefined;
    /** True when Apollo has nothing further to give, as opposed to us stopping. */
    let exhausted = false;
    /** Pre-dedupe count, so the duplicate tally reflects real provider overlap. */
    let normalizedCount = 0;

    while (
      collected.length < limit &&
      pagesFetched < this.options.maxPagesPerSearch &&
      nextPage <= APOLLO_MAX_PAGE
    ) {
      const page = nextPage;
      const perPage = this.pageSize(limit - collected.length);
      const response = await this.options.client.searchOrganizations({
        ...filters,
        page,
        perPage,
      });

      pagesFetched += 1;
      totalAvailable = response.pagination.total_entries;
      nextPage = page + 1;

      const normalized = normalizeApolloOrganizations(response.organizations);
      normalizedCount += normalized.length;
      collected.push(...normalized);

      // An empty page ends the walk even when Apollo claims more pages: a stale
      // total would otherwise march us to the page ceiling. It is also the
      // ground truth about exhaustion, where `total_pages` is only a claim.
      if (response.organizations.length === 0) {
        exhausted = true;
        break;
      }
      if (page >= response.pagination.total_pages) {
        exhausted = true;
        break;
      }
    }

    // Apollo will not serve past its display ceiling, so there is no cursor to
    // offer even though more companies match.
    if (nextPage > APOLLO_MAX_PAGE) exhausted = true;

    // De-duplicated once over the whole result rather than per page, so a
    // company Apollo returns on two different pages still collapses.
    const deduped = dedupeCandidates(collected);
    const candidates = deduped.slice(0, limit);
    const duplicatesRemoved = normalizedCount - deduped.length;

    /**
     * A cursor is offered only when the walk stopped because *our* budget ran
     * out - the caller's limit or the page ceiling - and Apollo still has
     * pages. When Apollo is exhausted there is nothing to continue from, and
     * handing back a cursor would invite a request that returns an empty page.
     */
    const nextCursor = exhausted ? undefined : String(nextPage);

    return {
      candidates,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
      ...(totalAvailable !== undefined ? { totalAvailable } : {}),
      pagesFetched,
      duplicatesRemoved,
      ...(unsupported.length > 0 ? { unsupportedFilters: unsupported } : {}),
    };
  }

  /** Caller limit, bounded by the contract's own ceiling. */
  private effectiveLimit(requested: number | undefined): number {
    if (requested === undefined) return DISCOVERY_LIMIT_DEFAULT;
    return Math.min(Math.max(1, Math.trunc(requested)), DISCOVERY_LIMIT_MAX);
  }

  /**
   * Page size for the next request: as much as is still wanted, capped at
   * Apollo's documented maximum.
   *
   * Asking for exactly what is left rather than always 100 matters because a
   * page is a credit either way, and a caller wanting 5 companies should not
   * pay to have 100 returned.
   */
  private pageSize(remaining: number): number {
    return Math.min(APOLLO_MAX_PAGE_SIZE, Math.max(1, remaining));
  }
}
