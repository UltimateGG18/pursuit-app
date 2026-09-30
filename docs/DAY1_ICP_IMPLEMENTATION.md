# Day 1 — ICP configuration: form → API → validation → PostgreSQL

First end-to-end vertical slice of PURSUIT (Prospect Search & Intelligence Engine).

A user configures an Ideal Customer Profile in a React form; the payload is validated with Zod
against a schema shared by the frontend and the backend, normalized, and persisted to PostgreSQL
through Prisma with full version history.

**This slice stops at ICP persistence.** Discovery, prospects, evidence, scoring and ranking are not
implemented. No AI/LLM model is connected — only the `ModelProvider` abstraction that a future model
will implement.

```
React ICP form ──▶ POST /api/icps ──▶ Zod validation ──▶ normalization ──▶ Prisma ──▶ PostgreSQL
                                           │
                                           └─▶ 400 + field-addressable error details
```

---

## 1. Repository layout

npm workspaces monorepo. 68 TypeScript/TSX files, ~9.7k lines including tests.

```
packages/
  shared/   @pursuit/shared  — ICP types, Zod schemas, option catalogs, API contract, ModelProvider
  server/   @pursuit/server  — Fastify API, Prisma persistence
  web/      @pursuit/web     — React + Vite ICP form
```

The stack follows section 2 of `PURSUIT-IMPLEMENTATION-PLAN.pdf`: React + TypeScript + Vite,
Node + Fastify, PostgreSQL + Prisma, Zod, Vitest.

### Files created

Everything below is new; the repository previously contained only the plan PDF and an empty README.

**Root / tooling**

| File | Purpose |
| --- | --- |
| `package.json` | Workspace root, scripts (`verify`, `test`, `lint`, `dev`, `db:up`, …) |
| `tsconfig.base.json`, `tsconfig.json` | Shared strict compiler options, project references |
| `eslint.config.js` | Flat config: type-aware `typescript-eslint` + `react-hooks` |
| `docker-compose.yml` | PostgreSQL 16 for local development (host port **55432**) |
| `scripts/setup-env.mjs` | Copies each `packages/*/.env.example` to `.env` if missing |
| `.gitignore` | Ignores `.env` (keeps `.env.example`), `dist`, `node_modules` |
| `README.md` | Quick start |

**`packages/shared` — the single source of truth for the ICP contract**

| File | Purpose |
| --- | --- |
| `src/icp/schema.ts` | The ten section schemas, `icpConfigSchema`, request/query schemas |
| `src/icp/rule-fields.ts` | Rule field catalog: value types, allowed operators, option sources |
| `src/icp/rule-schema.ts` | Rule validation — operator/field/value-slot agreement |
| `src/icp/normalize.ts` | Canonicalization of a validated configuration |
| `src/icp/defaults.ts` | `createEmptyIcpConfig()` (form draft), `createExampleIcpConfig()` (fixture) |
| `src/icp/dto.ts` | `IcpProfileDto`, `IcpProfileSummaryDto`, `IcpProfileListDto` |
| `src/icp/catalogs/*.ts` | Nine controlled option catalogs (geography, company, technology, …) |
| `src/api/response.ts` | The `{ success, data, error }` envelope, error codes and their HTTP status |
| `src/api/validation.ts` | `validateWith`, `zodErrorToDetails`, `detailsByPath` |
| `src/model/provider.ts` | `ModelProvider` interface + `NullModelProvider` (not connected) |
| `src/util/options.ts`, `src/util/collections.ts` | Option helpers, canonicalization, `slugify` |

**`packages/server`**

| File | Purpose |
| --- | --- |
| `prisma/schema.prisma` | `ICPProfile`, `ICPProfileVersion`, `IcpStatus` |
| `prisma/migrations/20260101000000_init/migration.sql` | Initial migration |
| `src/app.ts` | Fastify app: CORS, request ids, health, routes, error handler |
| `src/server.ts` | Entry point: env, PrismaClient, graceful shutdown |
| `src/config/env.ts` | Zod-validated environment; fails fast at boot |
| `src/modules/icp/icp-routes.ts` | The five ICP endpoints |
| `src/modules/icp/icp-service.ts` | Normalization, name conflicts, versioning |
| `src/modules/icp/icp-repository.ts` | Persistence interface |
| `src/modules/icp/prisma-icp-repository.ts` | PostgreSQL implementation |
| `src/modules/icp/in-memory-icp-repository.ts` | Test implementation (no database needed) |
| `src/modules/icp/icp-mapper.ts` | Record → DTO |
| `src/modules/model/model-provider-registry.ts` | Resolves the configured provider (`none` only) |
| `src/shared/errors.ts`, `src/shared/http.ts` | `AppError` → envelope mapping |

