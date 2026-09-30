# Day 4 — Apollo prospect search

The step after the analysis: a stored ICP (optionally widened by the buyer roles
its analysis identified) becomes a page of provider-neutral `PersonCandidate`
objects, fetched from Apollo's people search API, normalized at the adapter
boundary, and rendered in the workspace.

It extends [Day 3](./DAY3_APOLLO_DISCOVERY.md) rather than changing it. The
firmographic company path is untouched; this is a sibling port next to it.

---

## Architecture

```
ICP / criteria  (icp.v1, stored)     +     ICP analysis  (icp-analysis.v2, stored)
      │                                          │
      └──────────────────┬───────────────────────┘
                         ▼
              POST /api/icps/:id/prospects
                         │
                         ▼
              ProspectService                 domain orchestration; no provider HTTP
                         │
                         ▼
              mapIcpToPeopleQuery()           ICP + analysis  ->  internal PeopleQuery
                         │
                         ▼  PeopleDiscoveryProvider   ← the port; nothing above it names Apollo
                         │
              ApolloPeopleService             query translation, normalization, dedupe
                         │
                         ▼
              ApolloClient                    auth, timeout, retry, rate limits, Zod
                         │
                         ▼
              Apollo API                      POST /api/v1/mixed_people/api_search
                         │
                         ▼
              Apollo DTO                      snake_case, confined to modules/apollo/
                         │
                         ▼
              ApolloPeopleNormalizer          the single provider → domain crossing
                         │
                         ▼
              PersonCandidate[]               provider-neutral
                         │
                         ▼
              ProspectResults                 React; renders the neutral contract only
```

### Why the mapping happens twice

The ICP → Apollo translation is deliberately split at two seams rather than
written as one `mapIcpToApolloSearch()`:

| Step | Where | Produces |
| --- | --- | --- |
| `mapIcpToPeopleQuery()` | `modules/discovery/` (domain) | Internal `PeopleQuery` in catalog vocabulary (`NL`, `C_LEVEL`, `CTO`) |
| `translatePeopleQuery()` | `modules/apollo/` (adapter) | Apollo's own filters (`Netherlands`, `c_suite`, `CTO`) |

A single function would have to live on one side of the port. In the domain it
would name Apollo's parameters; in the adapter the mapping would exist only for
Apollo, and a second people provider would begin by reimplementing it. Neither
step is in a React component: targeting rules that live in the browser cannot be
reused by a job and cannot be tested without a DOM.

---

## Files

### Created

| File | Holds |
| --- | --- |
| `packages/shared/src/discovery/person-candidate.ts` | `PersonCandidate`, `PersonCompany`, LinkedIn normalization, identity keys, `dedupePersonCandidates` |
| `packages/shared/src/discovery/people-query.ts` | `PeopleQuery`, `discoverProspectsRequestSchema`, `peopleQuerySchema`, page limits |
| `packages/shared/src/discovery/people-provider.ts` | `PeopleDiscoveryProvider`, `PeopleSearchResult`, `NullPeopleDiscoveryProvider` |
| `packages/shared/src/discovery/prospect-dto.ts` | `ProspectRunDto` — the API response shape |
| `packages/server/src/modules/apollo/apollo-people-dto.ts` | Apollo's people payload, Zod-validated, confined to this module |
| `packages/server/src/modules/apollo/apollo-people-vocabulary.ts` | Seniority, title and department translation tables |
| `packages/server/src/modules/apollo/apollo-people-normalizer.ts` | Apollo person → `PersonCandidate` |
| `packages/server/src/modules/apollo/apollo-people-service.ts` | `ApolloPeopleService`, `translatePeopleQuery` |
| `packages/server/src/modules/discovery/icp-to-people-query.ts` | `mapIcpToPeopleQuery`, `analysisTitles` |
| `packages/server/src/modules/discovery/prospect-service.ts` | Domain orchestration |
| `packages/web/src/features/prospects/useProspectSearch.ts` | Search state, paging, `appliedAnalysisId` |
| `packages/web/src/features/prospects/ProspectResults.tsx` | The results panel and all its states |

### Modified

`apollo-client.ts` (JSON-body POST + `searchPeople`) · `discovery-routes.ts` ·
`discovery-provider-registry.ts` · `app.ts` · `config/env.ts` (comment) ·
`.env.example` · `shared/src/index.ts` · `api/client.ts` · `App.tsx` ·
`IcpWorkspace.tsx` · `IcpAnalysisPanel.tsx` (handoff CTA) · `router/routes.ts`

---

## API

### `POST /api/icps/:id/prospects`

