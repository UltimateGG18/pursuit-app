# PURSUIT — Prospect Search & Intelligence Engine

Implementation of the plan in `PURSUIT-IMPLEMENTATION-PLAN.pdf`: an evidence-first prospect pipeline
with deterministic, versioned scoring. Any model sits behind the `ModelProvider` port and never
writes to the database or decides a score.

**Current state — Day 3:** three vertical slices are complete.

1. **ICP configuration.** A React form submits to a Fastify API, which validates the payload with
   Zod against a schema shared with the frontend, normalizes it, and persists it to PostgreSQL
   through Prisma with full version history.
2. **ICP analysis.** A stored ICP is handed to an open-weight model on Groq's hosted API, and the
   model's schema-validated answer is persisted as an `ICPAnalysis` and rendered in the UI.
3. **Apollo discovery foundation.** A stored ICP becomes a list of provider-neutral
   `CompanyCandidate` objects, fetched from Apollo's organization search API and normalized at the
   adapter boundary. Recall only: nothing is resolved, filtered, scored or persisted yet.

Entity resolution, suppression, hard filtering, signals, evidence, scoring, ranking and the
Prospect Queue UI are not implemented yet.

See **[docs/DAY1_ICP_IMPLEMENTATION.md](docs/DAY1_ICP_IMPLEMENTATION.md)** for the ICP schema and
contract, **[docs/DAY2_MODEL_INTEGRATION.md](docs/DAY2_MODEL_INTEGRATION.md)** for the model
integration, and **[docs/DAY3_APOLLO_DISCOVERY.md](docs/DAY3_APOLLO_DISCOVERY.md)** for the
discovery slice: the provider port, the Apollo adapter, the query translation, the new endpoints
and the setup.

## Model provider

| | |
| --- | --- |
| Provider | Groq |
| Model | `openai/gpt-oss-120b` (open-weight). Measured: ~7,500 tokens per analysis, answered in seconds. |
| Execution | Hosted API — `https://api.groq.com/openai/v1` |
| Local inference | Not supported. No configuration selects it and there is no fallback to it. |

The application depends on the `ModelProvider` port, never on Groq. `GroqModelProvider` is the only
file that knows Groq exists, the provider is chosen by `MODEL_PROVIDER`, and a Groq failure is
reported as a model error rather than retried against something else.

### Groq setup