**`packages/web`**

| File | Purpose |
| --- | --- |
| `src/features/icp/IcpForm.tsx` | Form shell: banners, section nav, record settings, footer actions |
| `src/features/icp/useIcpForm.ts` | Draft state, validation, submit/reset/cancel, create vs edit |
| `src/features/icp/IcpListPanel.tsx` | Stored ICPs, edit and archive |
| `src/features/icp/sections/*.tsx` | The ten sections (each memoized) |
| `src/components/form/controls.tsx` | Text, textarea, select, multi-select, number range, slider, checkbox |
| `src/components/form/RuleBuilder.tsx` | Must / nice / exclude rule builder |
| `src/components/form/TriggerEditor.tsx` | Structured trigger rows |
| `src/components/form/KeywordGroupEditor.tsx` | Keyword groups for semantic discovery |
| `src/components/form/AccountSelector.tsx` | Account selector **placeholder** |
| `src/components/form/Field.tsx` | Label / hint / error shell, ARIA wiring |
| `src/api/client.ts` | Typed API client; maps transport failures onto the shared envelope |
| `src/styles/app.css` | Styling (no CSS framework dependency) |

---

## 2. The ICP form

Ten sections, all fields driven by the catalogs in `@pursuit/shared`.

| # | Section | Fields (control) |
| --- | --- | --- |
| 1 | Basic Profile | name (text) · objective (select) · priority (select) · languages (multi) · description (textarea) |
| 2 | Geography | regions (multi) · target countries (multi) · excluded countries (multi) · location scope (select) |
| 3 | Company Profile | industries / excluded industries (multi) · employee range (**range**) · revenue range (**range** + currency select) · business models (multi) · company types (multi) · maturity stages (multi) |
| 4 | Technology | required / preferred / excluded technologies (multi) · technology maturity (multi) · cloud providers (multi) · legacy indicators (multi) |
| 5 | Services & Fit | service offerings (multi) · engagement models (multi) · deal size band (select) · outsourcing posture (select) · buying indicators (multi) |
| 6 | Business Problems | problems (multi) · priority problems (multi, narrowed to selected problems) · capacity gap indicators (multi) · compliance frameworks (multi) |
| 7 | Must / Nice / Exclude | three **rule builders** (must-have, nice-to-have with weight slider, exclusions) |
| 8 | Triggers & Intent | **trigger editor** (type, polarity, decay class, relevance slider, lookback slider) · excluded trigger types (multi) · minimum signals (**slider**) · freshness window (**slider**) · require structural signal (checkbox) |
| 9 | Target Buyer | seniorities (multi) · departments (multi) · titles (multi, curated catalog) · buying roles (multi) · reachability requirement (select) · minimum contacts (**slider**) |
| 10 | Evidence & Discovery | discovery strategies (multi) · **account selector placeholder** ×2 (look-alike, suppressed) · keyword groups (structured editor) · allowed source types (multi) · minimum reliability (select) · required directness (select) · evidence freshness (**slider**) · minimum corroboration (**slider**) |

Field values come from the plan's scoring inputs: ICP Fit (industry, geography, size, language),
Business Fit (business model, maturity, technology maturity, outsourcing/buying indicators), Need
(hiring gap, legacy technology, compliance pressure, capacity gap), Intent (hiring, funding,
expansion, launch, migration, leadership change, strategic initiative), Timing (freshness/lookback),
Opportunity (deal size, service fit, reachable decision maker), Evidence (source quality, freshness,
directness, corroboration).

