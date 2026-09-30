import { zodErrorToDetails, type ApiErrorDetail } from '@pursuit/shared';
import type { z } from 'zod';
import {
  apolloAuthHealthResponseSchema,
  apolloErrorBodySchema,
  apolloOrganizationSearchResponseSchema,
  type ApolloOrganizationSearchResponseDto,
} from './apollo-dto.js';
import {
  apolloPeopleSearchResponseSchema,
  type ApolloPeopleSearchResponseDto,
} from './apollo-people-dto.js';
import {
  apolloBulkMatchResponseSchema,
  apolloPeopleMatchResponseSchema,
  type ApolloBulkMatchResponseDto,
  type ApolloPeopleMatchResponseDto,
} from './apollo-enrichment-dto.js';
import {
  APOLLO_PROVIDER_ID,
  ApolloAuthenticationError,
  ApolloNetworkError,
  ApolloNotConfiguredError,
  ApolloProviderError,
  ApolloRateLimitError,
  ApolloTimeoutError,
  ApolloValidationError,
} from './apollo-errors.js';

/**
 * Low-level Apollo transport. The only file in the codebase that performs an
 * HTTP request against Apollo.
 *
 * It does exactly five things - authenticate, send, time out, retry what is
 * worth retrying, and validate - and deliberately none of the sixth: it holds
 * no opinion about what an ICP wants, whether a company qualifies, or how a
 * page of results turns into candidates. Query translation, pagination and
 * normalization all live one layer up in `ApolloService`.
 *
 * ## Endpoint
 *
 * `POST /api/v1/mixed_companies/search`, Apollo's documented organization
 * search. Its filters go in the **URL query string**, not the request body -
 * that is Apollo's own documented convention for this endpoint, not a
 * workaround. See <https://docs.apollo.io/reference/organization-search>.
 *
 * ## Credential handling
 *
 * The key travels in the `x-api-key` header and nowhere else: it is never a
 * query parameter (which would put it in every access log along the path),
 * never interpolated into a message, and never logged. `logRequest` records the
 * method, the path, the status and Apollo's request ids - enough to correlate
 * an incident with Apollo support, with nothing that could leak.
 */

/** Apollo's documented maximum page size for organization search. */
export const APOLLO_MAX_PAGE_SIZE = 100;
/** Apollo's documented display ceiling: 500 pages x 100 = 50,000 records. */
export const APOLLO_MAX_PAGE = 500;
export const APOLLO_ORGANIZATION_SEARCH_PATH = '/api/v1/mixed_companies/search';
/**
 * Apollo's people search.
 *
 * `api_search` rather than `search`: the two differ in how they take their
 * filters, and this one accepts a JSON request body, which is what lets the
 * people filters - several parallel arrays of titles, seniorities and
 * locations - be expressed without building a query string long enough to hit
 * a URL length limit.
 *
 * See <https://docs.apollo.io/reference/people-search>.
 */
export const APOLLO_PEOPLE_SEARCH_PATH = '/api/v1/mixed_people/api_search';
/**
 * Apollo's people *enrichment* endpoints.
 *
 * A different pair of endpoints from search, not a parameter on it, and the
 * separation is Apollo's rather than ours: search returns who matches a filter
 * and explicitly does not return email addresses or phone numbers, while these
 * two return contact details for one person already identified. They are billed
 * differently for the same reason.
 *
 * See <https://docs.apollo.io/reference/people-enrichment> and
 * <https://docs.apollo.io/reference/bulk-people-enrichment>.
 */
export const APOLLO_PEOPLE_MATCH_PATH = '/api/v1/people/match';
export const APOLLO_PEOPLE_BULK_MATCH_PATH = '/api/v1/people/bulk_match';
/** Apollo's documented ceiling for one bulk enrichment request. */
export const APOLLO_BULK_MATCH_MAX = 10;
export const APOLLO_AUTH_HEALTH_PATH = '/api/v1/auth/health';
/** Which Apollo API version this adapter speaks; reported in the descriptor. */
export const APOLLO_API_VERSION = 'v1';

const MISSING_KEY_DETAIL =
  'APOLLO_API_KEY is not configured. Add it to packages/server/.env and restart the API.';

/**
 * Structured facts about one exchange, for the log.
 *
 * Contains no credential and no payload by construction - there is no field
 * here that could hold one.
 */