```jsonc
// request — every field optional; {} means "page 1, default size"
{
  "page": 1,
  "perPage": 25,
  "analysisId": "uuid"   // widens the title filter with that analysis's buyer roles
}
```

```jsonc
// 200
{
  "success": true,
  "data": {
    "people": [
      {
        "providerRefs": [{ "provider": "apollo", "externalId": "6a1b…" }],
        "name": "Sanne de Vries",
        "firstName": "Sanne",
        "lastName": "de Vries",
        "title": "Chief Technology Officer",
        "seniority": "c_suite",
        "department": "information_technology",
        "location": "Utrecht, Utrecht, Netherlands",
        "linkedinUrl": "https://www.linkedin.com/in/sanne-de-vries",
        "emailStatus": "verified",
        "company": {
          "externalId": "5f2a…",
          "name": "Voorbeeld Software B.V.",
          "domain": "voorbeeld-software.nl",
          "industry": "information technology & services",
          "employeeCount": 240,
          "location": "Amsterdam, North Holland, Netherlands"
        },
        "rawSourceRef": "apollo:person:6a1b…"
      }
    ],
    "pagination": { "page": 1, "perPage": 25, "totalEntries": 431, "totalPages": 18 },
    "meta": {
      "icpId": "…", "icpVersion": 1, "analysisId": "…",
      "provider": "apollo", "providerVersion": "v1",
      "queryVersion": "people-query.v1",
      "query": { /* the internal, provider-neutral query */ },
      "returned": 25, "duplicatesRemoved": 0,
      "unsupportedFilters": ["buyer.departments: DATA, PROCUREMENT"],
      "startedAt": "…", "completedAt": "…", "durationMs": 2000
    }
  },
  "error": null
}
```

200, not 201: nothing is persisted. Zero matches is a **200 with an empty
list**, never an error — a caller has to be able to tell "nobody matched" from
"the search failed".

### `GET /api/prospects/health`

Reports whether a contact provider is configured and whether its credential is
accepted. It cannot report whether the key's *scope* covers people search;
Apollo only reveals that by refusing the search, and the response says so.

### Errors

Reuses the Day 3 mapping unchanged — one vocabulary for both data paths.

| Failure | Code | HTTP |
| --- | --- | --- |
| No provider / missing key | `DISCOVERY_PROVIDER_UNAVAILABLE` | 503 |
| Key rejected or out of scope | `DISCOVERY_PROVIDER_UNAVAILABLE` | 503 |
| Provider unreachable / 5xx | `DISCOVERY_PROVIDER_UNAVAILABLE` | 503 |
| Rate limited | `DISCOVERY_PROVIDER_RATE_LIMITED` | 429 |
| Timeout | `DISCOVERY_PROVIDER_TIMEOUT` | 504 |
| Unreadable payload | `DISCOVERY_PROVIDER_INVALID_RESPONSE` | 502 |
| Bad page / unknown field | `VALIDATION_ERROR` | 400 |
| Unknown ICP or analysis | `NOT_FOUND` | 404 |

The provider's own message is logged and then discarded. The one exception is a
named configuration problem (`APOLLO_API_KEY is not configured…`), which is
forwarded because it is only fixable if it is named.

---

## ICP → Apollo mapping

| ICP field | `PeopleQuery` | Apollo parameter |
| --- | --- | --- |
| `targetBuyer.titles` | `buyer.titles` | `person_titles[]` (as the label: `VP_IT` → `VP IT`) |
| analysis `buyerStrategy[].role` | `buyer.freeTextTitles` | `person_titles[]` (merged, de-duplicated) |
| `targetBuyer.seniorities` | `buyer.seniorities` | `person_seniorities[]` (`C_LEVEL` → `c_suite`) |
| `targetBuyer.departments` | `buyer.departments` | `person_department_or_subdepartments[]` (partial — see below) |
| `geography.includedCountries` | `company.countries` | `organization_locations[]` (`NL` → `Netherlands`) |
| `geography.excludedCountries` | `company.excludedCountries` | `organization_not_locations[]` |
| `companyProfile.employeeRange` | `company.employeeMin/Max` | `organization_num_employees_ranges[]` (`"50,500"`) |
| `companyProfile.industries` | `company.industries` | `q_organization_keyword_tags[]` |

### Seniority table

`C_LEVEL→c_suite` · `VP→vp` · `DIRECTOR→director` · `HEAD→head` ·
`MANAGER→manager` · `LEAD→manager` · `INDIVIDUAL_CONTRIBUTOR→senior`

