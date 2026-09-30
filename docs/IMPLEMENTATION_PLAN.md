# PURSUIT — Prospect Search & Intelligence Engine: Implementation Plan

> Derived from `PURSUIT-IMPLEMENTATION-PLAN.pdf` (18 pages, "No LLM MVP").
>
> **One deliberate change from the source.** The PDF's Section 14 lists AI/LLM
> capabilities as *"Future AI/LLM Extension Points — Explicitly Deferred"*. They
> are **no longer deferred**. This plan promotes them to committed scope as
> **Part B** (§16–§22), with contracts, guardrails, phasing and acceptance
> criteria. Everything else is a faithful restatement of the PDF.
>
> The build order is unchanged, and that is not a hedge: the AI layer consumes
> criteria versions, evidence records, signals and score seams. Those are its
> inputs. Part A is the substrate Part B plugs into, which is also what the PDF
> means by *"an LLM can be added later as a consumer/producer around them."*

---

## Table of contents

**Part A — Deterministic foundation**

| § | Section |
|---|---|
| 1 | [Executive summary](#1-executive-summary) |
| 2 | [Current implementation status](#2-current-implementation-status) |
| 3 | [Technology stack](#3-technology-stack) |
| 4 | [Target architecture](#4-target-architecture) |
| 5 | [Core data model](#5-core-data-model) |
| 6 | [Apollo client & service design](#6-apollo-client--service-design) |
| 7 | [Two-stage search](#7-two-stage-search) |
| 8 | [Deterministic scoring, signals, evidence & ranking](#8-deterministic-scoring-signals-evidence--ranking) |
| 9 | [API & frontend contract](#9-api--frontend-contract) |
| 10 | [Background jobs & scheduling](#10-background-jobs--scheduling) |
| 11 | [Testing, observability & security](#11-testing-observability--security) |
| 12 | [Execution plan](#12-execution-plan) |
| 13 | [Implementation workflow](#13-implementation-workflow) |
| 14 | [Acceptance criteria & Definition of Done](#14-acceptance-criteria--definition-of-done) |
| 15 | [Risks & mitigations](#15-risks--mitigations) |

**Part B — AI/LLM capability layer (promoted from "deferred")**

| § | Section |
|---|---|
| 16 | [Position, principles and non-negotiables](#16-position-principles-and-non-negotiables) |
| 17 | [The ModelProvider port](#17-the-modelprovider-port) |
| 18 | [Capability specifications](#18-capability-specifications) |
| 19 | [Cost, latency and caching](#19-cost-latency-and-caching) |
| 20 | [Evaluation and quality gates](#20-evaluation-and-quality-gates) |
| 21 | [AI-layer phasing](#21-ai-layer-phasing) |
| 22 | [AI acceptance criteria](#22-ai-acceptance-criteria) |

---

# Part A — Deterministic foundation

## 1. Executive summary

The strategy identifies the core problem as a search pipeline that is
filter-bound, compresses prospect quality into a single score, lacks
evidence/freshness/entity resolution, and permanently discards low scores. Data
and pipeline foundations therefore come before any intelligence layer.

**Implementation principles**

- **Modular monolith first.** One backend service, one database, one
  worker/scheduler, one frontend. Provider integrations sit behind adapters so
  Apollo can be supplemented later.
- **Deterministic, versioned scoring.** Every score must be reproducible from
  stored criteria, signals, evidence and weight versions.
- **Missing data is `UNKNOWN`, never `FAIL`.** Rejected candidates are preserved
  in a recoverable cold pool.
- **No provider leakage.** Apollo fields never reach the domain model; responses
  normalize into an internal `Candidate`/`Company` model.
- **Explainability is structural, not generated.** Briefs assemble from
  structured facts, evidence and deterministic templates. (Part B adds a
  generated brief *on top of* this, never replacing the structured record — §18.5.)

**Scope decision.** Phase 1 lands first: criteria object, Apollo discovery,
entity resolution, suppression, hard filters, rejection reasons, cold pool.

---

## 2. Current implementation status

| Area | Status |
|---|---|
| ICP criteria object (10 sections, Zod schema, catalogs) | **Done** — `packages/shared/src/icp/` |
| ICP form → API → validation → PostgreSQL | **Done** — create/read/update/archive with versioning |
| ICP configuration UI | **Done** — redesigned SaaS interface, reusable component library |
| `ModelProvider` seam | **Port exists**, `NullModelProvider` only; `MODEL_PROVIDER` config is a `z.literal('none')` |
| Apollo client/service | **Done** — organization and people search; see `docs/DAY3_APOLLO_DISCOVERY.md` and `docs/DAY4_APOLLO_PROSPECTS.md` |
| Entity resolution, suppression, filtering, cold pool | **Done** — deterministic stage over people search; see `docs/DAY5_CANDIDATE_PROCESSING.md`. Technology, `account.*`, `signal.*` and `evidence.*` criteria are reported as unevaluated rather than applied, because no source populates them yet |
| Signals, evidence, scoring, ranking | Not started (weights/dimensions defined in shared schema) |
| Background jobs | Not started |
| AI/LLM layer | Not started — **now in scope**, see Part B |

Existing repository layout:

```
packages/
  shared/   # ICP contract: Zod schemas, option catalogs, rule catalog, DTOs, ModelProvider port
  server/   # Fastify + Prisma + PostgreSQL
  web/      # React + TypeScript + Vite + Tailwind
```

---

## 3. Technology stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | React + TypeScript + Vite | Criteria UI, results, score breakdown, evidence, feedback |
| Backend API | Node.js + TypeScript + Fastify | REST API, validation, orchestration |
| Apollo integration | Typed `ApolloClient` + `ApolloService` adapter | Auth, pagination, retries, rate limits, normalization |
| Database | PostgreSQL | Companies, criteria versions, evidence, signals, scores, feedback, audit |
| ORM | Prisma | Type-safe access and migrations |
| Validation | Zod | API input, provider responses, internal contracts |
| Jobs | Node worker + cron (BullMQ later) | Nightly discovery, signal refresh, cold-pool re-scoring |
| Cache / rate limiting | Redis (optional) | Only when Apollo call volume requires it — not mandatory for the first slice |
| Testing | Vitest + Supertest + Playwright | Unit (scoring), integration (API/DB), E2E (search → result) |
| API docs | OpenAPI/Swagger | Explicit service contract |
| Observability | Structured logs + request IDs + metrics | Provider failures, search counts, score distribution, job duration |
| Deployment | Docker + existing CI | Repeatable builds; no Kubernetes unless the environment requires it |

> **Clarification.** "Apollo integration" means the Apollo **provider API/client**,
> not Apollo GraphQL. It is isolated so the endpoint/version can be swapped
> without touching the domain layer.

---

## 4. Target architecture

Two-stage pipeline: recall-first discovery, then precision qualification, with
feedback returning to criteria, discovery and scoring.

```
Frontend (React)
  Search Criteria → Search Job → Candidate List → Prospect Detail → Evidence/Score → Feedback
        │  REST/JSON
Backend API
  Criteria · Search · Candidate · Scoring · Evidence · Feedback services
        │
Provider / Infrastructure Adapters
  ApolloClient → ApolloService → normalized Company/Candidate
  Optional Web/News/Jobs adapters → normalized signals
  ModelProvider adapters (Part B)
        │
PostgreSQL
  criteria versions · companies · candidates · sources · evidence · signals · scores · feedback · audit
        │
Worker/Scheduler
  nightly discovery → filtering → qualification → scoring → ranking → queue update
```

### Service boundaries

| Module | Responsibility | Must not do |
|---|---|---|
| `CriteriaService` | Create/version criteria; separate must-have, nice-to-have, exclusions, intent | Call Apollo directly or calculate scores |
| `ApolloService` | Authenticate, search, paginate, retry, rate-limit, normalize | Apply business scoring rules |
| `DiscoveryService` | Execute discovery strategies and merge candidates | Own provider-specific HTTP code |
| `EntityResolutionService` | Resolve domain/name/country duplicates; merge source references | Delete duplicate history |
| `FilteringService` | Suppression + hard must-have rules + reachability sanity checks | Use expensive research/scoring for basic eligibility |
| `SignalService` | Store typed, dated positive/negative signals; apply decay | Invent signals without evidence |
| `EvidenceService` | Store source, date, claim, directness, corroboration, reliability | Hide conflicting sources |
| `ScoringService` | Dimension scores, penalties, confidence, final score | Depend on UI or provider DTOs |
| `RankingService` | Rank by score, confidence, opportunity, timing; enforce diversity | Change the underlying score |
| `FeedbackService` | Capture relevant/not relevant, meeting, opportunity, won/lost, reasons | Silently rewrite past scores |

### Repository structure

```
src/
  modules/
    criteria/  discovery/  apollo/  companies/  filtering/
    signals/   evidence/   scoring/ ranking/    feedback/  jobs/
    ai/                      # Part B — adapters only, no domain logic
  shared/
    db/  http/  validation/  logging/  errors/
  app.ts
```

---

## 5. Core data model

Versioned criteria, one resolved company per entity, dated evidence, typed
signals, score dimensions, confidence, rejection reasons and feedback history.

| Table | Key fields | Purpose |
|---|---|---|
| `criteria_versions` | `id, name, version, must_have_json, nice_to_have_json, exclusions_json, intent_json, weights_json, active` | Reproducible ICP + scoring weights |
| `companies` | `id, domain, normalized_name, legal_name, country, industry, size, website, status` | Canonical resolved company |
| `company_sources` | `company_id, provider, external_id, raw_payload, first_seen_at, last_seen_at` | Preserve provider references |
| `search_runs` | `id, criteria_version_id, started_at, completed_at, status, counts_json` | Audit each execution |
| `candidates` | `id, company_id, discovery_strategy, state, rejection_reason, last_evaluated_at` | Candidate lifecycle incl. cold pool |
| `signals` | `id, company_id, type, polarity, observed_at, source_id, relevance, decay_class` | Positive/negative intent and need signals |
| `sources` | `id, type, url, title, publisher, published_at, fetched_at, reliability` | Evidence source registry |
| `evidence` | `id, company_id, source_id, claim_type, claim_text, observed_at, directness, corroboration, status` | Dated, attributed facts behind scoring |
| `prospect_scores` | `id, company_id, criteria_version_id, raw_score, penalty, confidence, final_score, band` | Versioned score snapshot |
| `score_dimensions` | `score_id, dimension, value, weight, evidence_ids_json, rationale` | The seven dimensions |
| `feedback` | `company_id, user_id, event, reason, created_at, metadata` | Learning signal from rep outcomes |
| `audit_events` | `actor, action, entity, entity_id, before_json, after_json, created_at` | Traceability |

**Candidate states**

```
DISCOVERED → FILTERED → QUALIFICATION_PENDING → QUALIFIED → OUTREACH
                                                          ↘ NURTURE
                                                          ↘ COLD
                                                          ↘ SUPPRESSED
```

Rejected/cold candidates remain stored and return to qualification when new
signals arrive. Permanent discard is replaced by a recoverable cold pool.

---

## 6. Apollo client & service design

Apollo is infrastructure, not business logic.

```
SearchService → DiscoveryStrategy(ApolloFirmographicStrategy) → ApolloService
  → ApolloClient → Apollo API → Apollo DTO → Normalizer → CompanyCandidate
```

**`ApolloClient`** — base URL and API key outside source control; only low-level
provider operations (search, retrieve company/person, pagination, provider
metadata); request timeout, retry for transient failures, rate-limit handling,
structured error mapping; log request IDs and provider status but never API keys
or sensitive payloads; return Zod-validated typed DTOs.

**`ApolloService`** — translate internal `DiscoveryQuery` into Apollo filters;
handle pagination and page-size limits; normalize into `CompanyCandidate`;
deduplicate before returning; attach provider/external IDs for entity
resolution. Never calculates an ICP score.

```ts
type CompanyCandidate = {
  providerRefs: { provider: string; externalId: string }[];
  name: string;
  domain?: string;
  country?: string;
  industry?: string;
  employeeCount?: number;
  website?: string;
  technologies?: string[];
  locations?: string[];
  contacts?: ContactCandidate[];
  rawSourceRef: string;
};
```

### Discovery strategies

| Strategy | Initial implementation | Priority |
|---|---|---|
| Firmographic | Industry, geography, employee count, company attributes | **P0** |
| Signal-first | Known Apollo-accessible signals/attributes; otherwise an adapter interface | P1 |
| Semantic/description | Keyword groups, synonyms, TF-IDF/cosine similarity | P1 |
| Look-alike | Deterministic similarity against winning-company attributes | P2 |
| Relationship | Subsidiaries/partners/portfolio/competitors where source data exists | P2 |
| Inbound | Adapter for website-visitor or existing engagement data | P2 |

---

## 7. Two-stage search

### Stage 1 — Candidate discovery (recall)

1. Load the active criteria version.
2. Run Apollo firmographic discovery.
3. Run additional configured discovery strategies where data is available.
4. Normalize all provider results.
5. Resolve entities by domain first, then normalized name + country.
6. Merge source references and discovery strategies.
7. Apply suppression rules.
8. Apply **only** hard must-have criteria.
9. Run reachability sanity check.
10. Store survivors for Stage 2; store rejected candidates with explicit reasons
    in the cold pool.

### Stage 2 — Qualification (precision)

1. Collect website/product, jobs, funding/news, technology and registry facts
   through provider/source adapters.
2. Convert each source into dated evidence records.
3. Detect positive and negative signals using deterministic rules.
4. Validate evidence: source reliability, date, directness, corroboration.
5. Calculate the seven raw dimensions.
6. Apply negative-signal penalties and the confidence multiplier.
7. Assign score band.
8. Rank by business value/probability, freshness and decision-maker reachability.
9. Produce a structured, explainable prospect result from stored facts.

### Deterministic implementation of each intelligence need

This table is the **baseline and permanent fallback**. Part B adds a model-backed
path alongside each row; it does not delete the row.

| Intelligence need | Deterministic implementation |
|---|---|
| Criteria understanding | Structured UI/form + JSON schema; user explicitly selects must-have, nice-to-have, exclusions, intent |
| Semantic discovery | Keyword groups + synonyms + TF-IDF/cosine over company descriptions, behind a `SemanticStrategy` interface |
| Need detection | Rule catalog: hiring patterns, technology/end-of-life terms, expansion announcements, compliance terms, growth commitments |
| Intent detection | Typed signal rules with dates and relevance weights |
| Evidence validation | Source reliability + freshness + directness + corroboration rules |
| Explanation | Template-based rendering from dimensions, signals, evidence, risks |
| Learning | Outcome analytics + manual weight tuning/versioning |

---

## 8. Deterministic scoring, signals, evidence & ranking

### Weights

| Dimension | Weight | Deterministic inputs |
|---|---|---|
| ICP Fit | 20 | Industry, geography, size, language, mandatory profile criteria |
| Business Fit | 15 | Business model, maturity, technology maturity, outsourcing/buying indicators |
| Need | 20 | Hiring gap, legacy technology, compliance pressure, growth/capacity gap |
| Intent | 20 | Recent hiring, funding, expansion, launch, migration, leadership change |
| Timing | 10 | Signal freshness and likely action window |
| Opportunity | 10 | Estimated deal size, fit to service offering, reachable decision-maker |
| Evidence | 5 | Source quality, freshness, directness, corroboration |

### Formula

```
Raw Score   = Σ (dimension score 0..1 × dimension weight)
Final Score = (Raw Score − Negative Signal Penalty) × Confidence Factor
```

Confidence ranges **0.5 → 1.0**. It is a multiplier so weak evidence cannot be
compensated for by a high raw score.

```
Confidence = clamp(0.5
                   + source_quality_bonus
                   + freshness_bonus
                   + corroboration_bonus
                   + directness_bonus,
                   0.5, 1.0)
```

Store the component values so the result is explainable. Do not optimize these
prematurely; tune from outcome data.

### Signal freshness / decay

| Age | Weight |
|---|---|
| 0–90 days | Full |
| 91–180 days | Reduced |
| 181–365 days | Low |
| > 12 months | Near-zero unless structural |

Structural signals must be explicitly tagged so they do not decay like transient
intent.

### Bands

| Final score | Action |
|---|---|
| ≥ 70 | **Outreach** — enrich contacts, make visible to reps |
| 40–69 | **Nurture** — monitor for new signals |
| < 40 | **Cold** — retain and re-score when new signals arrive; never discard |

---

## 9. API & frontend contract

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/criteria` | Create a new criteria version |
| `GET` | `/api/criteria/active` | Return active criteria |
| `POST` | `/api/search-runs` | Start a discovery/qualification run |
| `GET` | `/api/search-runs/:id` | Run status and counts |
| `GET` | `/api/prospects` | Paginated ranked prospects with filters |
| `GET` | `/api/prospects/:id` | Full explainable prospect detail |
| `GET` | `/api/prospects/:id/evidence` | Evidence and sources |
| `POST` | `/api/prospects/:id/feedback` | Capture rep feedback/outcome |
| `POST` | `/api/prospects/:id/research` | Re-run qualification for one company |
| `POST` | `/api/jobs/nightly-search` | Internal/admin trigger |

> The current codebase serves ICP criteria at `/api/icps` with a
> `{ success, data, error }` envelope. Keep the envelope; align the path when the
> criteria module is generalized.

**Frontend screens** — Criteria Configuration (done); Search Run Dashboard;
Prospect Queue (ranked list with score, confidence, top trigger, risk, source
count, last signal date); Prospect Detail (profile, dimensions, signals
timeline, evidence, risks, opportunity, source links); Feedback panel;
Admin/Operations (provider health, failed jobs, stale data, re-run controls).

**Explainable prospect response**

```jsonc
{
  "company": { },
  "overall": { "finalScore": 0, "band": "", "confidence": 0, "criteriaVersion": "" },
  "dimensions": [{ "name": "", "score": 0, "weight": 0, "evidenceIds": [], "rationale": "" }],
  "whyMatch": [], "need": [], "intentSignals": [], "evidence": [], "risks": [],
  "opportunity": { },
  "lastEvaluatedAt": ""
}
```

---

## 10. Background jobs & scheduling

| Job | Frequency | Flow |
|---|---|---|
| Nightly discovery | Daily, ~2 AM | Criteria → Apollo discovery → normalize → resolve → suppress → hard filter → persist |
| Qualification | After discovery / queued | Research adapters → evidence → signals → scoring → ranking |
| Signal refresh | Daily or source-specific | Fetch new/changed signals, attach to companies |
| Cold-pool re-score | Daily/weekly | Re-evaluate companies with new material signals + periodic audit sample |
| Stale-account refresh | Weekly | Evidence older than threshold → queue for re-research |
| Feedback aggregation | Daily | Score-band/outcome metrics and signal performance |

**Idempotency** — every run has a unique run ID; provider external IDs and
canonical domains are unique where possible; repeated jobs update existing
evidence/signals rather than inserting duplicates; score snapshots are versioned
(re-running creates a new evaluation, never mutates history); jobs are safe to
retry after partial failure.

---

## 11. Testing, observability & security

| Level | Examples |
|---|---|
| Unit | Hard filters, normalization, entity matching, signal decay, confidence, score calculation, ranking |
| Integration | Apollo pagination, persistence, dedupe, search-run lifecycle |
| Contract | Zod DTO validation; API response contract |
| E2E | Configure criteria → run search → inspect prospect → submit feedback |
| Regression | Golden scenarios (§14) |

**Observability** — correlation/request ID across API → job → provider call;
structured logs for run start/end, provider latency/errors, candidate counts,
scoring outcomes; metrics for provider success/error/rate-limit, discovery
yield, dedupe rate, hard-filter rejection rate, qualification rate, score-band
distribution, stale evidence count, cold-pool reactivation rate, feedback
outcomes. Never log secrets; redact contact information where not needed.

**Security** — credentials in environment secrets/secret manager, never
committed; role-based access for criteria changes, manual re-runs and feedback
administration; validate every external payload before persistence;
parameterized ORM queries and standard HTTP security headers; audit records for
criteria/weight changes and manual prospect decisions.

---

## 12. Execution plan

The PDF scopes this as one week for the deterministic MVP. Part B adds a second
block — see §21.

| Day | Deliverables | Exit condition |
|---|---|---|
| 1 | Repo setup; TypeScript backend; PostgreSQL/Prisma; config; logging; base API; criteria schema; Apollo client skeleton; Docker/local run | App boots; DB migrates; health endpoint works; credentials load from env; CI runs tests |
| 2 | `ApolloService`; search; pagination; normalization; company persistence; entity resolution | Provider response becomes canonical company records with duplicate merging |
| 3 | `CriteriaService`; suppression; hard filters; rejection reasons; candidate lifecycle; cold pool | Run produces survivors + recoverable rejects with reasons |
| 4 | Signals/evidence model; deterministic signal rules; freshness/decay; research adapter interfaces; evidence validation | A candidate can have dated evidence/signals and validated/stale/conflicting states |
| 5 | `ScoringService`; weights; penalties; confidence; bands; ranking; explainable result DTO | Golden scenarios pass; every score points to its evidence and criteria version |
| 6 | React queue + detail page; score breakdown; evidence; risks; feedback; API integration | User can run a search, inspect ranked prospects, submit feedback |
| 7 | Nightly job; retries; E2E tests; observability; security review; seed/demo data; deployment; docs | End-to-end demo works; deployment is repeatable |

**If time is tight** — do not attempt full semantic discovery, web crawling, all
external research providers, advanced look-alike modeling or automated weight
learning in week 1. Build clean interfaces and ship the deterministic core.

> Day 1 is complete, and the criteria slice from Day 3 is complete for ICPs.

---

## 13. Implementation workflow

Keep architectural decisions and acceptance criteria explicit. One bounded task
at a time; tests before moving to the next module.

1. Inspect the repository first — map framework, package manager, scripts, DB
   conventions, deployment. Do not replace working infrastructure.
2. Keep this document current as the architecture/acceptance reference.
3. Implement one vertical slice at a time: criteria → discovery → entity
   resolution → filtering → scoring → API → UI.
4. After each slice: typecheck, lint, unit tests, integration tests, manual smoke test.
5. Show changed files and justify each one. Avoid broad refactors.
6. Commit after each stable slice.

**Task prompts** — (1) repository analysis and gap report; (2) foundation:
modules, Zod env validation, logging, Prisma schema/migrations, health endpoint,
error handling, test setup; (3) Apollo client/service with mocked-response unit
tests; (4) criteria/entity-resolution/filtering with edge-case tests;
(5) deterministic scoring with golden tests; (6) explainable results assembled
from structured data; (7) React queue and detail views; (8) production-readiness
review reporting blocker/high/medium/low.

---

## 14. Acceptance criteria & Definition of Done

**Functional**

- A user can create/version an ICP with must-have, nice-to-have and exclusion rules.
- Apollo discovery returns normalized candidates and preserves provider references.
- The same company from multiple discovery paths resolves to one canonical company.
- Existing customers / open deals / do-not-contact / active sequences can be suppressed.
- Missing firmographic information does not automatically reject a candidate.
- Every rejected candidate has a stored reason and stays recoverable in the cold pool.
- A qualified prospect has separate dimension scores and a final score with confidence.
- Bands are ≥70 Outreach, 40–69 Nurture, <40 Cold.
- Score calculations are reproducible from criteria version + evidence + signal state.
- Signals have type, source and date; stale signals lose influence.
- Every score-affecting evidence item has a source and date.
- Conflicting evidence is surfaced rather than silently averaged.
- Prospect detail shows risks and a confidence explanation.
- Rep feedback is stored and associated with the prospect.
- New material signals can move a cold/nurture prospect back toward qualification.

**Technical**

- Typecheck passes · lint passes · unit + integration tests pass · at least one
  E2E happy path passes.
- Migrations reproducible from an empty database.
- No API secrets committed.
- Provider failures do not crash a search run; failures are recorded and retried
  per policy.
- Jobs are idempotent and retry-safe.
- Logs can trace a search run without exposing secrets.
- README documents setup, environment variables, migrations, tests, deployment.

**Golden scenarios to automate**

| Scenario | Expected behavior |
|---|---|
| Perfect ICP, no need | High fit but not top priority; nurture/watch |
| Good ICP, active need | Need increases score and can qualify |
| Strong intent, wrong mandatory geography | Hard reject; positive signal cannot override must-have |
| Old information | Decay lowers contribution/confidence and triggers refresh |
| Conflicting sources | Conflict stays visible; evidence confidence reduced |
| Duplicate provider records | One canonical company; all references retained |
| High raw score, low evidence | Confidence multiplier prevents top ranking |
| Cold prospect gets new signal | Candidate becomes eligible for re-score |
| Multiple ICPs | Score per ICP; highest score owns routing |

---

## 15. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Apollo API limits / changes | High | Isolate adapter; retries/backoff; cache; contract tests; monitor rate-limit responses |
| Insufficient external evidence | High | Treat missing evidence as unknown; lower confidence; never fabricate; queue for later research |
| Rule-heavy scoring imperfect initially | Medium | Version weights/rules; capture outcomes; tune from evidence |
| Scope expansion | High | Ship P0 first; keep other providers as interfaces |
| Duplicate companies | High | Domain-first resolution plus normalized name/country fallback |
| Stale signals | Medium | Date every signal; apply decay |
| False negatives | High | Cold pool + re-score on new signals + periodic cold-pool audit |
| Untraceable recommendations | High | Evidence required for score-affecting claims; source/date on every claim |

False negatives are silent and must be measured through periodic cold-pool
sampling/re-scoring; false positives surface through rep rejection reasons.

---

# Part B — AI/LLM capability layer

> **Status change.** The source PDF defers everything in this part. It is now
> committed scope.

## 16. Position, principles and non-negotiables

The model layer is a **consumer and producer around** the durable assets — facts,
evidence, signals, scores, criteria, outcomes. It is never the system of record
and never the arbiter of a score.

### Non-negotiables

| # | Rule | Why |
|---|---|---|
| B1 | **Structured output only.** Every model call returns schema-validated JSON. | A prose blob cannot be scored, diffed, tested or audited. |
| B2 | **Evidence-bound.** A model may only assert a claim that carries a `source_id` and a date. Unsupported claims are dropped, not softened. | Preserves "every score-affecting claim has a source and date" (§14). |
| B3 | **Deterministic engine remains the arbiter.** Models produce *dimension inputs*, not final scores. | Keeps scores reproducible from stored state. |
| B4 | **Every model output is stamped** with `modelId`, `modelVersion`, `promptVersion`, `requestId` and persisted with the record it influenced. | Reproducibility survives a model upgrade. |
| B5 | **Degrade, never fail.** If the provider is unavailable, over budget or returns invalid output, the pipeline falls back to the deterministic path and records `degraded: true`. | A model outage must not stop a nightly run. |
| B6 | **No vendor in the schema.** Tables store facts and outputs, never provider-shaped payloads. | Straight from the PDF; keeps the adapter swappable. |
| B7 | **Human confirmation for writes to criteria.** A model may draft an ICP; only a person activates one. | Criteria changes are audited business decisions. |
| B8 | **Off by default.** Every capability is individually flagged; `MODEL_PROVIDER=none` must remain a fully working configuration. | Protects the deterministic guarantee. |

### What this does *not* change

Section 7's deterministic table stays implemented and tested. Each AI capability
is an *alternative strategy behind the same interface*, selected by config, with
the deterministic implementation as the fallback branch.

---

## 17. The `ModelProvider` port

The port already exists at `packages/shared/src/model/provider.ts` with
`ModelCapability`, `StructuredModelRequest`, `StructuredModelResponse`,
`ModelProviderNotConfiguredError` and `NullModelProvider`.

### Required changes

1. **Widen the capability enum** from
   `STRUCTURED_EXTRACTION | CLASSIFICATION | SIMILARITY` to add
   `CRITERIA_INTERPRETATION`, `RESEARCH_SYNTHESIS`, `BRIEF_GENERATION`.
2. **Relax the config literal.** `MODEL_PROVIDER: z.literal('none')` becomes
   `z.enum(['none', 'anthropic'])` (extend as adapters land), plus per-capability
   flags and a budget ceiling.
3. **Add a provider registry** in `packages/server/src/modules/ai/` that resolves
   the configured adapter once at boot and injects it into services.

```
MODEL_PROVIDER=none|anthropic
MODEL_ID=claude-opus-5
AI_CAPABILITIES=research_synthesis,brief_generation   # allowlist, empty = none
AI_MAX_SPEND_PER_RUN_USD=25
AI_REQUEST_TIMEOUT_MS=120000
ANTHROPIC_API_KEY=...                                  # secret manager, never committed
```

### First adapter

The port stays vendor-neutral (B6). The **first concrete adapter targets the
Anthropic API** via the official SDK (`@anthropic-ai/sdk`), because the project
is TypeScript and no other provider is in play.

| Concern | Binding |
|---|---|
| Model | `claude-opus-5` (1M context). `claude-haiku-4-5` for high-volume, low-judgement extraction. |
| Structured output | `output_config: { format: { … } }` on `messages.create()`, or `client.messages.parse()` to validate against the schema automatically. Satisfies **B1**. |
| Evidence citations | `citations: { enabled: true }` on each `document` content block. Responses split into `text` blocks carrying a `citations` array with `cited_text` and a location (`char_location` / `page_location`). This is the mechanism for **B2**. |
| Thinking | `thinking: { type: 'adaptive' }` for synthesis and scoring; `output_config.effort` tunes depth. |
| Errors | Typed classes, most-specific first: `NotFoundError` → `RateLimitError` → `APIStatusError` → `APIConnectionError`. Map to **B5**. |
| Bulk | Message Batches for nightly qualification (asynchronous, 50% cost). |
| Cost control | `client.messages.countTokens()` before a run to enforce `AI_MAX_SPEND_PER_RUN_USD`. |

> Adapter code lives only in `modules/ai/adapters/`. No other module imports the
> vendor SDK.

---

## 18. Capability specifications

Each capability maps to a PDF Section 14 row, now specified.

### 18.1 `CriteriaInterpreter` — natural-language criteria

*PDF row: "Natural-language criteria understanding → `CriteriaInterpreter` interface."*

| | |
|---|---|
| **Input** | Free text ("mid-market Benelux SaaS running legacy .NET, 100–1000 staff") + the option catalogs from `packages/shared`. |
| **Output** | A **draft** `IcpConfig` validated against the existing `icpConfigSchema`, plus a per-field `confidence` and the source phrase for each mapped value. |
| **Guardrails** | Output must parse against the unmodified schema — no new fields, no free-text enums. Values must come from the shared catalogs. The draft lands in the existing ICP form for review; **only a person saves it** (B7). Unmapped phrases surface as "not understood", never guessed. |
| **Fallback** | The manual form — already shipped. |
| **Acceptance** | Given 20 fixture briefs, ≥90% of produced configs parse first try; zero writes reach the database without human confirmation; every populated field cites the phrase it came from. |

### 18.2 `SemanticDiscoveryStrategy` — semantic company discovery

*PDF row: "Semantic company discovery → `SemanticDiscoveryStrategy` interface."*

Two separable concerns — keep them separate:

| Concern | Implementation |
|---|---|
| **Candidate recall** (vector search over company descriptions) | Requires an **embedding model**. The Anthropic API does not expose an embeddings endpoint, so this is a distinct component: a self-hosted sentence-embedding model or a third-party embeddings service, with pgvector for storage. Until one is chosen, the deterministic TF-IDF/cosine baseline stands. |
| **Relevance judgement** (rank/filter a shortlist) | `ModelProvider` with `SIMILARITY`: given the ICP description and ≤50 candidate descriptions, return per-candidate `{ candidateId, relevance 0..1, matchedThemes[] }`. |

| | |
|---|---|
| **Guardrails** | The model reranks; it never invents a candidate. Every returned id must exist in the input set — responses containing unknown ids are rejected wholesale. Recall stays deterministic so a model change cannot silently shrink the funnel. |
| **Fallback** | TF-IDF/cosine ordering. |
| **Acceptance** | On a labelled set of 200 companies, model reranking beats TF-IDF on precision@20 by a measured margin before it is enabled; no unknown ids ever returned. |

### 18.3 `ResearchSynthesizer` — deep research synthesis

*PDF row: "Deep research synthesis → `ResearchSynthesizer` interface."* **Highest value in Part B.**

Converts fetched raw sources (website copy, job posts, news, filings) into the
`evidence` and `signals` rows the deterministic engine already consumes.

| | |
|---|---|
| **Input** | One company + a set of fetched `sources` rows (url, publisher, `published_at`, fetched text). |
| **Output** | `EvidenceDraft[]` — `{ sourceId, claimType, claimText, observedAt, directness, quote, charRange }` — and `SignalDraft[]` — `{ type, polarity, observedAt, relevance, decayClass, evidenceRefs[] }`. Both constrained to the existing catalogs. |
| **Guardrails** | **Every draft must carry a verbatim `quote` that exists in the supplied source text** — verified by string containment server-side before persistence; failures are discarded and counted, never repaired. `observedAt` must come from the source's own date, never "today". Claim types and signal types are enum-constrained. Use the API's `citations` feature so spans are returned structurally rather than asked for in the prompt. |
| **Fallback** | The deterministic rule catalog (§7). Both can run together: rule-derived and model-derived evidence are tagged with `extraction_method` and reconciled — agreement raises corroboration, disagreement is surfaced as conflict, never averaged. |
| **Acceptance** | 100% of persisted model evidence has a quote verified present in the source; on 50 hand-labelled companies, precision ≥0.9 on claim extraction; conflicting extractions appear in the UI as conflicts. |

### 18.4 `ScoringStrategy` — AI-assisted scoring

*PDF row: "AI scoring → `ScoringStrategy` interface; keep deterministic strategy as fallback."*

The narrowest capability by design, because scoring is the reproducibility
guarantee.

| | |
|---|---|
| **Input** | One company's evidence + signals + the active criteria version, per dimension. |
| **Output** | For each of the seven dimensions: `{ dimension, value 0..1, evidenceIds[], rationale }` — **exactly the `score_dimensions` shape**. |
| **Guardrails** | The model **never** emits `raw_score`, `penalty`, `confidence`, `final_score` or `band` — those stay computed by `ScoringService` from the weights in the criteria version (B3). Any `evidenceId` not attached to that company invalidates the whole response. Dimension values are clamped and the rationale must reference at least one supplied evidence id. |
| **Rollout** | **Shadow mode first**: run alongside deterministic scoring, persist both, change no ranking. Promote a dimension only when its shadow scores correlate with rep outcomes at least as well as the deterministic one, per dimension, on ≥200 scored companies. |
| **Fallback** | Deterministic dimension calculation — permanent, never removed. |
| **Acceptance** | Re-running a stored score with the same inputs and pinned `modelId`/`promptVersion` reproduces the stored dimensions, or the difference is recorded as a new versioned evaluation (never a mutation). |

### 18.5 `BriefGenerator` — AI account brief

*PDF row: "AI account brief → `BriefGenerator` interface."*

The one capability that legitimately produces prose — under the tightest leash.

| | |
|---|---|
| **Input** | The assembled explainable prospect result (§9) — nothing else. No raw web text. |
| **Output** | `{ paragraphs: [{ text, evidenceIds[] }], talkingPoints: [{ text, evidenceIds[] }], risks: [{ text, evidenceIds[] }] }`. |
| **Guardrails** | Every paragraph references ≥1 evidence id drawn from the input; a paragraph with an empty or unknown `evidenceIds` is dropped before render. The brief is **additive** — the structured record stays the primary UI, with the narrative as a labelled, collapsible panel marked as model-generated and stamped with the model id. |
| **Fallback** | The deterministic template brief, which remains the default view. |
| **Acceptance** | No rendered sentence lacks an evidence reference; disabling the provider leaves the prospect detail page fully functional. |

### 18.6 `RankingStrategy` / `ModelTrainer` — learning from outcomes

*PDF row: "Learning model → `ModelTrainer`/`RankingStrategy` later."*

| | |
|---|---|
| **Approach** | Start with **outcome analytics, not a model**: aggregate `feedback` against score bands and dimension values to find which dimensions predict meetings and won deals. |
| **Then** | Propose weight adjustments as a **new `criteria_version`** — a diff a human approves. Weights are versioned data, not learned parameters hidden in a binary. |
| **Guardrails** | No online learning. No silent re-weighting. Past scores are never rewritten (§4 — `FeedbackService` "must not silently rewrite past scores"). Every proposal cites the outcome sample it came from. |
| **Acceptance** | A weight change is always traceable to an approved criteria version and an outcome sample; re-scoring under a new version creates new snapshots and leaves old ones intact. |

---

## 19. Cost, latency and caching

Nightly qualification over thousands of companies is where an AI layer gets
expensive. Four levers, in order:

1. **Prompt caching.** The ICP criteria, the rubric and the catalogs are
   identical across every company in a run — a large stable prefix. Put them
   first, put the per-company evidence last, and set a cache breakpoint between.
   Verify with `usage.cache_read_input_tokens`; if it is zero across a run, a
   silent invalidator (timestamp, unsorted JSON, varying tool list) is present.
2. **Batches.** Nightly qualification is not latency-sensitive — use the Message
   Batches API at 50% cost. Results return in **any order**; key by `custom_id`,
   never by position.
3. **Model tiering.** `claude-opus-5` for synthesis and scoring judgement;
   `claude-haiku-4-5` for high-volume, low-judgement extraction. Measure before
   assuming the cheaper model holds quality on a given step.
4. **Effort.** `output_config.effort` trades thoroughness against spend within
   one model. Tune per capability, not globally.

**Budget enforcement.** Count tokens before a run and refuse to start if the
projection exceeds `AI_MAX_SPEND_PER_RUN_USD`; record actual `usage` per call
against the `search_run` so cost per run is a reportable metric.

**Failure and timeout policy.** Provider errors are retried per the adapter's
policy, then the company falls back to deterministic handling with
`degraded: true` recorded on the evaluation. A run never aborts because the model
layer failed (B5).

---

## 20. Evaluation and quality gates

The golden scenarios in §14 become the AI layer's eval set — they already encode
the behaviors that must not regress.

| Gate | Requirement |
|---|---|
| **Schema conformance** | 100% of persisted outputs validate against their Zod schema. Non-conforming responses are discarded and counted, never coerced. |
| **Groundedness** | 100% of model evidence quotes verified present in the source text. This is a hard assertion in the persistence path, not a metric. |
| **No regression** | All nine golden scenarios pass with the AI layer **on** and **off**. Behaviour must not depend on model availability. |
| **Shadow comparison** | Before any scoring capability is promoted, ≥200 companies scored both ways with the delta reported per dimension. |
| **Determinism** | Re-running a stored evaluation with pinned model and prompt versions reproduces it, or produces a new versioned snapshot. |

**Prompt versioning.** Prompts are source-controlled files with a semantic
version. A prompt change is a code change: it goes through review, bumps
`promptVersion`, and invalidates nothing already stored — old records keep the
version that produced them.

**Observability additions** — per-capability call count, latency, token usage,
cost, schema-failure rate, groundedness-rejection rate, fallback/degraded rate.
The last two are the health signals that matter: a rising fallback rate means the
deterministic path is quietly carrying the system.

---

## 21. AI-layer phasing

AI work starts only when Part A's evidence and scoring tables are populated —
they are the inputs.

| Phase | Capability | Depends on | Rationale |
|---|---|---|---|
| **B0** | Port widening, config, adapter, registry, cost metering, eval harness | Part A Day 1 | Infrastructure only; no behavior change. Ships with `AI_CAPABILITIES` empty. |
| **B1** | `ResearchSynthesizer` (§18.3) | Evidence + signals tables (Day 4) | Highest value: the deterministic rule catalog is the weakest link, and this is the one place a model adds facts the rules cannot reach. |
| **B2** | `BriefGenerator` (§18.5) | Explainable result DTO (Day 5) | Additive, low risk, immediately visible to reps. |
| **B3** | `CriteriaInterpreter` (§18.1) | ICP form (done) | Self-contained; human-gated; no pipeline risk. |
| **B4** | `SemanticDiscoveryStrategy` reranking (§18.2) | Discovery + a labelled set | Needs an embeddings decision for the recall half. |
| **B5** | `ScoringStrategy` shadow mode (§18.4) | ≥200 scored companies + feedback | Cannot be evaluated before there are outcomes to correlate against. |
| **B6** | Outcome analytics → weight proposals (§18.6) | Sufficient feedback volume | Needs real outcome data, not synthetic. |

B5 and B6 are explicitly gated on **data volume, not calendar time**. Attempting
them early produces unfalsifiable results.

---

## 22. AI acceptance criteria

A capability is Done when all of the following hold:

- It sits behind a `ModelProvider` capability and an explicit config flag.
- `MODEL_PROVIDER=none` still passes the full test suite, all golden scenarios
  and an E2E run.
- Every output is schema-validated before it touches the database.
- Every persisted claim carries a `source_id`, a date and a verifiable quote.
- Every stored output records `modelId`, `modelVersion`, `promptVersion` and
  `requestId`.
- The deterministic fallback is implemented, tested and exercised by a test that
  simulates provider failure.
- Cost per run is metered and bounded.
- No vendor SDK type appears outside `modules/ai/adapters/`.
- No database column is named after or shaped by a provider.
- Prompts are versioned in source control and reviewed as code.

**Final recommendation, restated with the change applied.** The most important
engineering outcome remains a trustworthy prospect pipeline where every candidate
is resolved, filtered, scored, ranked and explainable from stored evidence. The
AI layer is now committed scope rather than a future option — but it earns its
place by making that pipeline *better sourced and better explained*, not by
becoming the thing the answers come from. Every capability in Part B is
reversible with a config flag, and the system must remain correct with all of
them off.