**No free text where a list belongs.** Every firmographic, technology, problem, trigger, buyer and
evidence field is a controlled option list or a rule. Free text is limited to three places where it
is genuinely open vocabulary: the ICP name, the description, and keyword-group terms/labels (the
plan's "normalized keyword groups + synonyms" for semantic discovery).

### Scoring weights

The plan's dimension weights (ICP Fit 20, Business Fit 15, Need 20, Intent 20, Timing 10,
Opportunity 10, Evidence 5) are part of the stored configuration and validated to sum to 100, but are
**not** exposed in the Day 1 form — a weights editor is not in this slice's scope. Every profile is
stored with the plan defaults, so a future score is reproducible from the stored criteria version.

---

## 3. Database schema

PostgreSQL + Prisma. The configuration is stored as JSON rather than exploded into dozens of
relational tables: its shape is guaranteed by a versioned Zod contract (`icp.v1`) and the pipeline
reads it as a whole, so relational decomposition would add joins without adding a query we need.

```prisma
enum IcpStatus { ACTIVE  INACTIVE  ARCHIVED }

model ICPProfile {
  id              String    @id @default(uuid()) @db.Uuid
  name            String    @db.VarChar(120)
  slug            String    @db.VarChar(80)     // derived from name, duplicate detection
  description     String?
  version         Int       @default(1)         // version of the latest stored configuration
  status          IcpStatus @default(ACTIVE)
  schemaVersion   String    @map("schema_version") @db.VarChar(32)   // "icp.v1"
  config          Json                          // normalized — what the pipeline reads
  submittedConfig Json      @map("submitted_config")  // exactly what the client sent
  scoringWeights  Json      @map("scoring_weights")
  createdBy       String?   @map("created_by") @db.VarChar(120)
  changeReason    String?   @map("change_reason") @db.VarChar(280)
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  deletedAt       DateTime? @map("deleted_at")  // set by DELETE (archival)
  versions        ICPProfileVersion[]

  @@index([slug]) @@index([status]) @@index([deletedAt])
  @@map("icp_profiles")
}

model ICPProfileVersion {
  id              String    @id @default(uuid()) @db.Uuid
  icpProfileId    String    @map("icp_profile_id") @db.Uuid
  version         Int
  status          IcpStatus
  schemaVersion   String    @map("schema_version") @db.VarChar(32)
  config          Json
  submittedConfig Json      @map("submitted_config")
  scoringWeights  Json      @map("scoring_weights")
  createdBy       String?   @map("created_by") @db.VarChar(120)
  changeReason    String?   @map("change_reason") @db.VarChar(280)
  createdAt       DateTime  @default(now()) @map("created_at")
  profile         ICPProfile @relation(fields: [icpProfileId], references: [id], onDelete: Cascade)

  @@unique([icpProfileId, version])
  @@index([icpProfileId])
  @@map("icp_profile_versions")
}
```

How the requirements are met:

- **Versioning** — every write appends an `ICPProfileVersion` row and bumps `ICPProfile.version`.
  Both writes happen in one transaction, so a profile can never advertise a version whose
  configuration was not stored.
- **createdAt / updatedAt** — on the profile; each version row also carries its own `createdAt`.
- **Active / inactive status** — `IcpStatus`. A client may set `ACTIVE` or `INACTIVE`; `ARCHIVED` is
  reached only through `DELETE`.
- **The original submitted configuration is never lost** — `submittedConfig` holds the payload
  verbatim (never normalized, never rewritten), per version. `DELETE` is a soft delete, so archiving
  keeps the whole history recoverable.

---

## 4. API

All five endpoints, plus health. Base URL `http://localhost:4000`.

