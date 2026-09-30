# Day 3 — Apollo discovery foundation

The first **Prospect Discovery** vertical slice: a stored ICP becomes a list of
provider-neutral `CompanyCandidate` objects, fetched from Apollo's organization
search API and normalized at the adapter boundary.

This slice is deliberately bounded. It implements the recall half of the plan's
Stage 1 and stops there — see [Not in this slice](#not-in-this-slice).

---

## Architecture

```
ICP / criteria  (icp.v1, stored)
      │
      ▼
POST /api/icps/:id/discover
      │
      ▼
DiscoveryService                    domain orchestration; no provider HTTP
      │
      ▼
FirmographicDiscoveryStrategy       ICP  ->  internal DiscoveryQuery   (P0)
      │
      ▼  CompanyDiscoveryProvider   ← the port; nothing above it names Apollo
      │
ApolloService                       query translation, pagination, dedupe
      │
      ▼
ApolloClient                        auth, timeout, retry, rate limits, Zod
      │
      ▼
Apollo API                          POST /api/v1/mixed_companies/search
      │
      ▼
Apollo DTO                          snake_case, confined to modules/apollo/
      │
      ▼
ApolloNormalizer                    the single provider → domain crossing
      │
      ▼
CompanyCandidate[]                  provider-neutral
```

### Why the layers are split this way

| Layer | Owns | Must not |
| --- | --- | --- |
| `ApolloClient` | One HTTP request: authentication, timeout, bounded retry, rate-limit mapping, Zod validation, request-id logging | Know what an ICP is, paginate, normalize, or decide a company qualifies |
| `ApolloService` | Internal query → Apollo filters, pagination, page-size limits, normalization, provider-level dedupe | Perform HTTP, or calculate any score |
| `FirmographicDiscoveryStrategy` | What to ask for, and which provider to ask | Perform HTTP, filter, or judge a candidate |
| `DiscoveryService` | Load criteria, run strategies, merge candidates | Own provider-specific HTTP code, score, rank, or filter |

The seam is `CompanyDiscoveryProvider` in `@pursuit/shared`. `ApolloService` is
the only class implementing it today; `ApolloClient` and the Apollo DTOs are the
only files that know Apollo exists. Adding a second data provider is one class
plus one entry in `discovery-provider-registry.ts` — no service, strategy, route
or schema change.

---

## Files

### `packages/shared/src/discovery/`

Provider-neutral contracts, imported by both the domain and the adapter.

| File | Holds |
| --- | --- |
| `candidate.ts` | `CompanyCandidate`, `ContactCandidate`, `ProviderRef`; domain/name normalization and `dedupeCandidates` |
| `query.ts` | `DiscoveryQuery`, `discoverIcpRequestSchema`, `discoveryQuerySchema`, limits |
| `errors.ts` | The `DiscoveryProviderError` hierarchy — the port's failure vocabulary |
| `provider.ts` | `CompanyDiscoveryProvider`, `DiscoverySearchResult`, `NullDiscoveryProvider` |
| `dto.ts` | `DiscoveryRunDto` — the API response shape |

### `packages/server/src/modules/apollo/`

Everything that knows Apollo exists.

| File | Holds |
| --- | --- |
| `apollo-dto.ts` | Zod schemas for Apollo's response; `snake_case` stops here |
| `apollo-client.ts` | The only file performing an Apollo HTTP request |
| `apollo-vocabulary.ts` | ISO-2 ↔ Apollo place names, industry → keyword tags, employee bands |
| `apollo-normalizer.ts` | Apollo organization → `CompanyCandidate` |
| `apollo-service.ts` | `CompanyDiscoveryProvider` implementation |
| `apollo-errors.ts` | `ApolloAuthenticationError` and friends, subclassing the neutral errors |

### `packages/server/src/modules/discovery/`

| File | Holds |
| --- | --- |
| `discovery-strategy.ts` | The strategy seam, and `FirmographicDiscoveryStrategy` (P0) |
| `discovery-service.ts` | Domain orchestration |
| `discovery-provider-registry.ts` | Resolves the provider from `DISCOVERY_PROVIDER` |
| `discovery-error-mapping.ts` | Provider error → API error code and copy |
| `discovery-routes.ts` | `POST /api/icps/:id/discover`, `GET /api/discovery/health` |

---

## API

### `POST /api/icps/:id/discover`

Runs discovery for a stored ICP. Every field of the body is optional — the ICP
already says what to look for, so `{}` (or no body) is a valid request.

```jsonc
{
  "limit": 25,              // 1..200, default 25
  "cursor": "3",            // opaque; pass back what a previous run reported
  "strategies": ["FIRMOGRAPHIC"]   // defaults to the ICP's own strategies
}
```

Success — `200`, in the project's standard envelope:

```jsonc
{
  "success": true,
  "error": null,
  "data": {
    "candidates": [
      {
        "providerRefs": [{ "provider": "apollo", "externalId": "5f2a1b3c…" }],
        "name": "Voorbeeld Software B.V.",
        "domain": "voorbeeld-software.nl",
        "country": "NL",
        "industry": "information technology & services",
        "employeeCount": 240,
        "website": "https://voorbeeld-software.nl/",
        "technologies": ["Microsoft Azure", "Kubernetes"],
        "locations": ["Amsterdam, North Holland, Netherlands"],
        "rawSourceRef": "apollo:organization:5f2a1b3c…"
      }
    ],
    "meta": {
      "icpId": "…", "icpVersion": 1,
      "strategies": ["FIRMOGRAPHIC"],
      "provider": "apollo", "providerVersion": "v1",
      "queryVersion": "discovery-query.v1",
      "query": { "geography": { "countries": ["NL"] }, "…": "…" },
      "requestedLimit": 25, "returned": 1,
      "duplicatesRemoved": 0, "pagesFetched": 1,
      "totalAvailable": 918, "nextCursor": "2",
      "unsupportedFilters": ["companyProfile.companyTypes"],
      "startedAt": "…", "completedAt": "…", "durationMs": 412
    }
  }
}
```

`200`, not `201`: this slice persists nothing. It becomes a `201` when a search
run is actually stored.

Two `meta` fields are worth knowing about:

- **`query`** is the provider-neutral query that was executed, so a result can
  be reproduced and audited. It is the closest thing this slice has to the
  plan's `search_runs` row, without inventing the table.
- **`unsupportedFilters`** names the parts of the query Apollo could not
  express. They are reported rather than dropped in silence — a caller who
  asked for VC-backed manufacturers must be able to tell "Apollo cannot filter
  on ownership" from "there are no such companies".

### `GET /api/discovery/health`

Credential and reachability probe. Total by design: an unconfigured or
unreachable provider is a `200` reporting `available: false`, never an error.

It costs no Apollo credits — it calls `GET /api/v1/auth/health`, not a search.
It therefore proves the key is present and accepted, and deliberately cannot
prove the key's *scope* covers organization search; Apollo only reveals that by
refusing the search itself, and the health detail says so.

### Errors

| Code | HTTP | Cause |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Bad ICP id, out-of-range limit, unknown field or strategy |
| `BAD_REQUEST` | 400 | A requested strategy has no implementation |
| `NOT_FOUND` | 404 | No such ICP |
| `DISCOVERY_PROVIDER_RATE_LIMITED` | 429 | Apollo 429; carries the retry hint |
| `DISCOVERY_PROVIDER_UNAVAILABLE` | 503 | Not configured, credential refused, or Apollo unreachable/5xx |
| `DISCOVERY_PROVIDER_TIMEOUT` | 504 | Exceeded `APOLLO_TIMEOUT_MS` |
| `DISCOVERY_PROVIDER_INVALID_RESPONSE` | 502 | Apollo's payload failed the Zod contract |

A provider's own message never reaches a client — it is logged and replaced with
project copy. The one exception is a named configuration problem
(`APOLLO_API_KEY is not configured…`), because that is only fixable if named.

---

## Environment

```env
DISCOVERY_PROVIDER=none            # none | apollo
APOLLO_API_KEY=
APOLLO_BASE_URL=https://api.apollo.io
APOLLO_TIMEOUT_MS=10000
APOLLO_MAX_ATTEMPTS=2
APOLLO_RETRY_BASE_DELAY_MS=250
APOLLO_MAX_PAGES_PER_SEARCH=5
```

Validated by the existing Zod contract in `packages/server/src/config/env.ts` at
boot — there is no second configuration system.

`DISCOVERY_PROVIDER=none` is a **fully working configuration**: the API boots,
ICPs and analyses keep working, and only a discovery attempt reports the
provider as unavailable. The API also boots with `apollo` selected and no key,
so `/api/discovery/health` can say which setting is missing — a server that
refuses to start can report nothing at all. **The test suite never calls Apollo;
every provider call in it is mocked.**

### Credential handling

The key lives only in the backend environment. It is never sent to the browser,
never given a `VITE_` prefix, never stored in PostgreSQL and never logged.

- It travels in the `x-api-key` **header** only — never a query parameter, which
  would put it in every access log along the path.
- `ApolloClient` logs the method, path, status, duration and Apollo's
  `x-request-id` / `x-http-request-id`. It deliberately logs neither the query
  string nor any payload.
- Fastify's logger redacts `x-api-key` on inbound requests too, so a client
  mistakenly sending one does not leave it in our log.
- Error messages name the *setting* to fix, never the value.

`packages/server/.env` is gitignored; `.env.example` is the committed reference
and holds no real key.

### Apollo key scope

An Apollo key needs its configured scope to include the endpoints used here:

```
POST /api/v1/mixed_companies/search    organization search
GET  /api/v1/auth/health               the credential probe
```

A key without them authenticates but answers `403 API_INACCESSIBLE`. That is
reported as a named credential problem — "the provider rejected the configured
API credential; check the key and the endpoints its scope allows" — rather than
as an outage, because the repair is in the Apollo console and not a retry.

---

## Apollo contract

Built against the documented contract, verified against the live API's headers.
No field is invented.

- **Endpoint:** `POST /api/v1/mixed_companies/search`
  ([docs](https://docs.apollo.io/reference/organization-search)).
- **Filters go in the URL query string**, not the request body. That is Apollo's
  own documented convention for this endpoint, not a workaround. Array filters
  repeat a `key[]` parameter.
- **Pagination:** `per_page` ≤ 100, `page` ≤ 500 (a 50,000-record display
  ceiling). One credit per page — hence `APOLLO_MAX_PAGES_PER_SEARCH`.
- **Rate limits:** per-minute, per-hour and per-day windows; 429 with
  `retry-after` when exhausted.

### Query translation

| ICP / internal query | Apollo filter |
| --- | --- |
| `geography.countries` (ISO-2) | `organization_locations[]` (place names) |
| `geography.excludedCountries` | `organization_not_locations[]` |
| `companyProfile.industries` | `q_organization_keyword_tags[]` |
| `companyProfile.employeeMin/Max` | `organization_num_employees_ranges[]` as one `"min,max"` |

Deliberately **not** translated, and reported in `unsupportedFilters` instead:

- `companyProfile.companyTypes` / `maturity` — no documented Apollo filter.
  Ownership could be guessed at through funding parameters, and a guess that
  silently narrows a search is worse than an honest omission.
- `technology.*` — would need `currently_using_any_of_technology_uids[]`, whose
  values are opaque Apollo uids discoverable only from an endpoint this key
  cannot reach. Sending invented uids would produce a filter matching nothing:
  a search that looks like it worked and returns an empty page.
- `companyProfile.excludedIndustries` — Apollo's keyword tags are an OR-list
  with no negation. Exclusion belongs to the later hard-filter stage.
- `geography.regions` — the criteria contract already requires at least one
  included country, so countries are the precise filter.

### Normalization rules

Normalization answers one question — *what company did the provider return?* —
and refuses the adjacent one. Two rules govern it:

- **Missing stays missing.** No field is defaulted, inferred or back-filled.
  `employeeCount: 0` means Apollo reported zero; absent means Apollo reported
  nothing. An unmappable country is left unknown rather than guessed, because a
  wrong country code is worse than a missing one — a later geography filter
  would act on it.
- **Nothing is rejected.** A company with no domain, no industry and no
  headcount still becomes a candidate. "Apollo knows little about this company"
  is a fact for a later stage to weigh, not grounds for discarding a row during
  a recall pass.

Technologies keep Apollo's own labels rather than being mapped onto the internal
`TECHNOLOGIES` catalog: mapping would silently discard everything the catalog
has no entry for, turning "Apollo detected 40 technologies" into "the company
uses 3".

### Deduplication

Provider-level only, in the plan's order: normalized domain → provider external
id → normalized name + country. Duplicates contribute their provider references
to the survivor and nothing else, so no provenance is lost.

The name key is the weakest and is **skipped entirely when a candidate has a
domain**: two candidates with different domains are different companies however
alike their names, and letting a name outvote two distinct domains silently
destroys a real company. Field values are never merged — choosing between two
disagreeing employee counts is a resolution decision, and dedupe makes no
business decisions.

Merging `Acme B.V.` with `Acme Holding` needs more than a string. That is
`EntityResolutionService`, in the next slice.

---

## Not in this slice

None of the following is implemented, by design:

entity resolution · canonical company persistence · `company_sources` ·
suppression · hard must-have filtering · reachability checks · candidate
lifecycle / cold pool · signals · evidence · scoring · confidence · ranking ·
the Prospect Queue UI · background jobs · `search_runs`

No database model was added. `POST /api/search-runs` was **not** built: a search
run is an audited, persisted lifecycle over a table that does not exist yet, and
an endpoint promising durability it cannot deliver is worse than no endpoint.
Discovery hangs off the ICP because an ICP is what it needs and what exists.

`ContactCandidate` — the person *attached to a company candidate* — is still
never populated by the firmographic path, and still would come from a different
Apollo endpoint.

**People search is no longer out of scope.** It arrived as its own slice: see
[Day 4 — Apollo prospect search](./DAY4_APOLLO_PROSPECTS.md). It is a sibling
port (`PeopleDiscoveryProvider`) against Apollo's `mixed_people/api_search`,
returning a top-level `PersonCandidate`, and it changes nothing in the
firmographic path described above.

---

## Tests

```bash
npm test                  # every suite
npm run typecheck
npm run lint
npm run verify            # the full gate
```

| Suite | Covers |
| --- | --- |
| `packages/shared/tests/discovery-candidate.test.ts` | Domain/name normalization, identity keys, dedupe, request and query schemas |
| `packages/server/tests/apollo-client.test.ts` | Success, query-string form, timeout, network failure, 5xx retry, non-retryable 4xx, rate limit, invalid payload, credential never logged |
| `packages/server/tests/apollo-normalizer.test.ts` | Full and sparse companies, domain/employee/technology/location normalization, provider refs, no leakage, no judgement |
| `packages/server/tests/apollo-service.test.ts` | Query translation, unsupported filters, pagination, cursors, page sizing, dedupe, error propagation |
| `packages/server/tests/firmographic-strategy.test.ts` | ICP → `DiscoveryQuery`, and what is deliberately left out of it |
| `packages/server/tests/discovery-service.test.ts` | Strategy abstraction, merging, strategy selection, no scoring or filtering, no provider HTTP in the file |
| `packages/server/tests/discovery-api.test.ts` | Endpoint contract, validation failures, every provider-error mapping, health, existing endpoints unaffected |
| `packages/server/tests/discovery.integration.test.ts` | The whole slice, transport mocked: ICP → candidates, and that no Apollo field or value reaches the domain model |
| `packages/server/tests/discovery-config.test.ts` | Env defaults and validation, provider registry, `none` stays working |

### Live verification status

**Live Apollo verification remains pending.** The credential supplied for this
work authenticates — `GET /api/v1/auth/health` returns `200 {"healthy": true,
"is_logged_in": true}` — but its configured scope excludes every search and
enrichment endpoint:

```
POST /api/v1/mixed_companies/search   → 403 API_INACCESSIBLE
POST /api/v1/organizations/search     → 403 API_INACCESSIBLE
GET  /api/v1/organizations/enrich     → 403 API_INACCESSIBLE
POST /api/v1/mixed_people/search      → 403 API_INACCESSIBLE
```

So the adapter is built against Apollo's documented contract and proven end to
end with mocked transport. To verify against live Apollo, widen the key's scope
to include `mixed_companies/search`, then:

```bash
npm run db:up && npm run prisma:deploy
npm run dev
# create an ICP at http://localhost:5173 (Load example → Create ICP)
curl localhost:4000/api/discovery/health
curl -X POST localhost:4000/api/icps/<icp-id>/discover \
     -H 'content-type: application/json' -d '{"limit":5}'
```

The 403 path is itself covered by an integration test, using Apollo's exact
response body, so the failure the current key produces is a tested outcome
rather than an unknown.

---

## Next slice

```
CompanyCandidate
      ↓
EntityResolutionService        resolve by domain, then normalized name + country
      ↓
Canonical Company              companies
      ↓
CompanySource                  provider, external_id, raw_payload, first/last seen
      ↓
Suppression                    ICP suppressed accounts
      ↓
Hard filtering                 must-have rules only; UNKNOWN never silently fails
      ↓
Candidate / cold pool          recoverable rejection with a recorded reason
```

`rawSourceRef` on every candidate is the key `company_sources.raw_payload` will
be stored under, and `providerRefs` is what entity resolution merges on — both
are already preserved.