export interface ApolloRequestLog {
  readonly method: string;
  /** Path only. The query string is omitted: filters are not log material. */
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly attempt: number;
  /** Apollo's `x-request-id`, the id their support asks for. */
  readonly requestId?: string;
  /** Apollo's `x-http-request-id`. */
  readonly httpRequestId?: string;
  /** Requests left in the per-minute window, when Apollo reported one. */
  readonly minuteRequestsLeft?: string;
}

/**
 * Minimal logging seam.
 *
 * Structurally compatible with Fastify's logger, so `app.log` satisfies it,
 * without this module depending on Fastify.
 */
export interface ApolloLogger {
  debug(payload: object, message?: string): void;
  warn(payload: object, message?: string): void;
}

export interface ApolloClientOptions {
  /** Backend-only credential. Empty means "not configured", never "try anyway". */
  readonly apiKey: string;
  /** Apollo API root, e.g. `https://api.apollo.io`. Never hardcoded. */
  readonly baseUrl: string;
  /** Wall-clock budget for one HTTP request, including its body. */
  readonly timeoutMs: number;
  /**
   * How many times one request may be *attempted*, in total. 1 disables the
   * retry. Only transient failures are retried - see `isRetryableStatus`.
   */
  readonly maxAttempts: number;
  /** First backoff step; doubled per attempt. */
  readonly retryBaseDelayMs: number;
  readonly logger?: ApolloLogger;
  /** Injected in tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injected in tests so a backoff does not cost real wall-clock time. */
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Apollo's own filter vocabulary for one search page.
 *
 * Provider-shaped on purpose - `organizationNumEmployeesRanges` carries
 * Apollo's `"min,max"` strings - and confined to this module. Translating an
 * internal `DiscoveryQuery` into these is `ApolloService`'s job.
 */
export interface ApolloOrganizationSearchParams {
  /** `organization_locations[]`: Apollo place names, e.g. `Netherlands`. */
  readonly organizationLocations?: readonly string[];
  /** `organization_not_locations[]`. */
  readonly organizationNotLocations?: readonly string[];
  /** `organization_num_employees_ranges[]`, each `"min,max"`. */
  readonly organizationNumEmployeesRanges?: readonly string[];
  /** `q_organization_keyword_tags[]`. */
  readonly qOrganizationKeywordTags?: readonly string[];
  /** `q_organization_name`. */
  readonly qOrganizationName?: string;
  /** 1-based page. Apollo serves at most `APOLLO_MAX_PAGE`. */
  readonly page: number;
  /** At most `APOLLO_MAX_PAGE_SIZE`. */
  readonly perPage: number;
}

/**
 * Apollo's own filter vocabulary for one page of *people* search.
 *
 * Provider-shaped, and confined to this module exactly like its organization
 * sibling: `personSeniorities` carries Apollo's `c_suite`, not our `C_LEVEL`.
 * Translating an internal `PeopleQuery` into these is `ApolloPeopleService`'s
 * job.
 */
export interface ApolloPeopleSearchParams {
  /** `person_titles[]`: free-text job titles, OR-ed by Apollo. */
  readonly personTitles?: readonly string[];
  /** `person_seniorities[]`: Apollo's closed vocabulary, e.g. `c_suite`. */
  readonly personSeniorities?: readonly string[];
  /** `person_department_or_subdepartments[]`: Apollo's department taxonomy. */
  readonly personDepartments?: readonly string[];
  /** `organization_locations[]`: the employer's location, not the person's. */
  readonly organizationLocations?: readonly string[];
  /** `organization_not_locations[]`. */
  readonly organizationNotLocations?: readonly string[];
  /** `organization_num_employees_ranges[]`, each `"min,max"`. */
  readonly organizationNumEmployeesRanges?: readonly string[];
  /** `q_organization_keyword_tags[]`. */
  readonly qOrganizationKeywordTags?: readonly string[];
  /** 1-based page. Apollo serves at most `APOLLO_MAX_PAGE`. */
  readonly page: number;
  /** At most `APOLLO_MAX_PAGE_SIZE`. */
  readonly perPage: number;
}

/**
 * One person to enrich, in Apollo's own request vocabulary.
 *
 * Every field is optional and at least one must be set - which the *caller*
 * guarantees by resolving an identity first, rather than this type expressing
 * it as a union. A union of five single-field shapes would be unreadable, and
 * the rule it would encode ("enough to identify a human") is a domain rule that
 * already lives in `enrichmentIdentityFor`.
 */
export interface ApolloPersonMatchDetails {
  /** Apollo's own person id - the exact, preferred identifier. */
  readonly id?: string;
  readonly linkedinUrl?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly name?: string;
  /** The employer's registrable domain, used together with a name. */
  readonly domain?: string;
}

/**
 * Enrichment options that cost money or change the response's timing.
 *
 * Both default to off at the caller. `revealPhoneNumbers` in particular is not
 * a free flag: Apollo consumes a separate credit for it and resolves the reveal
 * *asynchronously*, so the numbers may not be in the response that asked for
 * them.
 */
export interface ApolloEnrichmentOptions {
  readonly revealPhoneNumbers?: boolean;
  /**
   * Ask Apollo to answer inline instead of calling a webhook back.
   *
   * Apollo requires a `webhook_url` for an asynchronous phone reveal *unless*
   * the request is poll-only. This application has no public HTTPS webhook
   * infrastructure, so poll-only is the only honest option: whatever Apollo has
   * ready is returned, anything still running is reported as pending, and a
   * later run picks it up. Building a webhook receiver for one bounded stage
   * would be a larger commitment than the stage is worth.
   */
  readonly pollOnly?: boolean;
}

/** Statuses where trying again is the correct response, not a wish. */
function isRetryableStatus(status: number): boolean {
  // 408 Request Timeout and 5xx are transient by definition. 429 is *not*
  // retried here: a rate limit is a typed answer the caller has to see, and
  // hammering an exhausted window makes it worse.
  if (status === 408) return true;
  return status >= 500 && status <= 599;
}

/** `retry-after` in whole seconds, when Apollo sent one. */
function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim().length === 0) return undefined;
  const seconds = Number.parseFloat(raw);
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : undefined;
}

