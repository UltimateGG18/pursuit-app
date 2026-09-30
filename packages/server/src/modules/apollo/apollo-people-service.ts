import {
  dedupePersonCandidates,
  type DiscoveryProviderDescriptor,
  type DiscoveryProviderHealth,
  type PeopleDiscoveryProvider,
  type PeoplePageInfo,
  type PeopleQuery,
  type PeopleSearchResult,
} from '@pursuit/shared';
import type { ApolloClient, ApolloPeopleSearchParams } from './apollo-client.js';
import { APOLLO_PROVIDER_ID, ApolloNotConfiguredError } from './apollo-errors.js';
import { normalizeApolloPeople } from './apollo-people-normalizer.js';
import {
  toApolloDepartments,
  toApolloSeniorities,
  toApolloTitles,
} from './apollo-people-vocabulary.js';
import { toApolloEmployeeRanges, toApolloKeywordTags, toApolloLocations } from './apollo-vocabulary.js';

/**
 * Apollo as a `PeopleDiscoveryProvider`.
 *
 * The people adapter: it turns an internal `PeopleQuery` into Apollo people
 * filters, fetches one page, normalizes every person into a `PersonCandidate`,
 * and collapses provider-level duplicates before returning.
 *
 * Its boundaries are the same as `ApolloService`'s, and are the point of the
 * class existing at all:
 *
 *  - **no HTTP.** Every request goes through `ApolloClient`, which owns
 *    timeouts, retries, rate-limit handling and payload validation.
 *  - **no scoring, and no qualification.** Nothing here decides a person is a
 *    poor lead or drops a row for being thinly populated. Errors from below
 *    propagate rather than being swallowed into a shorter result list.
 *
 * It is a separate class from `ApolloService` rather than a method on it
 * because the two implement different ports against different endpoints, and a
 * provider that sells only firmographics should be able to implement one
 * without stubbing the other. They share the client, the error vocabulary and
 * the country/industry/employee translations, which is where the real
 * duplication would have been.
 *
 * ## One page per call
 *
 * Unlike firmographic discovery - which walks pages until a server-side budget
 * is met - this fetches exactly the page asked for. People search results are
 * browsed by a person, each page costs an Apollo credit, and the caller is in a
 * better position than this class to know whether the next page is worth
 * spending one.
 */

export interface ApolloPeopleServiceOptions {
  readonly client: ApolloClient;
}

/** The Apollo people filters one internal query becomes. */
export interface ApolloPeopleQueryTranslation {
  readonly filters: Omit<ApolloPeopleSearchParams, 'page' | 'perPage'>;
  /**
   * Parts of the query Apollo's people search cannot express, named so a caller
   * is never left believing a filter was applied. Reported, never dropped in
   * silence - enforcing them belongs to the later hard-filter stage.
   */
  readonly unsupported: readonly string[];
}

/**
 * Internal people query -> Apollo people filters.
 *
 * Exported because what a provider *cannot* filter on is as important as what
 * it can, and a test should be able to assert both without a fetch mock.
 *
 * ## What is translated, and what is honestly not
 *
 * Titles, seniorities, company location, company size and industry keywords all
 * have documented Apollo people filters and are sent. Two things are not:
 *
 *  - **Departments, partially.** Apollo's department taxonomy is a closed list
 *    that six of our twelve departments map onto cleanly. `DATA`,
 *    `PROCUREMENT` and `EXECUTIVE` do not - see `apollo-people-vocabulary.ts`
 *    for why each one is a deliberate omission rather than a gap - so they are
 *    reported as unsupported and the title filter carries the search instead.
 *  - **Technologies.** They would need `currently_using_any_of_technology_uids[]`,
 *    whose values are opaque Apollo uids discoverable only from an endpoint
 *    this key cannot reach. Inventing them would produce a filter matching
 *    nothing - a search that looks like it worked and returns an empty page.
 *    The internal people query does not carry technologies at all for this
 *    reason; the firmographic path makes the same call.
 *
 * Industries go through `q_organization_keyword_tags[]`, the same
 * human-readable tag filter the organization search uses, rather than through
 * `organization_industry_tag_ids[]` - opaque ids again, same problem. Tags are
 * a looser match than an industry id, which widens recall rather than narrowing
 * it, and that is the right direction of error for a discovery stage.
 */