| Method | Endpoint | Success | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/icps` | `201` | Validate → normalize → persist at version 1 |
| `GET` | `/api/icps` | `200` | Paginated summaries; `?status=`, `?search=`, `?limit=` (1–100, default 25), `?offset=` |
| `GET` | `/api/icps/:id` | `200` | Full profile including `config` and `submittedConfig` |
| `PUT` | `/api/icps/:id` | `200` | Full replace; appends a new version |
| `DELETE` | `/api/icps/:id` | `200` | Archives (soft delete); version history retained |
| `GET` | `/health` | `200` | Includes the `ModelProvider` descriptor (`available: false`) |

### Response envelope

Success:

```json
{ "success": true, "data": {}, "error": null }
```

Failure:

```json
{
  "success": false,
  "data": null,
  "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] }
}
```

| Code | HTTP | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Payload, query or `:id` failed Zod validation |
| `BAD_REQUEST` | 400 | Malformed JSON, unsupported media type |
| `NOT_FOUND` | 404 | Unknown ICP id, archived ICP, unknown route |
| `CONFLICT` | 409 | Another active ICP already uses that name |
| `INTERNAL_ERROR` | 500 | Unexpected failure (logged with the request id) |

Every response carries an `x-request-id` header, echoing an inbound one when present.

### Request / response examples

**`POST /api/icps`** (abridged — the full payload covers all ten sections)

```json
{
  "status": "ACTIVE",
  "createdBy": "sales-ops",
  "changeReason": "Initial creation",
  "config": {
    "basicProfile": {
      "name": "Benelux mid-market platform modernization",
      "objective": "NEW_LOGO_ACQUISITION",
      "priority": "P0",
      "languages": ["NL", "EN"]
    },
    "geography": {
      "regions": ["BENELUX"],
      "includedCountries": ["LU", "NL", "BE"],
      "excludedCountries": [],
      "locationScope": "HEADQUARTERS_ONLY"
    },
    "companyProfile": {
      "industries": ["MANUFACTURING", "FINANCIAL_SERVICES"],
      "employeeRange": { "min": 250, "max": 5000 },
      "revenueRange": { "min": 20000000, "currency": "EUR" },
      "businessModels": ["B2B_SERVICES"]
    },
    "mustNiceExclude": {
      "mustHave": [
        { "field": "company.country", "operator": "IN", "values": ["NL", "BE"] },
        { "field": "company.employeeCount", "operator": "GREATER_THAN_OR_EQUAL", "value": 250 }
      ],
      "niceToHave": [
        { "field": "technology.legacyIndicator", "operator": "EQUALS", "value": "LEGACY_ERP", "weight": 8 }
      ],
      "exclusions": [{ "field": "account.doNotContact", "operator": "EQUALS", "value": true }]
    },
    "triggersIntent": {
      "triggers": [
        { "type": "TECHNOLOGY_MIGRATION", "decayClass": "STRUCTURAL", "relevance": 9, "lookbackDays": 365 },
        { "type": "RECENT_HIRING", "relevance": 7, "lookbackDays": 90 }
      ],
      "requireStructuralSignal": true
    },
    "targetBuyer": {
      "seniorities": ["C_LEVEL", "DIRECTOR"],
      "departments": ["IT"],
      "buyerRoles": ["DECISION_MAKER"],
      "reachabilityRequirement": "DECISION_MAKER_REQUIRED",
      "minimumContactsPerAccount": 2
    },
    "evidenceDiscovery": {
      "discoveryStrategies": ["FIRMOGRAPHIC", "SIGNAL_FIRST"],
      "suppressedAccounts": [{ "id": "acc-1001", "name": "Existing Customer BV", "domain": "EXISTING.NL" }],
      "allowedSourceTypes": ["COMPANY_WEBSITE", "JOB_POSTING"],
      "minimumCorroborationCount": 2
    }
  }
}
```

`201 Created`:

```json
{
  "success": true,
  "data": {
    "id": "c612b7be-69d7-43e1-b6c8-dd955d2bf5bf",
    "name": "Benelux mid-market platform modernization",
    "slug": "benelux-mid-market-platform-modernization",
    "version": 1,
    "status": "ACTIVE",
    "schemaVersion": "icp.v1",
    "config": {
      "geography": { "includedCountries": ["NL", "BE", "LU"] },
      "mustNiceExclude": {
        "mustHave": [
          {
            "id": "3f2c…",
            "field": "company.country",
            "operator": "IN",
            "values": ["BE", "NL"],
            "unknownHandling": "TREAT_AS_UNKNOWN"
          }
        ]
      },
      "evidenceDiscovery": {
        "suppressedAccounts": [{ "id": "acc-1001", "name": "Existing Customer BV", "domain": "existing.nl" }]
      }
    },
    "submittedConfig": { "geography": { "includedCountries": ["LU", "NL", "BE"] } },
    "scoringWeights": {
      "ICP_FIT": 20, "BUSINESS_FIT": 15, "NEED": 20, "INTENT": 20,
      "TIMING": 10, "OPPORTUNITY": 10, "EVIDENCE": 5
    },
    "createdBy": "sales-ops",
    "changeReason": "Initial creation",
    "createdAt": "2026-09-07T07:10:14.882Z",
    "updatedAt": "2026-09-07T07:10:14.882Z"
  },
  "error": null
}
```

Note what normalization did, and what it did not touch:

| | Submitted | Stored `config` | Stored `submittedConfig` |
| --- | --- | --- | --- |
| Countries | `["LU","NL","BE"]` | `["NL","BE","LU"]` (catalog order) | `["LU","NL","BE"]` |
| Rule ids | absent | assigned (UUID) | absent |
| Account domain | `EXISTING.NL` | `existing.nl` | `EXISTING.NL` |
| Trigger polarity | omitted | `POSITIVE` (default) | omitted |
| Scoring weights | omitted | plan defaults | omitted |

**Validation failure** — `400`:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The ICP payload is invalid",
    "details": [
      { "path": "config.basicProfile.name", "message": "Name must be at least 3 characters", "code": "too_small" },
      { "path": "config.geography.includedCountries", "message": "Select at least one target country", "code": "too_small" },
      { "path": "config.companyProfile.industries[0]", "message": "Invalid enum value. Expected 'SOFTWARE_SAAS' | … , received 'NOT_AN_INDUSTRY'", "code": "invalid_enum_value" },
      { "path": "config.mustNiceExclude.mustHave[0].operator", "message": "Operator \"is greater than\" cannot be used with Country", "code": "custom" }
    ]
  }
}
```