1. Create a Groq account at [console.groq.com](https://console.groq.com).
2. Generate an API key at [console.groq.com/keys](https://console.groq.com/keys).
3. Add `GROQ_API_KEY=<your key>` to `packages/server/.env` (gitignored — never commit it).
4. Set `MODEL_PROVIDER=groq` in the same file.
5. Start the backend.
6. Check `curl localhost:4000/api/model/health` — it reports whether the key and model are usable.
7. Submit an ICP.
8. Run the analysis.

Three settings are worth knowing about before changing them:

- `GROQ_REASONING_EFFORT=low` is **load-bearing, not a tweak.** At the model's
  own default, a `gpt-oss` model spends its completion budget on reasoning
  tokens and closes the analysis JSON early, failing the contract on most runs.
- `GROQ_MODEL=openai/gpt-oss-120b` is **the difference between an analysis that
  lands and one that half lands.** Groq validates a structured answer *after*
  generating it rather than constraining the decoder, so nothing stops a model
  emitting malformed JSON — and `gpt-oss-20b` did, on half its runs against the
  twelve-section contract, closing a nested array with `}` instead of `]`.
  `120b` returned fourteen consecutive complete, Zod-valid analyses on the same
  prompt. If analyses start failing with `MODEL_OUTPUT_VALIDATION_FAILED`, this
  is the first setting to check.
- The free tier allows 8,000 tokens/minute and one analysis costs ~7,500, so a
  second analysis inside the same minute returns `MODEL_RATE_LIMITED`
  (HTTP 429). That is handled and reported, not a bug.

The key lives only in the backend environment. It is never sent to the browser, never given a
`VITE_` prefix, never stored in PostgreSQL and never logged. `GET /api/model/health` reports whether
it is present and accepted without spending a token on it.

## Discovery provider

| | |
| --- | --- |
| Provider | Apollo |
| Endpoint | `POST /api/v1/mixed_companies/search` (organization search) |
| Selected by | `DISCOVERY_PROVIDER=apollo` |
| Page limits | ≤ 100 per page, ≤ 500 pages, one Apollo credit per page |

The application depends on the `CompanyDiscoveryProvider` port, never on Apollo. `ApolloClient` and
the Apollo DTOs are the only files that know Apollo exists, Apollo's `snake_case` fields never reach
the domain model, and `DISCOVERY_PROVIDER=none` remains a fully working configuration.

### Apollo setup

1. Generate an API key in Apollo under **Settings → Integrations → API**.
2. Give the key a scope that includes `mixed_companies/search`, `mixed_people/api_search`,
   `people/bulk_match` and `auth/health`. A key without one of them authenticates but returns
   `403 API_INACCESSIBLE` on that endpoint — so a key scoped for search but not enrichment finds
   real people and reports their contact details as unavailable.
3. Add `APOLLO_API_KEY=<your key>` to `packages/server/.env` (gitignored — never commit it).
4. Set `DISCOVERY_PROVIDER=apollo` in the same file.
5. Start the backend and check `curl localhost:4000/api/discovery/health`.
6. Create an ICP, then `POST /api/icps/:id/discover`.

The key lives only in the backend environment. It travels in the `x-api-key` header and nowhere
else — never a query parameter, never the browser, never a `VITE_` prefix, never PostgreSQL, never a
log. `GET /api/discovery/health` reports whether it is present and accepted without spending an
Apollo credit, and deliberately cannot report whether its *scope* covers search — Apollo only
reveals that by refusing the search.

Discovery is recall-first and applies no judgement: a company outside the ICP's geography or below
its headcount floor is still returned, because rejecting it *with a recorded reason* is the later
hard-filter stage's job. See [docs/DAY3_APOLLO_DISCOVERY.md](docs/DAY3_APOLLO_DISCOVERY.md).

### Contact enrichment

Apollo's people **search** returns who matches an ICP. It deliberately returns no email addresses
and no phone numbers — those come from a separate, separately-billed **enrichment** endpoint
(`people/match` and `people/bulk_match`). So a surviving candidate is enriched before the pipeline
asks whether anyone can reach them:

```
Apollo search → candidate processing → contact enrichment → reachability
```

The order is load-bearing. Judging reachability on search results alone would reject people for
lacking data that was never going to be in that response, and record the pipeline's own blind spot
as a fact about the prospect.

| Setting | Default | What it does |
| --- | --- | --- |
| `APOLLO_ENRICHMENT_ENABLED` | `true` | Off produces a working run with no contact details at all. |
| `APOLLO_REVEAL_PHONE_NUMBERS` | `false` | Opt-in: a separate Apollo credit type, resolved asynchronously. |
| `APOLLO_MAX_ENRICHMENTS_PER_RUN` | `25` | Spend control, independent of the caller's page size. |

Enrichment needs its own Apollo scope. A key that can search but not enrich returns
`403 API_INACCESSIBLE` on `people/bulk_match`, which the run reports per prospect as
`UNAVAILABLE` with an actionable message — never as a failed search.

Phone reveal is asynchronous at Apollo, and requires either a public HTTPS `webhook_url` or
`poll_only`. This application has no webhook receiver, so requests are always poll-only: whatever is
ready comes back, anything still running is reported as `PENDING` on that prospect, and a later run
picks it up.

Contact data is never fabricated. No address is patterned from a name and a domain, no profile URL
is built from a slug, nothing is scraped, and no model is consulted. A channel Apollo did not return
is absent, and the UI says so rather than showing a placeholder. Availability varies per person: a
prospect with only a LinkedIn profile is reachable *through LinkedIn*, and there is no completeness
score, ranking or quality band anywhere in this stage.

## Layout

```
packages/shared   @pursuit/shared   ICP types, Zod schemas, option catalogs, API envelope, ModelProvider
packages/server   @pursuit/server   Fastify API, Prisma persistence
packages/web      @pursuit/web      React + Vite ICP form
```

## Quick start

Requires Node ≥ 20.11, npm 10 and Docker.

```bash
npm install
npm run setup:env          # copies packages/*/.env.example to .env (never overwrites)

npm run db:up              # PostgreSQL 16 in Docker, published on host port 55432
npm run prisma:deploy      # apply migrations

# add GROQ_API_KEY to packages/server/.env  (see "Groq setup" above)

npm run build:shared       # server and web consume the built shared package
npm run dev                # API on :4000, form on :5173
```

Then open http://localhost:5173, use **Load example** to populate a valid ICP, **Create ICP**, and
**Analyze ICP** in the PURSUIT Analysis card below the form.

Groq is optional: set `MODEL_PROVIDER=none` and everything except the analysis keeps working. The
API also boots with Groq selected but no key — `GET /api/model/health` then says which setting is
missing. The test suite never calls Groq; every model call in it is mocked.

## Environment

| File | Holds |
| --- | --- |
| `packages/server/.env` | `DATABASE_URL`, `PORT`, `HOST`, `LOG_LEVEL`, `CORS_ORIGINS` |
| `packages/server/.env` (model) | `MODEL_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_REASONING_EFFORT`, `GROQ_BASE_URL`, `MODEL_TIMEOUT_MS`, `MODEL_PROMPT_VERSION` |
| `packages/server/.env` (discovery) | `DISCOVERY_PROVIDER`, `APOLLO_API_KEY`, `APOLLO_BASE_URL`, `APOLLO_TIMEOUT_MS`, `APOLLO_MAX_ATTEMPTS`, `APOLLO_RETRY_BASE_DELAY_MS`, `APOLLO_MAX_PAGES_PER_SEARCH` |
| `packages/server/.env` (enrichment) | `APOLLO_ENRICHMENT_ENABLED`, `APOLLO_REVEAL_PHONE_NUMBERS`, `APOLLO_MAX_ENRICHMENTS_PER_RUN` |
| `packages/server/.env` (enrichment) | `APOLLO_ENRICHMENT_ENABLED`, `APOLLO_REVEAL_PHONE_NUMBERS`, `APOLLO_MAX_ENRICHMENTS_PER_RUN` |
| `packages/web/.env` | `VITE_API_BASE_URL` |

Both are gitignored; the committed `.env.example` files are the reference. The backend validates its
environment with Zod at boot and refuses to start on a bad configuration.

## Scripts

| Command | Does |
| --- | --- |
| `npm run verify` | The full gate: build shared → typecheck → lint → tests → Prisma validate → build backend → build frontend |
| `npm test` | All unit, API and persistence tests |
| `npm run typecheck` / `npm run lint` | Types / type-aware ESLint |
| `npm run build` | Build all three packages |
| `npm run db:up` / `npm run db:down` | Start / stop PostgreSQL |
| `npm run prisma:validate` | Schema validity and formatting (no database needed) |
| `npm run prisma:migrate` | Create a migration from a schema change |
| `npm run prisma:deploy` | Apply committed migrations |
| `npm run prisma:migrate-check` | Migration status and schema drift (needs a database) |

The database-backed tests skip themselves when no PostgreSQL is reachable, so `npm test` works
without Docker. When one *is* reachable they truncate its tables, so do not point `DATABASE_URL` at
a database whose contents you care about while running the suite.

## API

`POST /api/icps` · `GET /api/icps` · `GET /api/icps/:id` · `PUT /api/icps/:id` ·
`DELETE /api/icps/:id` · `GET /health`

`POST /api/icps/:id/analyze` · `GET /api/icps/:id/analyses` ·
`GET /api/icps/:id/analyses/:analysisId` · `GET /api/model/health`

`POST /api/icps/:id/discover` · `GET /api/discovery/health`

Every response uses one envelope:

```json
{ "success": true,  "data": {},   "error": null }
{ "success": false, "data": null, "error": { "code": "…", "message": "…", "details": [] } }
```

## Architecture notes

- **One schema, two consumers.** `icpConfigSchema` in `@pursuit/shared` is the contract. The form
  validates against it before submitting and the API validates against it on arrival, so error paths
  match on both sides and cannot drift apart.
- **JSON configuration, relational history.** The ICP is stored as JSON (its shape is guaranteed by
  the versioned `icp.v1` Zod contract) while versioning is relational. Every write appends a version
  row, and the payload the client sent is stored verbatim next to the normalized form — no submitted
  configuration is ever lost or rewritten.
- **Missing data is UNKNOWN, not FAIL.** Every rule carries `unknownHandling`, defaulting to
  `TREAT_AS_UNKNOWN`, per the plan's requirement that absent firmographics must not silently reject a
  candidate.
- **Provider and model integrations sit behind interfaces.** `IcpRepository` keeps the HTTP layer
  testable without a database. `ModelProvider` is the seam the open-source model implements:
  `GroqModelProvider` is the only file that knows Groq exists, and `MODEL_PROVIDER=none` remains a
  fully working configuration, so nothing can come to depend on a model by accident. Adding a second
  runtime is one class implementing the port plus one entry in `model-provider-registry.ts`; no
  service, route or schema changes. `CompanyDiscoveryProvider` is the same arrangement for company
  data: `ApolloClient` and the Apollo DTOs are the only files that know Apollo exists, and
  `DISCOVERY_PROVIDER=none` stays fully working.
- **Provider DTOs never become the domain model.** Apollo's `estimated_num_employees` and
  `primary_domain` stop at `ApolloNormalizer`; everything past it speaks `CompanyCandidate`. The
  integration test asserts it on the wire — no Apollo field name or orphaned value appears in a
  discovery response — so a second provider can be added without touching a domain type.
- **Discovery recalls, it does not judge.** `ApolloService` calculates no score and
  `DiscoveryService` owns no provider HTTP. A company Apollo returned is a candidate even when it
  breaches the ICP's own rules, because suppression and hard filtering come later and have to record
  *why* a company was rejected — a candidate silently dropped during discovery can never enter the
  recoverable cold pool.
- **The model produces data, never decisions.** It returns schema-validated JSON that is re-validated
  before it is stored; it never writes to PostgreSQL, never edits the ICP it analysed, and never
  assigns a score. A response that does not fit the contract is a failed analysis, not something to
  be repaired.