export function translatePeopleQuery(query: PeopleQuery): ApolloPeopleQueryTranslation {
  const unsupported: string[] = [];

  const titles = toApolloTitles(query.buyer?.titles ?? [], query.buyer?.freeTextTitles ?? []);
  const seniorities = toApolloSeniorities(query.buyer?.seniorities ?? []);
  const { departments, untranslated } = toApolloDepartments(query.buyer?.departments ?? []);
  const locations = toApolloLocations(query.company?.countries ?? []);
  const notLocations = toApolloLocations(query.company?.excludedCountries ?? []);
  const keywordTags = toApolloKeywordTags(query.company?.industries ?? []);
  const employeeRanges = toApolloEmployeeRanges(
    query.company?.employeeMin,
    query.company?.employeeMax,
  );

  if (untranslated.length > 0) {
    // Named with the specific departments, because "departments were not
    // filtered" and "procurement was not filtered" lead to different decisions.
    unsupported.push(`buyer.departments: ${untranslated.join(', ')}`);
  }

  return {
    filters: {
      ...(titles.length > 0 ? { personTitles: titles } : {}),
      ...(seniorities.length > 0 ? { personSeniorities: seniorities } : {}),
      ...(departments.length > 0 ? { personDepartments: departments } : {}),
      ...(locations.length > 0 ? { organizationLocations: locations } : {}),
      ...(notLocations.length > 0 ? { organizationNotLocations: notLocations } : {}),
      ...(employeeRanges.length > 0 ? { organizationNumEmployeesRanges: employeeRanges } : {}),
      ...(keywordTags.length > 0 ? { qOrganizationKeywordTags: keywordTags } : {}),
    },
    unsupported,
  };
}

export class ApolloPeopleService implements PeopleDiscoveryProvider {
  constructor(private readonly options: ApolloPeopleServiceOptions) {}

  describePeople(): DiscoveryProviderDescriptor {
    const client = this.options.client.describe();
    return {
      id: client.id,
      displayName: `Apollo people search (API ${client.version})`,
      version: client.version,
      maxPageSize: client.maxPageSize,
      available: client.available,
    };
  }

  /**
   * Configuration and reachability probe. Total by design: callers render a
   * status from it, so an unreachable Apollo is a result and not an exception.
   *
   * It reports honestly on what it cannot know. `/auth/health` proves the key
   * is present and accepted and nothing more - Apollo only reveals whether a
   * key's scope covers people search by refusing the search - so a healthy
   * result says exactly that rather than implying prospect search will work.
   */
  async peopleHealthCheck(): Promise<DiscoveryProviderHealth> {
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
          "Apollo API reachable and the configured APOLLO_API_KEY was accepted. Whether the key's scope includes people search is only reported when a search is run.",
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

  /** One page of people: translate, fetch, normalize, de-duplicate. */
  async searchPeople(query: PeopleQuery): Promise<PeopleSearchResult> {
    const { filters, unsupported } = translatePeopleQuery(query);

    const response = await this.options.client.searchPeople({
      ...filters,
      page: query.page,
      perPage: query.perPage,
    });

    /**
     * Both lists are normalized together. `people` are Apollo database records
     * and `contacts` are the same search's matches inside this workspace's own
     * CRM; a person can legitimately appear in both, which is exactly what the
     * de-duplication below is for.
     */
    const normalized = normalizeApolloPeople([...response.people, ...response.contacts]);
    const deduped = dedupePersonCandidates(normalized);

    return {
      people: deduped,
      pagination: this.pageInfo(query, response.pagination, response.people.length + response.contacts.length),
      duplicatesRemoved: normalized.length - deduped.length,
      ...(unsupported.length > 0 ? { unsupportedFilters: unsupported } : {}),
    };
  }

  /**
   * What is actually known about this page.
   *
   * Apollo's people search does not always return a `pagination` block, so the
   * position is taken from the request - which is authoritative, since it is
   * what we asked for - and the totals are carried through only when Apollo
   * reported them. Nothing is invented: a missing total stays missing rather
   * than becoming a zero that would render as "0 matching people" above a list
   * of matching people.
   *
   * `hasMore` is answered from the returned row count, before de-duplication.
   * A page that came back full is a page Apollo may have more of; a short page
   * is the end of the result set. That holds whether or not a total was given,
   * which is exactly why the flag exists. The pre-dedupe count is the right
   * input because Apollo's own paging is over its rows, not over our merged
   * ones - a page of 25 that collapsed to 24 is still a full Apollo page.
   */
  private pageInfo(
    query: PeopleQuery,
    reported: { page: number; per_page: number; total_entries: number; total_pages: number } | undefined,
    rawRowCount: number,
  ): PeoplePageInfo {
    const page = reported?.page ?? query.page;
    const perPage = reported?.per_page ?? query.perPage;
    const totalPages = reported?.total_pages;

    const hasMore =
      totalPages !== undefined ? page < totalPages : rawRowCount >= query.perPage;

    return {
      page,
      perPage,
      ...(reported?.total_entries !== undefined ? { totalEntries: reported.total_entries } : {}),
      ...(totalPages !== undefined ? { totalPages } : {}),
      hasMore,
    };
  }
}