`path` is a dot/bracket path into the request body. The form keys its inline errors by exactly these
paths (minus the `config.` prefix), so a message renders on the right field whether it came from the
browser or the server.

**Duplicate name** — `409`:

```json
{
  "success": false, "data": null,
  "error": {
    "code": "CONFLICT",
    "message": "An ICP named \"Benelux mid-market platform modernization\" already exists",
    "details": [{ "path": "config.basicProfile.name", "message": "This name is already used by another ICP" }]
  }
}
```

**`GET /api/icps`** — `200`:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "c612b7be-69d7-43e1-b6c8-dd955d2bf5bf",
        "name": "Benelux mid-market platform modernization",
        "slug": "benelux-mid-market-platform-modernization",
        "description": null,
        "version": 2,
        "status": "ACTIVE",
        "objective": "NEW_LOGO_ACQUISITION",
        "priority": "P0",
        "createdAt": "2026-09-07T07:10:14.882Z",
        "updatedAt": "2026-09-07T07:10:52.104Z"
      }
    ],
    "total": 1, "limit": 25, "offset": 0
  },
  "error": null
}
```

**`DELETE /api/icps/:id`** — `200`:

```json
{
  "success": true,
  "data": { "id": "c612b7be-…", "status": "ARCHIVED", "deletedAt": "2026-09-07T07:11:03.512Z" },
  "error": null
}
```

---

## 5. Validation

One schema, `icpConfigSchema` in `@pursuit/shared`, used by the browser before submitting and by the
API on arrival. What it enforces:

- **Required fields** — ICP name (3–120 chars), and at least one entry in target countries,
  industries, business models, service offerings, engagement models, business problems, languages,
  seniorities, departments, discovery strategies, allowed source types, must-have rules and triggers.
- **Enum values** — every option list is a `z.enum` over its catalog. Unknown values are rejected,
  not silently dropped.
- **Arrays** — minimum/maximum lengths, duplicate detection (trigger types, rule values, keyword
  group labels, account ids).
- **Ranges** — employee and revenue ranges (each side optional, `min <= max`), trigger relevance
  1–10, lookback 7–1095 days, evidence freshness 30–730 days, corroboration 1–5, rule weights 1–10,
  contacts 0–25. Numeric rule values are bounded by their field definition (e.g. founded year
  1800–2100).
- **Rule structure** — a rule's operator must be legal for its field's value type; the value slot
  must match the operator's operand kind (`value` / `values` / `range` / none); slots the operator
  does not use are rejected rather than ignored; enum rule values must exist in the field's option
  list; `BETWEEN` requires `min <= max`; nice-to-have rules require a weight and hard rules forbid
  one; `unknownHandling` defaults to `TREAT_AS_UNKNOWN` (the plan's "missing data is UNKNOWN, not
  FAIL").
- **Nested objects** — each section is `.strict()`, so an unknown or misspelled key is an error
  rather than data silently thrown away.
- **Cross-field** — a country cannot be both included and excluded; a technology cannot be both
  required/preferred and excluded; priority problems must be selected problems; a trigger type cannot
  be both configured and excluded; minimum signal count cannot exceed the configured triggers;
  requiring a structural signal requires one to exist; `DECISION_MAKER_REQUIRED` requires the
  decision-maker role; the look-alike strategy requires reference accounts; the semantic strategy
  requires keyword groups; scoring weights must sum to 100.
- **Cross-section** — a must-have `company.country` rule may not reference a country outside the
  target geography, because that hard filter could never be satisfied.

After validation the payload is normalized (option lists sorted and de-duplicated into catalog order,
strings trimmed, empty optionals dropped, rule ids assigned, unused rule value slots stripped,
keyword terms lower-cased, account domains lower-cased, triggers ordered). The normalized result is
then **re-validated** before it is written, so a normalizer bug cannot produce a stored configuration
the contract would reject.

---

## 6. ModelProvider — the deferred seam

`packages/shared/src/model/provider.ts` defines the interface a future open-source model will
implement, and nothing else:

```ts
interface ModelProvider {
  describe(): ModelProviderDescriptor;
  supports(capability: ModelCapability): boolean;
  generateStructured<TOutput>(request: StructuredModelRequest): Promise<StructuredModelResponse<TOutput>>;
}
```

The eventual flow is
`ICP → Discovery → Prospect → Evidence → Model → Structured Model Output → Deterministic Scoring → Stored Result`.

Day 1 has one implementation, `NullModelProvider`: it advertises no capabilities and rejects every
call with `ModelProviderNotConfiguredError`, so no code path can quietly come to depend on a model.
The constraint is also enforced by configuration — `MODEL_PROVIDER` accepts only the literal `none`,
and `GET /health` reports `modelProvider.available: false`. Only structured output is ever returned
by design; the provider never produces prose, and deterministic scoring stays outside it.

---

## 7. Running it

Prerequisites: Node ≥ 20.11 (developed on 22.12), Docker (for PostgreSQL), npm 10.

```bash
npm install          # installs all three workspaces
npm run setup:env    # copies packages/*/.env.example to .env (never overwrites)
```

`packages/server/.env` holds `DATABASE_URL`, port, log level and CORS origins;
`packages/web/.env` holds `VITE_API_BASE_URL`. Both are gitignored — no secrets are committed.

### Database and migrations

```bash
npm run db:up             # docker compose up -d postgres  (host port 55432)
npm run prisma:deploy     # apply committed migrations  (prisma migrate deploy)
npm run prisma:generate   # regenerate the Prisma client after a schema change
```

The container publishes **55432**, not 5432, because a locally installed PostgreSQL commonly already
owns 5432 — connecting to the wrong server is otherwise an authentication error that looks like a
credentials bug.

Other Prisma commands:

```bash
npm run prisma:validate      # schema validity + formatting  (no database needed)
npm run prisma:migrate       # prisma migrate dev — create a migration from a schema change
npm run prisma:migrate-check # migration status + drift check (needs a database)
npm run db:down              # stop the container
```

The migration is reproducible from an empty database: `prisma migrate deploy` against a fresh volume
applies `20260101000000_init` and `prisma migrate diff` then reports no difference between the schema
and the database.

### Backend

```bash
npm run build:shared      # @pursuit/web and @pursuit/server consume the built shared package
npm run dev -w @pursuit/server     # watch mode on http://localhost:4000
# or
npm run build:server && npm run start -w @pursuit/server
curl http://localhost:4000/health
```

### Frontend

```bash
npm run dev -w @pursuit/web        # http://localhost:5173
# or
npm run build:web && npm run preview -w @pursuit/web
```

`npm run dev` at the root starts both.

---

## 8. Tests executed

`npm run verify` runs the whole gate: `setup:env` → build shared → typecheck → lint → tests →
Prisma validate → build backend → build frontend. All green.

```
@pursuit/shared   3 files    59 tests   passed
@pursuit/server   3 files    47 tests   passed   (8 of them against real PostgreSQL)
@pursuit/web      1 file     17 tests   passed
                            ───────────
                            123 tests   passed