/**
 * Apollo's own account of a failure, from its `{ error, error_code }` body.
 *
 * Best-effort: a body that is not Apollo's envelope yields an empty string
 * rather than a guess, and this never throws while an error is being built.
 * Worth the effort because Apollo's 403 explains itself - "This API key is not
 * authorized to access api/v1/mixed_companies/search" is an actionable
 * instruction, and dropping it would leave an operator with a bare status.
 */
function describeApolloError(body: unknown): string {
  const parsed = apolloErrorBodySchema.safeParse(body);
  if (!parsed.success) return '';
  const { error, error_code: code, message } = parsed.data;
  const text = error ?? message ?? '';
  if (text.length === 0) return code ? `error_code=${code}` : '';
  return code ? `${text} (error_code=${code})` : text;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * How one request carries its filters.
 *
 * Apollo is not consistent about this and the client has to be able to do
 * both: organization search reads its filters from the **query string**, while
 * people `api_search` reads them from a **JSON body**. Neither is a workaround;
 * they are the two endpoints' own documented conventions, and pretending
 * otherwise would mean one of the two searches silently returning unfiltered
 * results.
 */
interface ApolloRequestPayload {
  readonly query?: string;
  /** Serialized as the JSON request body. Omitted means `{}` for a POST. */
  readonly body?: Record<string, unknown>;
}

/** One completed exchange, before it is interpreted. */
interface ApolloHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
  /** Set when the body was not JSON; the status then carries the whole story. */
  readonly bodyText?: string;
}