`LEAD` and `INDIVIDUAL_CONTRIBUTOR` are judgement calls. Apollo has no lead
tier, and `entry` would systematically return graduates where the ICP form
offers `INDIVIDUAL_CONTRIBUTOR` for staff engineers and architects.

### What is **not** mapped, and why

| ICP field | Why not |
| --- | --- |
| `targetBuyer.departments` — `DATA`, `PROCUREMENT` | Not master departments in Apollo's taxonomy; they span engineering/product/operations/finance. Mapping to one would exclude the leads sitting elsewhere. |
| `targetBuyer.departments` — `EXECUTIVE` | Apollo expresses this as the `c_suite` *seniority*, already sent. A department filter would AND with it and return nobody. |
| `technology.*` | Needs `currently_using_any_of_technology_uids[]` — opaque Apollo uids, discoverable only from an endpoint this key cannot reach. Invented uids produce a filter matching nothing. |
| `evidenceDiscovery.keywordGroups` | `q_keywords` on people search matches names and titles, not company themes. Joining many terms produces a query matching nobody. |
| `companyProfile.companyTypes`, `maturityStages`, `revenueRange` | No documented people-search filter. |
| `mustNiceExclude.*`, `triggersIntent.*`, `scoringWeights` | Qualification, not retrieval. Applied after normalization so a person with unknown data can be handled deliberately rather than never being retrieved. |

Everything in the first three rows is reported back in
`meta.unsupportedFilters` and shown in the UI. A caller is never told a filter
was applied when it was not.

> **One uncertainty, recorded honestly.** `q_organization_keyword_tags[]` is
> documented for organization search; Apollo does not document it for people
> search. It is sent because industry targeting is otherwise unexpressible here
> and the failure mode is benign — Apollo ignoring it widens recall, which the
> later filtering stage cuts. If Apollo rejects it, the client reports a
> `DISCOVERY_PROVIDER_INVALID_RESPONSE` naming the request rather than failing
> silently. Verify on the first live run and drop the parameter if it 422s.

---

## Apollo contract

`POST https://api.apollo.io/api/v1/mixed_people/api_search`

```http
content-type: application/json
x-api-key: <APOLLO_API_KEY>
accept: application/json
```

```jsonc
{
  "person_titles": ["CTO", "VP IT"],
  "person_seniorities": ["c_suite", "vp"],
  "person_department_or_subdepartments": ["information_technology"],
  "organization_locations": ["Netherlands"],
  "organization_not_locations": ["Belgium"],
  "organization_num_employees_ranges": ["50,500"],
  "q_organization_keyword_tags": ["software", "saas"],
  "page": 1,
  "per_page": 25
}
```

Filters travel in the **JSON body** here, where organization search puts them in
the **query string**. That asymmetry is the two endpoints' own conventions, and
`ApolloClient` supports both explicitly rather than assuming one.

An empty list is omitted entirely rather than sent as `[]`: `person_titles: []`
is a filter matching nothing, where sending no key means "do not filter on
title". The difference is every lead or none.

### Pagination is optional — observed live

`mixed_people/api_search` answered 200 with **no `pagination` block**. The first
implementation required it and rejected the whole page, which was the wrong
trade: pagination carries no lead data, and the page and page size are already
known because we sent them.

What the adapter does now:

| Field | Source |
| --- | --- |
| `page`, `perPage` | Apollo's block when present, otherwise the request — which is authoritative |
| `totalEntries`, `totalPages` | Apollo only. **Absent when not reported** — never defaulted to 0 |
| `hasMore` | `page < totalPages` when known, otherwise "did a full page of rows come back?" |

`hasMore` exists because it is answerable when the totals are not, and it is the
question a pager actually asks. It is judged on Apollo's **pre-deduplication**
row count: Apollo pages over its own rows, so a page of 25 that merged into 24
people is still a full Apollo page.

The UI renders an unknown total by omitting it — "Showing 1–25 · page 1" — never
as "of 0".

Loosening `pagination` removed the schema's last required field, which would
have let *any* JSON object validate into "0 people found" — a broken
integration looking exactly like a narrow ICP. The gate was therefore replaced
rather than dropped: a payload must carry at least one of `people`, `contacts`
or `pagination` to be a people search response at all.

> The organization endpoint's `pagination` is **left required**. It has not been
> observed to go missing, and relaxing a contract on speculation is how a real
> shape change stops being noticed.

### Diagnosing a future shape change

When a payload fails validation, the client now logs the **top-level key names**
Apollo sent, alongside the failing paths:

```jsonc
{ "provider": "apollo", "what": "people search",
  "responseKeys": ["error", "error_code"], "failedPaths": ["apollo"] }
```