```

| Requirement | Where | Coverage |
| --- | --- | --- |
| ICP schema validation | `packages/shared/tests/icp-schema.test.ts` (41) | Happy path, defaults, required fields, enum values, arrays, ranges, rule structure, nested objects, cross-field and cross-section rules, strict unknown keys, request/query schemas |
| Normalization | `packages/shared/tests/normalize.test.ts` (15) | Canonical ordering, idempotence, rule id assignment, slot stripping, keyword/account normalization, slugs, error-path formatting |
| ModelProvider abstraction | `packages/shared/tests/model-provider.test.ts` (3) | Unavailable, supports nothing, rejects calls |
| Valid ICP submission | `icp-api.test.ts` → *POST valid submission* (6) | 201, normalization applied, submitted config preserved verbatim, default weights, explicit `INACTIVE`, duplicate name → 409 |
| Invalid ICP submission | `icp-api.test.ts` → *POST invalid submission* (6) | 400 with field-addressable paths, invalid enum, invalid rule structure, missing body, malformed JSON, nothing persisted |
| API creation / retrieval | `icp-api.test.ts` (4 + 3) | List paging/filter/ordering, summaries exclude `config`, full read, 404 unknown id, 400 non-UUID id |
| API update | `icp-api.test.ts` → *PUT* (6) | New version appended, every earlier submitted config kept, rename, status toggle, rename conflict, invalid payload leaves the stored version untouched, 404 |
| API deletion | `icp-api.test.ts` → *DELETE* (4) | Archived, removed from reads, version history retained, name freed for reuse, second delete → 404 |
| Environment / provider registry | `config.test.ts` (7) | Defaults, missing `DATABASE_URL`, `MODEL_PROVIDER` other than `none` rejected, CORS parsing |
| Real persistence | `icp-persistence.integration.test.ts` (8) | HTTP → Zod → normalize → Prisma → PostgreSQL: profile + version rows, `config` vs `submittedConfig` columns, read-back, listing, version append, conflict, invalid payload writes nothing, archive keeps history |
| Frontend form submission | `packages/web/tests/IcpForm.test.tsx` (17) | All ten sections render, rule builders and placeholder selector present, client-side validation blocks submit and renders inline errors, `aria-invalid`, successful create, status/change-reason in payload, server error details mapped to fields, API error handling, in-flight submit state, reset, cancel, load existing ICP into the form, save via PUT, archive and refresh, list error state |

The persistence suite skips itself with a warning when no database is reachable, so `npm test` passes
on a machine without Docker (verified) and covers the real database when one is up (verified).

Beyond the automated suite, the slice was smoke-tested manually over HTTP against the built server
and PostgreSQL: create (201), list, read, update to version 2, duplicate name (409), invalid payload
(400 with four field paths), delete (200 → `ARCHIVED`), read after delete (404), non-UUID id (400),
unknown route (404), and a `psql` check confirming both version rows survive the delete. The
production frontend build was served and its assets verified to load.

### Quality gates

| Gate | Command | Result |
| --- | --- | --- |
| Type checking | `npm run typecheck` | Pass — strict, `noUncheckedIndexedAccess`, `noUnusedLocals` |
| Lint | `npm run lint` | Pass — type-aware `typescript-eslint` + `react-hooks`, 0 warnings |
| Unit + integration tests | `npm test` | 123 passed |
| Frontend build | `npm run build:web` | Pass |
| Backend build | `npm run build:server` | Pass; the compiled ESM bundle was booted and served requests |
| Prisma validation | `npm run prisma:validate` | Schema valid, formatting clean |
| Prisma migration | `npm run prisma:deploy`, `npm run prisma:migrate-check` | Applied from empty; no drift |

There are no TODO or FIXME markers in the source, and nothing in this slice's scope is stubbed.

---

## 9. Known limitations

1. **Name uniqueness is enforced in the service, not by the database.** `create`/`update` query for
   an active profile with the same slug before writing. Two simultaneous requests with the same name
   could both pass that check. PostgreSQL supports the right fix — a partial unique index on
   `(slug) WHERE deleted_at IS NULL` — but Prisma cannot express partial indexes, so adding it as
   raw SQL would make the schema and the migrations disagree and would break the drift check. Worth
   revisiting when a migration is being written for another reason.
2. **No authentication or authorization.** The plan calls for role-based access to criteria changes;
   `createdBy` is currently a free-text field supplied by the client, not an authenticated identity.
3. **Scoring weights are stored but not editable.** Defaults from the plan are applied server-side.
   The schema already accepts and validates them, so a weights editor needs no contract change.
4. **The account selector is a placeholder.** It reads from a fixed in-memory catalog of eight
   accounts. It already produces the `AccountReference` shape (`id`, `name`, `domain`) that the
   Apollo/CRM adapter will return, so only the data source changes.
5. **`PUT` is a full replace, and there is no optimistic concurrency.** Two editors saving the same
   ICP both succeed; the second wins the profile row. Both versions are preserved, so nothing is
   lost, but a version precondition (`If-Match` on `version`) would prevent the surprise.
6. **Version history is stored but not exposed.** No `GET /api/icps/:id/versions` endpoint or UI to
   diff or roll back — the rows are there for when it is needed.
7. **`DELETE` is a soft delete.** Archived profiles keep their configuration and disappear from reads;
   there is no hard-delete path or retention policy.
8. **Listing filters are basic.** `search` is a case-insensitive substring match on the name; there is
   no filtering by objective, priority or geography, and no cursor pagination.
9. **The form is one long page.** Ten sections with large option lists make a heavy DOM (in-page
   anchors help). Sections are memoized so an edit re-renders only its own section, but on a slow
   machine the first render is noticeable. Collapsible sections or a step wizard would help.
10. **No OpenAPI document.** The plan lists OpenAPI/Swagger; the contract currently lives in the
    shared Zod schemas, which the frontend consumes directly.
11. **`GET /api/icps` returns `total` from a second query.** Fine at this scale; it will need
    attention if the table grows large.
12. **Frontend tests run in jsdom, not a browser.** No Playwright E2E yet; the plan expects one for
    the main flow.

---

## 10. Recommended next implementation step

**Day 2 — Apollo discovery: `ApolloClient` + `ApolloService` + entity resolution.**

This is the next vertical slice in the plan (section 5, and its Day 2 row), and the stored ICP is
exactly its input.

1. `ApolloClient` — infrastructure only: base URL and API key from the environment, timeouts, retry
   for transient failures, rate-limit handling, structured error mapping, request-id logging that
   never logs the key, and Zod-validated provider DTOs.
2. `ApolloService` — translate a `DiscoveryQuery` derived from the stored ICP into Apollo filters,
   handle pagination, normalize responses into the internal `CompanyCandidate` contract, de-duplicate,
   and attach `providerRefs` so entity resolution can merge sources later. No scoring in this module.
3. `EntityResolutionService` — resolve by domain first, then normalized name + country; merge source
   references without deleting duplicate history.
4. Persist `companies`, `company_sources` and `search_runs`; add `POST /api/search-runs` and
   `GET /api/search-runs/:id` returning run status and counts.
5. Tests: unit tests over mocked Apollo responses (pagination, retries, rate limits, normalization,
   dedupe) and integration tests for persistence and duplicate merging.

Keep the order the plan sets out: filtering and the cold pool (Day 3), then signals and evidence
(Day 4), then deterministic scoring (Day 5). The `ModelProvider` seam stays unimplemented until the
deterministic pipeline is trustworthy end to end.

Two small carry-overs worth folding into whichever slice touches them next: a version precondition on
`PUT`, and an authenticated identity replacing the client-supplied `createdBy`.