export class ApolloClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Base URL with any trailing slash removed, so paths concatenate cleanly. */
  private readonly baseUrl: string;

  constructor(private readonly options: ApolloClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  /** "A credential is present". Whether Apollo accepts it is `authHealth`'s job. */
  isConfigured(): boolean {
    return this.options.apiKey.trim().length > 0;
  }

  describe(): { id: string; version: string; maxPageSize: number; available: boolean } {
    return {
      id: APOLLO_PROVIDER_ID,
      version: APOLLO_API_VERSION,
      maxPageSize: APOLLO_MAX_PAGE_SIZE,
      available: this.isConfigured(),
    };
  }

  /**
   * Credential probe: `GET /api/v1/auth/health`.
   *
   * Chosen because it is the one Apollo endpoint that costs no credits and
   * needs no filters, so a health check can never spend a search page. It
   * proves the key is present and accepted; it deliberately cannot prove the
   * key's *scope* covers organization search, since Apollo only reveals that by
   * refusing the search itself.
   *
   * Throws the same typed errors as a search, so a caller can distinguish "no
   * key" from "key rejected" from "Apollo unreachable".
   */
  async authHealth(): Promise<{ healthy: boolean; loggedIn: boolean }> {
    const response = await this.send('GET', APOLLO_AUTH_HEALTH_PATH);
    const parsed = this.validate(apolloAuthHealthResponseSchema, response.body, 'auth health');
    return { healthy: parsed.healthy ?? false, loggedIn: parsed.is_logged_in ?? false };
  }

  /**
   * One page of organization search, validated.
   *
   * Rejects an out-of-range page or page size before spending a request:
   * Apollo answers a `per_page` of 500 by silently serving 100, and a caller
   * that believed otherwise would quietly lose 400 companies. Better to fail
   * where the mistake is.
   */
  async searchOrganizations(
    params: ApolloOrganizationSearchParams,
  ): Promise<ApolloOrganizationSearchResponseDto> {
    this.assertPaging(params.page, params.perPage, 'organizations');

    const response = await this.send('POST', APOLLO_ORGANIZATION_SEARCH_PATH, {
      query: this.searchQueryString(params),
    });
    return this.validate(
      apolloOrganizationSearchResponseSchema,
      response.body,
      'organization search',
    );
  }

  /**
   * One page of people search, validated.
   *
   * Range-checks the page and page size before spending a request, for the
   * same reason the organization search does: Apollo answers an out-of-range
   * `per_page` by silently serving its own maximum, and a caller that believed
   * otherwise would quietly lose the difference. Better to fail where the
   * mistake is than to under-report leads that were never fetched.
   */
  async searchPeople(params: ApolloPeopleSearchParams): Promise<ApolloPeopleSearchResponseDto> {
    this.assertPaging(params.page, params.perPage, 'people');

    const response = await this.send('POST', APOLLO_PEOPLE_SEARCH_PATH, {
      body: this.peopleSearchBody(params),
    });
    return this.validate(apolloPeopleSearchResponseSchema, response.body, 'people search');
  }

  /**
   * Enriches one person: `POST /api/v1/people/match`.
   *
   * Kept alongside the bulk call rather than expressed as a batch of one,
   * because Apollo's two endpoints answer in different shapes - `{ person }`
   * against `{ matches: [...] }` - and pretending otherwise would mean one of
   * the two responses is validated against the wrong contract.
   */
  async matchPerson(
    details: ApolloPersonMatchDetails,
    options: ApolloEnrichmentOptions = {},
  ): Promise<ApolloPeopleMatchResponseDto> {
    const body = { ...this.matchDetails(details), ...this.enrichmentFlags(options) };
    const response = await this.send('POST', APOLLO_PEOPLE_MATCH_PATH, { body });
    return this.validate(apolloPeopleMatchResponseSchema, response.body, 'people enrichment');
  }

  /**
   * Enriches up to `APOLLO_BULK_MATCH_MAX` people in one request:
   * `POST /api/v1/people/bulk_match`.
   *
   * The batch size is range-checked before the request is spent, for the same
   * reason the search paging is: Apollo answers an oversized batch by enriching
   * its own maximum, and a caller that believed otherwise would silently lose
   * the remainder while being billed for what did land.
   *
   * The response's `matches` array is positional - one entry per requested
   * record, null where nothing matched - so the caller joins on index. That
   * contract is why nothing here filters or reorders the array.
   */
  async bulkMatchPeople(
    people: readonly ApolloPersonMatchDetails[],
    options: ApolloEnrichmentOptions = {},
  ): Promise<ApolloBulkMatchResponseDto> {
    if (people.length === 0 || people.length > APOLLO_BULK_MATCH_MAX) {
      throw new ApolloValidationError(
        `Apollo enriches 1..${String(APOLLO_BULK_MATCH_MAX)} people per bulk request; ${String(people.length)} were sent`,
        [
          {
            path: 'details',
            message: `must contain between 1 and ${String(APOLLO_BULK_MATCH_MAX)} people`,
          },
        ],
      );
    }

    const response = await this.send('POST', APOLLO_PEOPLE_BULK_MATCH_PATH, {
      body: {
        details: people.map((person) => this.matchDetails(person)),
        ...this.enrichmentFlags(options),
      },
    });
    return this.validate(apolloBulkMatchResponseSchema, response.body, 'bulk people enrichment');
  }

  /**
   * One person's identifiers, under Apollo's own key names.
   *
   * Empty values are omitted rather than sent as `""`, for the reason the
   * search body builder omits empty lists: a blank `first_name` is a filter
   * matching nobody, where an absent key means "identify them by what I did
   * send".
   */
  private matchDetails(details: ApolloPersonMatchDetails): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    const put = (key: string, value: string | undefined): void => {
      const cleaned = value?.trim();
      if (cleaned !== undefined && cleaned.length > 0) body[key] = cleaned;
    };

    put('id', details.id);
    put('linkedin_url', details.linkedinUrl);
    put('first_name', details.firstName);
    put('last_name', details.lastName);
    put('name', details.name);
    put('domain', details.domain);

    return body;
  }

  /**
   * The reveal flags, sent only when they are actually on.
   *
   * `reveal_personal_emails` is never sent. This stage is after a *work*
   * contact - a personal address is a different consent question with a
   * different legal basis, and a flag that is absent cannot be turned on by
   * accident later.
   */
  private enrichmentFlags(options: ApolloEnrichmentOptions): Record<string, unknown> {
    if (options.revealPhoneNumbers !== true) return {};
    return {
      reveal_phone_number: true,
      // Apollo demands a `webhook_url` for an async reveal unless the request
      // is poll-only, and this application has no webhook receiver to give it.
      ...(options.pollOnly === false ? {} : { poll_only: true }),
    };
  }

  /**
   * Apollo's people filters, as a JSON body.
   *
   * Array filters are plain JSON arrays under Apollo's own `snake_case` names -
   * the body form of the `key[]` repetition the organization search uses in its
   * query string. Empty lists are omitted entirely rather than sent as `[]`,
   * for exactly the reason the query-string builder omits them: an empty
   * `person_titles` is a filter matching nothing, where sending no key at all
   * means "do not filter on title" - the difference between every lead and
   * none.
   */
  private peopleSearchBody(params: ApolloPeopleSearchParams): Record<string, unknown> {
    const body: Record<string, unknown> = {
      page: params.page,
      per_page: params.perPage,
    };

    const put = (key: string, values: readonly string[] | undefined): void => {
      const cleaned = (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
      if (cleaned.length > 0) body[key] = cleaned;
    };

    put('person_titles', params.personTitles);
    put('person_seniorities', params.personSeniorities);
    put('person_department_or_subdepartments', params.personDepartments);
    put('organization_locations', params.organizationLocations);
    put('organization_not_locations', params.organizationNotLocations);
    put('organization_num_employees_ranges', params.organizationNumEmployeesRanges);
    put('q_organization_keyword_tags', params.qOrganizationKeywordTags);

    return body;
  }

  /** Shared page/page-size range check for both search endpoints. */
  private assertPaging(page: number, perPage: number, what: string): void {
    if (!Number.isInteger(page) || page < 1 || page > APOLLO_MAX_PAGE) {
      throw new ApolloValidationError(
        `Apollo serves pages 1..${String(APOLLO_MAX_PAGE)}; page ${String(page)} was requested`,
        [{ path: 'page', message: `must be between 1 and ${String(APOLLO_MAX_PAGE)}` }],
      );
    }
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > APOLLO_MAX_PAGE_SIZE) {
      throw new ApolloValidationError(
        `Apollo serves at most ${String(APOLLO_MAX_PAGE_SIZE)} ${what} per page; ${String(perPage)} was requested`,
        [{ path: 'perPage', message: `must be between 1 and ${String(APOLLO_MAX_PAGE_SIZE)}` }],
      );
    }
  }

  /**
   * Apollo's filters, as a query string.
   *
   * Array filters repeat a `key[]` parameter, which is the form Apollo's Rails
   * backend parses. Empty lists are omitted entirely rather than sent as an
   * empty parameter: `organization_locations[]=` is a filter matching nothing,
   * where sending no parameter means "do not filter on location" - the
   * difference between every company and none.
   */
  private searchQueryString(params: ApolloOrganizationSearchParams): string {
    const search = new URLSearchParams();

    const appendAll = (key: string, values: readonly string[] | undefined): void => {
      for (const value of values ?? []) {
        if (value.trim().length === 0) continue;
        search.append(`${key}[]`, value);
      }
    };

    appendAll('organization_locations', params.organizationLocations);
    appendAll('organization_not_locations', params.organizationNotLocations);
    appendAll('organization_num_employees_ranges', params.organizationNumEmployeesRanges);
    appendAll('q_organization_keyword_tags', params.qOrganizationKeywordTags);
    if (params.qOrganizationName && params.qOrganizationName.trim().length > 0) {
      search.set('q_organization_name', params.qOrganizationName.trim());
    }
    search.set('page', String(params.page));
    search.set('per_page', String(params.perPage));

    return search.toString();
  }

  /**
   * Sends one request, with a timeout and a bounded retry, and interprets the
   * status.
   *
   * The retry covers exactly two classes of failure: the request never arrived
   * (network, DNS, dropped socket) or Apollo answered 408/5xx. Both are the
   * call not happening, and a second attempt is a reasonable response. A 401,
   * 403, 422 or 429 is Apollo telling us something true about the request or
   * the account; asking again does not change it and would only burn quota.
   */
  private async send(
    method: 'GET' | 'POST',
    path: string,
    payload: ApolloRequestPayload = {},
  ): Promise<ApolloHttpResponse> {
    if (!this.isConfigured()) throw new ApolloNotConfiguredError(MISSING_KEY_DETAIL);

    const { query, body } = payload;
    const url = query === undefined || query.length === 0
      ? `${this.baseUrl}${path}`
      : `${this.baseUrl}${path}?${query}`;
    const attempts = Math.max(1, this.options.maxAttempts);
    let lastTransient: Error | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const started = Date.now();
      let response: ApolloHttpResponse;

      try {
        response = await this.exchange(method, url, body);
      } catch (error) {
        // A timeout is bounded work that did not finish; a network failure is
        // work that never started. Both are transient, both are retried, and
        // the last one is what the caller finally sees.
        if (error instanceof ApolloTimeoutError || error instanceof ApolloNetworkError) {
          lastTransient = error;
          this.options.logger?.warn(
            { provider: APOLLO_PROVIDER_ID, path, attempt, error: error.name },
            'apollo request failed before a response',
          );
          if (attempt < attempts) {
            await this.sleep(this.backoffMs(attempt));
            continue;
          }
        }
        throw error;
      }

      this.logRequest({
        method,
        path,
        status: response.status,
        durationMs: Date.now() - started,
        attempt,
        ...this.providerIds(response.headers),
      });

      if (response.status >= 200 && response.status < 300) return response;

      if (isRetryableStatus(response.status) && attempt < attempts) {
        lastTransient = this.toError(response, path);
        await this.sleep(this.backoffMs(attempt));
        continue;
      }

      throw this.toError(response, path);
    }

    // Only reachable when every attempt failed transiently.
    throw lastTransient ?? new ApolloProviderError(`The Apollo request to ${path} failed`);
  }

  /** Exponential backoff: base, 2x base, 4x base, ... Deterministic by design. */
  private backoffMs(attempt: number): number {
    return this.options.retryBaseDelayMs * 2 ** (attempt - 1);
  }

  /**
   * One HTTP round trip.
   *
   * The timeout is enforced with an `AbortController` rather than
   * `AbortSignal.timeout`, so the timer is cleared as soon as the body is read
   * and a long-lived process does not accumulate pending timers.
   */
  private async exchange(
    method: 'GET' | 'POST',
    url: string,
    requestBody: Record<string, unknown> | undefined,
  ): Promise<ApolloHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          // The credential travels here and only here.
          'x-api-key': this.options.apiKey,
          accept: 'application/json',
          // Every POST is a JSON POST. Organization search takes its filters
          // from the query string and sends an empty object here purely so the
          // request is well-formed; people search sends its filters in it.
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(requestBody ?? {}) } : {}),
        signal: controller.signal,
      });

      const text = await response.text();
      let body: unknown;
      try {
        body = text.length === 0 ? {} : JSON.parse(text);
      } catch {
        // An HTML error page from a proxy, or a truncated body. The status is
        // interpreted as usual; `bodyText` only shapes the message.
        return {
          status: response.status,
          headers: response.headers,
          body: undefined,
          bodyText: text.slice(0, 200),
        };
      }
      return { status: response.status, headers: response.headers, body };
    } catch (error) {
      if (controller.signal.aborted) throw new ApolloTimeoutError(this.options.timeoutMs);
      const detail = error instanceof Error ? error.message : String(error);
      throw new ApolloNetworkError(`Could not reach the Apollo API: ${detail}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Maps a non-2xx response onto the port's error vocabulary. */
  private toError(response: ApolloHttpResponse, path: string): Error {
    const reported = describeApolloError(response.body);
    const suffix = reported.length > 0 ? `: ${reported}` : response.bodyText ? `: ${response.bodyText}` : '';
    const status = String(response.status);

    if (response.status === 401) {
      return new ApolloAuthenticationError(
        `Apollo rejected the configured APOLLO_API_KEY (HTTP 401)${suffix}`,
      );
    }
    if (response.status === 403) {
      // Apollo's 403 is usually `API_INACCESSIBLE`: the key is valid but its
      // configured scope excludes this endpoint. That is a console change, not
      // an outage, so the endpoint is named in the message.
      return new ApolloAuthenticationError(
        `Apollo refused ${path} for the configured APOLLO_API_KEY (HTTP 403)${suffix}`,
      );
    }
    if (response.status === 429) {
      return new ApolloRateLimitError(
        `Apollo rate limit reached on ${path} (HTTP 429)${suffix}`,
        retryAfterSeconds(response.headers),
      );
    }
    if (response.status >= 500) {
      return new ApolloProviderError(`The Apollo API answered ${status} for ${path}${suffix}`);
    }
    if (response.status >= 400) {
      // A 400/422 means the request we built is not acceptable - a malformed
      // filter, an unsupported parameter. Not retryable, and not something the
      // caller can fix.
      return new ApolloValidationError(
        `Apollo rejected the ${path} request (HTTP ${status})${suffix}`,
      );
    }
    return new ApolloProviderError(`Unexpected Apollo response ${status} for ${path}${suffix}`);
  }

  /**
   * Validates a payload before any of it is used.
   *
   * This is the gate the plan asks for: nothing unvalidated reaches the
   * normalizer, and an unusable payload becomes a structured error carrying the
   * failing field paths rather than a page of half-built companies.
   */
  private validate<TOutput>(
    schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
    body: unknown,
    what: string,
  ): TOutput {
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;

    const details: ApiErrorDetail[] = zodErrorToDetails(parsed.error, ['apollo']);

    /**
     * The *names* of the keys Apollo actually sent, and nothing else.
     *
     * A schema failure otherwise says only which field was missing, which
     * cannot distinguish "Apollo dropped one field" from "this is not that kind
     * of response at all" - and the difference decides whether the fix is to
     * loosen a schema or to fix a request. Key names are structure, not
     * content: no lead, no company, no filter and no credential can appear in
     * them, so this is safe where logging the payload would not be.
     */
    this.options.logger?.warn(
      {
        provider: APOLLO_PROVIDER_ID,
        what,
        responseKeys: this.topLevelKeys(body),
        failedPaths: details.map((detail) => detail.path),
      },
      'apollo response did not match the expected contract',
    );

    throw new ApolloValidationError(
      `The Apollo ${what} response did not match the expected contract`,
      details,
    );
  }

  /** Key names only. Never a value. */
  private topLevelKeys(body: unknown): string[] {
    if (typeof body !== 'object' || body === null) return [];
    return Array.isArray(body) ? ['<array>'] : Object.keys(body);
  }

  /** Apollo's correlation ids and rate-window headroom, for the log. */
  private providerIds(headers: Headers): Partial<ApolloRequestLog> {
    const requestId = headers.get('x-request-id');
    const httpRequestId = headers.get('x-http-request-id');
    const minuteLeft = headers.get('x-minute-requests-left');
    return {
      ...(requestId ? { requestId } : {}),
      ...(httpRequestId ? { httpRequestId } : {}),
      ...(minuteLeft ? { minuteRequestsLeft: minuteLeft } : {}),
    };
  }

  private logRequest(entry: ApolloRequestLog): void {
    const level = entry.status >= 400 ? 'warn' : 'debug';
    const payload = { provider: APOLLO_PROVIDER_ID, ...entry };
    if (level === 'warn') this.options.logger?.warn(payload, 'apollo request failed');
    else this.options.logger?.debug(payload, 'apollo request');
  }
}