Key names are structure, not content — no lead, company, filter or credential
can appear in them. Without this, a schema error says only which field was
missing, which cannot distinguish "Apollo dropped a field" from "this is not
that kind of response at all", and the two have opposite fixes.

### Normalization rules

* Apollo's `seniority` and `departments` are kept **verbatim** (`c_suite`), not
  mapped back onto the internal catalogs — mapping would discard every value the
  catalog has no entry for, and matching a reported seniority against the ICP's
  target is a filtering decision for a later stage.
* **No email address is ever read.** `email` is not declared in the DTO, so it
  cannot reach the domain, a log or a response. `email_status` is, because
  "is this lead reachable?" is what the UI needs.
* Missing stays missing. No field is defaulted, inferred or back-filled.

### Deduplication

Two keys only, both exact: the provider reference, and a normalized LinkedIn
profile URL (`https://NL.linkedin.com/in/x/?trk=y` → `linkedin.com/in/x`).

There is deliberately **no name key**, unlike `CompanyCandidate`. Two people
called "Jan de Vries" are not one person; an unmerged duplicate is a visible,
harmless flaw, while a wrongly merged person is a silent, wrong one.

---

## Frontend

```
ICP → Analysis → [Find matching leads] → Prospects (#/icps/:id/prospects)
```

* A third workspace tab, addressable as a route, next to Overview and Analysis.
* A handoff CTA at the end of a readable analysis, which navigates to the
  results view **and then** searches — so progress is reported where the results
  will appear.
* Nothing searches on mount. A search costs provider credits, so clicking
  through a list of ICPs must never spend them.
* The header owns the one primary action per view; the panel never duplicates it.
* States: never-searched · searching (message + skeletons, page stays navigable)
  · results + pager · zero matches (explicitly a *completed* search) · error
  with code and retry.
* `ProspectResults` renders `PersonCandidate` only. The string "apollo" does not
  appear anywhere in `packages/web/src`, and the built bundle contains no Apollo
  reference, URL or credential-shaped string.

---

## Environment

```bash
DISCOVERY_PROVIDER=apollo        # one setting selects both data paths
APOLLO_API_KEY=                  # backend only; never VITE_-prefixed
APOLLO_BASE_URL=https://api.apollo.io
APOLLO_TIMEOUT_MS=10000
APOLLO_MAX_ATTEMPTS=2
APOLLO_RETRY_BASE_DELAY_MS=250
```

No new variable was added. The key needs its scope to include
`POST /api/v1/mixed_people/api_search` **in addition to** the organization
search scope — Apollo grants them separately, so a key can authenticate and
serve companies while refusing people. Such a key produces HTTP 403
`API_INACCESSIBLE`, which the API reports as a named credential problem rather
than as an outage.

With `DISCOVERY_PROVIDER=none` the API still boots, ICPs and analyses still
work, and only the prospect endpoint reports itself unavailable.

---

## Tests

| Suite | Covers |
| --- | --- |
| `packages/shared/tests/discovery-person-candidate.test.ts` | LinkedIn normalization, identity keys, dedupe, why there is no name key |
| `packages/server/tests/apollo-people-client.test.ts` | Endpoint, JSON body form, credential placement, empty-filter omission, page bounds, payload validation, 401/403/429/500 mapping, credential and filters never logged |
| `packages/server/tests/apollo-people-normalizer.test.ts` | Full and sparse people, null handling, company context, no email leakage, no judgement |
| `packages/server/tests/apollo-people-service.test.ts` | Query translation, unsupported filters, one page per call, CRM/database merge, dedupe, error propagation, health |
| `packages/server/tests/icp-to-people-query.test.ts` | ICP → `PeopleQuery`, what is deliberately left out, the analysis contribution and its caps |
| `packages/server/tests/prospects-api.test.ts` | Endpoint contract, validation, empty results as success, every provider-error mapping, no provider configured |
| `packages/web/tests/ProspectResults.test.tsx` | Every UI state, the analysis handoff, paging, and that a thin record is not dressed up as a complete one |

### Live verification status

The first live call **reached Apollo and returned a 200** — the credential,
scope, endpoint, headers and request body are all accepted, which supersedes the
Day 3 "scope excludes search" blocker for this endpoint.

It failed on response *parsing* only: no `pagination` block, now handled above
and covered by tests.

Still unconfirmed on live data, because the run failed before reaching the
normalizer:

- whether `q_organization_keyword_tags[]` is honoured, ignored, or rejected by
  people search (see the note in the mapping section);
- whether people came back at all, and in `people`, `contacts`, or both — the
  failure could not distinguish these. The new `responseKeys` log line answers
  it on the next run.
