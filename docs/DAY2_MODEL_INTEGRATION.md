# DAY 2 — ICP → open-weight model → structured analysis

The second vertical slice. Day 1 ended at "an ICP configuration is validated and
persisted". This slice adds one hop: a stored ICP is handed to an open-weight
model, and the model's structured answer is validated and persisted as an
**analysis** of that ICP.

Nothing about prospect discovery, enrichment, scoring or ranking is implemented.
Only the abstraction those stages will later plug into.

> **Provider migration.** This slice first shipped against a local model through
> Ollama. Local inference is now **retired**: the development hardware could not
> run an 8B model at a usable speed (§5), so the analysis runs on an open-weight
> model on **Groq's hosted API** instead.
>
> | | |
> | --- | --- |
> | Provider | Groq |
> | Model | `openai/gpt-oss-120b` |
> | Execution | Hosted API — `https://api.groq.com/openai/v1` |
> | Local inference | Not supported. No `MODEL_PROVIDER` value selects it, and nothing falls back to it. |
>
> Only the adapter changed. The `ModelProvider` port, the analysis contract, the
> prompt, the service, the routes, the database and the UI are the same code the
> local provider ran against — which is the whole point of having had a port.
> The local adapter has since been deleted; §3.1 records what running it taught
> us, because those findings outlive the code.

---

## 1. Architecture

```
React ICP form
      │  POST /api/icps
      ▼
Zod (icpConfigSchema) ── normalize ── Prisma ──▶ PostgreSQL   (Day 1, unchanged)
      │
      │  POST /api/icps/:id/analyze
      ▼
IcpAnalysisService
      │  1. find ICP                      → 404 if unknown
      │  2. build normalized model input  (icpModelInputSchema)
      │  3. open analysis row  status=RUNNING, inputSnapshot written
      ▼
ModelProvider                    ← the port; the API depends on this and nothing else
      ▼
GroqModelProvider                ← the only file that knows Groq exists
      ▼
Groq Cloud API  POST /openai/v1/chat/completions
                (response_format = json_schema, strict, stream=false)
      ▼
openai/gpt-oss-20b  →  JSON
      ▼
Zod (icpAnalysisOutputSchema)    ← in the provider, then again before the write
      ▼
Prisma ──▶ icp_analyses  status=COMPLETED, output written
      ▼
{ success: true, data: IcpAnalysisDto, error: null }
      ▼
React "PURSUIT Analysis" panel
```

Three properties are deliberate:

| Property | How it is enforced |
| --- | --- |
| **The model never writes to PostgreSQL.** | The provider returns a value. Only `IcpAnalysisService` writes, and only after validation. |
| **The ICP is never mutated by an analysis.** | `buildIcpModelInput` clones the config; the analyze path issues no ICP write. A test asserts the ICP version count stays at 1 after analysis. |
| **A failed run is never mistaken for a result.** | The row is opened `RUNNING` before the call and closed `COMPLETED` *or* `FAILED`. The `output` column stays null on failure. |

### Why the row is opened before the model is called

A model call can time out, be rate limited, or die with the process. An
after-the-fact write would leave no trace at all in those cases. Writing
`RUNNING` up front, with the input snapshot, means every attempt is accounted
for — and a hosted API adds a failure mode a local one does not have (§3).

---

## 2. The `ModelProvider` port

The port already existed at `packages/shared/src/model/provider.ts` as a
type-checked seam with no implementation. It was **extended, not replaced** —
there is still exactly one `ModelProvider` interface in the codebase.

```ts
export interface ModelProvider {
  describe(): ModelProviderDescriptor;
  supports(capability: ModelCapability): boolean;

  /** Cheap reachability probe. Never throws; reports unavailability instead. */
  healthCheck(): Promise<ModelProviderHealth>;

  /** ICP → structured discovery intelligence. Validated before it returns. */
  analyzeICP(input: IcpModelInput): Promise<IcpAnalysisModelResult>;

  generateStructured<TOutput, TSchema = unknown>(
    request: StructuredModelRequest<TSchema>,
  ): Promise<StructuredModelResponse<TOutput>>;
}
```

Changes to the pre-existing port:

- `ICP_ANALYSIS` added to `MODEL_CAPABILITIES`.
- `healthCheck()` and `analyzeICP()` added.
- `NullModelProvider` implements both: `healthCheck` reports unavailable,
  `analyzeICP` rejects with `ModelProviderNotConfiguredError`. `MODEL_PROVIDER=none`
  therefore remains a fully working configuration (implementation plan, B8).

Implementations are resolved by `packages/server/src/modules/model/model-provider-registry.ts`:

```ts
const providers = {
  none: () => new NullModelProvider(),
  groq: (env) => new GroqModelProvider({ ... }),
};
```

Adding a provider is one entry plus one class. No route, service or schema changes.

The migration off local inference is the evidence: swapping the runtime was one
new class, one registry entry and one environment block. Not one line of
`IcpAnalysisService`, `icp-analysis-routes.ts`, `icp-analysis-prompt.ts`, the
Prisma schema or the React panel changed because of it.

There are exactly two selectable providers and **neither falls back to the
other**. `none` rejects every model call loudly; `groq` reports a Groq failure as
a Groq failure. A hidden "Groq failed, try something local" path would make an
analysis silently non-reproducible, which rule B4 forbids.

### Deviation from the written plan

`IMPLEMENTATION_PLAN.md` §17 names the Anthropic API as the first adapter. This
slice targets an **open-weight model** instead, as specified for Day 2 — first
locally, now hosted. The port stays vendor-neutral (rule B6), so all three remain
possible; only the registry knows which one is configured.

---

## 3. Groq integration

`packages/server/src/modules/model/groq-model-provider.ts` is the only file in
the repository that mentions Groq. It uses the **official Groq SDK**
(`groq-sdk`), the one dependency this migration added.

| Concern | Binding |
| --- | --- |
| Client | `new Groq({ apiKey, baseURL, timeout, maxRetries: 0, fetch })` |
| Endpoint | `POST {GROQ_BASE_URL}/chat/completions` — built by the SDK |
| Structured output | `response_format: { type: 'json_schema', json_schema: { strict: true, schema } }`, where `schema` is derived from `icpAnalysisOutputSchema`. Note what "strict" means here — see fact 2. |
| Reasoning | `reasoning_effort` from `GROQ_REASONING_EFFORT`, default `low`. The single most load-bearing line in the request — see fact 3. |
| Streaming | `stream: false`. Structured Outputs and streaming are mutually exclusive on Groq, and a hosted call answers in seconds. |
| Sampling | `temperature: 0.2` |
| Timeout | SDK `timeout` = `MODEL_TIMEOUT_MS` |
| Retries | `maxRetries: 0` — see below |
| Health | `GET /openai/v1/models`, so "no key", "key rejected" and "model not served to this account" are distinguishable, and no token is spent |
| Credential | `GROQ_API_KEY`, read from the validated environment. Never hardcoded, never logged, never sent to the browser. |

### Five things worth knowing, all four found by running it

**1. `GROQ_BASE_URL` is the OpenAI-compatible base; the SDK wants the host root.**
`groq-sdk` builds its own `/openai/v1/...` paths, so handing it
`https://api.groq.com/openai/v1` would produce `/openai/v1/openai/v1/...`.
`GROQ_BASE_URL` is nevertheless documented as the OpenAI-compatible base,
because that is the value an operator recognises and the one Groq's own docs
give. `toSdkBaseUrl` accepts either form and normalises it; a unit test pins
both.

**2. Groq's `strict: true` validates *after* generating; it does not constrain
the decoder.**
This is the most important correction to the Ollama-era assumption that "the
shape is enforced, not requested". The proof is in the error body: Groq returns
HTTP 400 `json_validate_failed` with a `failed_generation` field, and on the
observed failures that field held **syntactically valid JSON that simply omitted
four required keys**. A real grammar could not emit that. Two consequences:

- The prompt has to *name* the dimensions as well as the schema declaring them,
  which is why `icp-analysis-prompt.ts` gained a completeness block (v2).
- `json_validate_failed` is mapped to `MODEL_OUTPUT_VALIDATION_FAILED`, not to a
  bad-request error. Groq generated an answer and then rejected it against our
  schema — that is the model missing the contract, and an operator told
  "malformed request" would go looking in the wrong place.

String length bounds are separately outside the strict subset and get the whole
schema rejected, so `toDecodingConstraint` strips `minLength`, `maxLength` and
`$schema` — the same three keys the Ollama adapter had to strip, for a different
reason. `enum`, `maxItems`, `minimum` and `maximum` **are** in the subset and are
kept. The **Zod contract still enforces the length bounds** regardless, so an
over-long field produces a failed analysis rather than an oversized stored one.

**3. `reasoning_effort` decides whether the analysis works at all.**
Left at `gpt-oss-20b`'s own default, the model spends its completion budget on
reasoning tokens and then closes the analysis object early — dropping the last
dimensions and failing on roughly two runs in three. Measured on the example ICP:

| `reasoning_effort` | reasoning tokens | result |
| --- | --- | --- |
| model default | hundreds to thousands | object closed after `targetBuyerRoles`, or empty content; Groq 400 |
| `low` | 11–17 | complete 14-key analysis, Zod-valid, ~1.8s |

So `GROQ_REASONING_EFFORT` defaults to `low`. It is configuration rather than a
constant because the accepted values are model-family-specific (`gpt-oss` takes
low/medium/high, `qwen3` takes none/default) and a model that accepts none of
them rejects the parameter outright — an empty value omits it.

**4. The SDK retries by default, and that had to be turned off.**
`maxRetries` defaults to 2, which retries 429s and 5xxs. That would make the
real wall-clock budget `MODEL_TIMEOUT_MS × 3` and would hide a rate limit the
caller is entitled to see and act on. `maxRetries: 0`: one analysis is one call,
one budget, one error. A test asserts a 429 produces exactly one HTTP request.

**5. A hosted API adds two failure modes a local one does not have.**
A rejected credential and a rate limit. Both are handled explicitly, and neither
is folded into "unavailable":

| Groq answers | Port error | API code | HTTP |
| --- | --- | --- | --- |
| no key configured | `ModelProviderNotConfiguredError` (names `GROQ_API_KEY`) | `MODEL_PROVIDER_UNAVAILABLE` | 503 |
| 401 / 403 | `ModelProviderNotConfiguredError` (names `GROQ_API_KEY`) | `MODEL_PROVIDER_UNAVAILABLE` | 503 |
| 429 | `ModelRateLimitedError` (+ `Retry-After`) | `MODEL_RATE_LIMITED` | 429 |
| 404 | `ModelProviderUnavailableError` | `MODEL_PROVIDER_UNAVAILABLE` | 503 |
| 5xx / connection failure | `ModelProviderUnavailableError` | `MODEL_PROVIDER_UNAVAILABLE` | 503 |
| timeout / abort | `ModelTimeoutError` | `MODEL_TIMEOUT` | 504 |
| 400 `json_validate_failed` | `ModelOutputValidationError` | `MODEL_OUTPUT_VALIDATION_FAILED` | 502 |
| any other 400 / 422 | `ModelInvalidResponseError` | `MODEL_INVALID_RESPONSE` | 502 |
| `finish_reason: length`, empty body, unparsable JSON | `ModelInvalidResponseError` | `MODEL_INVALID_RESPONSE` | 502 |
| valid JSON, wrong shape | `ModelOutputValidationError` | `MODEL_OUTPUT_VALIDATION_FAILED` | 502 |

`MODEL_RATE_LIMITED` is new. Folding it into 503 would have told a user "the
model is unavailable" when the truthful answer is "wait eight seconds", so it
carries its own code, its own 429, and the `Retry-After` value when Groq sends
one.

A configuration failure is the **one** case where the provider's own wording is
forwarded to the client, through `ModelProviderNotConfiguredError.reason`: a
missing setting is only fixable if it is named. That field is contractually free
of secrets and request data. Everything else keeps the old rule — the provider's
message stays in the server log and the client gets written copy keyed to the
code.

### 3.1 What the retired local provider taught us

The local adapter has been removed from the tree. Three findings from running it
are kept here, because each would bite anyone who adds a local runtime back:

**`localhost` does not work from Node.** Node resolves `localhost` to `::1`
first; Ollama listens on IPv4 only, so `http://localhost:11434` fails with
`ECONNREFUSED ::1:11434` while `curl` (which falls back to IPv4) succeeds. Use
the IPv4 literal.

**Ollama cannot compile `minLength`/`maxLength` into a grammar.** It rejects the
whole schema with `failed to parse grammar`. Same three keys stripped as for
Groq, different cause.

**`stream: false` cannot survive a slow local model.** Node's `fetch` (undici)
aborts a request that produces no response headers within **300 seconds**, and a
non-streamed Ollama call sends nothing until generation finishes. On CPU-only
hardware every real run failed at exactly five minutes, regardless of
`MODEL_TIMEOUT_MS`, which never got a chance to apply. The local adapter
therefore streams. The Groq adapter does not, and must not: Structured Outputs
and streaming are mutually exclusive there, and headers arrive immediately
anyway.

---

## 4. Environment variables

`packages/server/.env.example` is the reference; `npm run setup:env` copies it.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MODEL_PROVIDER` | `none` | `none` | `groq`. `none` keeps the whole API working. |
| `GROQ_API_KEY` | *(empty)* | Groq credential. Backend only. Never committed, never logged, never prefixed `VITE_`. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | The concrete model. Never named in business logic. See §5 for why not `20b`. |
| `GROQ_REASONING_EFFORT` | `low` | Reasoning budget. Load-bearing, not a tweak — see §3, fact 3. Empty omits the parameter. |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq's OpenAI-compatible endpoint. |
| `MODEL_TIMEOUT_MS` | `120000` | Wall-clock budget for one analysis. See §5. |
| `MODEL_PROMPT_VERSION` | `v2` | Stamped onto every stored analysis. Bumped to `v2` with the completeness block. |

The environment is validated with Zod at boot. `MODEL_PROVIDER=anthropic`, or
`ollama`, or any other value without an implementation behind it, is rejected at
startup rather than at first request. A test pins that `ollama` is now among the
rejected values.

### Why a missing `GROQ_API_KEY` does not stop the boot

Every other setting fails fast; this one deliberately does not. A server that
refuses to start can report nothing at all, and "the key is missing" is exactly
the thing an operator needs told. So with `MODEL_PROVIDER=groq` and no key:

- the API boots and keeps serving ICPs;
- `GET /health` reports the provider as `available: false`;
- `GET /api/model/health` says `GROQ_API_KEY is not configured…`;
- `POST …/analyze` returns 503 with that same sentence, and a `FAILED` row;
- **no HTTP request is made to Groq.** A test asserts the fetch count is zero.

### Secret handling

The key exists in exactly one place: `packages/server/.env`, which is gitignored
(`.gitignore` covers `.env` and `.env.*`, with `!.env.example` re-included).
`.env.example` carries the placeholder `your_groq_api_key_here`. Nothing writes
the key to a log, an API response, PostgreSQL, or any frontend bundle — the web
package's only variable is `VITE_API_BASE_URL`, and the frontend has no concept
of a model provider at all.

---

## 5. Model

**`openai/gpt-oss-120b`** — an open-weight model (Apache-2.0, MoE) served by
Groq. It is configuration, not code: `GROQ_MODEL=<anything Groq serves>` selects
a different one with no code change, and a test asserts exactly that.

### Measured, on the example ICP, against the v3 prompt and `icp-analysis.v2`

| | `gpt-oss-20b` | `gpt-oss-120b` |
| --- | --- | --- |
| Prompt tokens | 5,100 | 5,100 |
| Completion tokens | 1,838–2,033 | 2,336–2,576 |
| Reasoning tokens at `low` | ~12 | ~12 |
| Complete, Zod-valid analyses | **4 of 8** | **14 of 14** |

Every one of the four `20b` failures was the same defect, and it was not a
dropped section: the model closed a nested string array with `}` instead of
`]` —

```
"observableEvidence":["Job postings for platform engineers…"}]
                                                            ^ should be ]}
```

— which Groq rejected as a 400 `json_validate_failed`. This is §3 fact 2 doing
exactly what it says: `strict: true` *validates after generating* rather than
constraining the decoder, so a model that cannot hold a fourteen-level object in
its head is free to emit JSON that does not parse, and no amount of prompt
wording prevents it. Asking twelve sections of prose out of a 20B model was the
mistake; `120b` holds the shape.

The cost is about 600 more completion tokens and a few seconds per analysis.
That is the price of the contract being satisfied rather than half satisfied.

The earlier `20b`-default measurement, taken against the v1 prompt and
`icp-analysis.v1` (3,139 prompt tokens, 4 of 5 complete), is superseded: that
contract asked for signal lists, and this one asks for an analysis.

### Why the timeout dropped from 15 minutes to 2

The original local run is the reason this migration happened. On the development
machine Ollama loaded `qwen3:8b` entirely into system RAM — `GET /api/ps`
reported `size_vram: 0` — and generated at **~5.8 tokens/second**. A measured
end-to-end analysis took **577 seconds**, and a later one 648. `MODEL_TIMEOUT_MS`
had to default to 900000 just to let a single analysis finish.

Groq removes the problem rather than tuning around it: the same analysis is
**~1.8 seconds**, about 350x faster. `MODEL_TIMEOUT_MS` now defaults to
`120000` — headroom for a slow network or a queued request, not an expected
duration, and the thing that stops a hung socket becoming a request that never
returns.

### Free-tier rate limits are the real constraint now

The account this was verified on allows **8,000 tokens per minute** (`GET` any
completion and read `x-ratelimit-limit-tokens`). One analysis is ~4,000 of them,
because the whole normalized ICP goes into the prompt. That is **two analyses per
minute**, and a third returns 429 — which is exactly how the `MODEL_RATE_LIMITED`
path came to be verified against the live API rather than only against a mock.

It also rules out retrying a failed analysis on this tier: a second attempt
would exhaust the minute's budget. Hence `maxRetries: 0` and no application-level
retry (§14.6).

### The prompt

Still asks for **three entries per dimension and one-clause rationales**. That
was originally a throughput concession, but it is kept on merit: specificity per
entry is worth more than volume to the discovery stage that consumes it. v2 added
a completeness block naming the thirteen dimensions, because Groq validates the
shape rather than constraining it (§3, fact 2).

---

## 6. Model input

`packages/shared/src/model/analysis.ts`

```ts
export const icpModelInputSchema = z.object({
  icpId: z.string().uuid(),
  icpVersion: z.number().int().min(1),
  schemaVersion: z.literal('icp.v1'),
  icp: icpConfigSchema,          // the complete normalized configuration
}).strict();
```

The **whole** normalized ICP is sent: the analysis reasons across sections (a
technology signal only means something next to the industry and the service
offering). `buildIcpModelInput` deep-clones the configuration, so nothing a
provider does can reach the stored ICP.

No raw frontend fields are forwarded. The input is built from the *normalized*
`config` column, never from `submittedConfig`.

---

## 7. Model output

Contract version `icp-analysis.v1`. Every key is required.

```ts
export const icpAnalysisOutputSchema = z.object({
  summary:                z.string().trim().min(20).max(2000),
  industrySignals:        AnalysisSignal[],
  companyProfileSignals:  AnalysisSignal[],
  geographySignals:       AnalysisSignal[],
  technologySignals:      AnalysisSignal[],
  serviceFitSignals:      AnalysisSignal[],
  businessProblems:       AnalysisSignal[],
  mustHaveSignals:        AnalysisSignal[],
  niceToHaveSignals:      AnalysisSignal[],
  exclusionSignals:       AnalysisSignal[],
  triggerSignals:         AnalysisTriggerSignal[],
  targetBuyerRoles:       AnalysisBuyerRole[],
  discoveryKeywords:      AnalysisKeywordGroup[],
  evidenceRequirements:   AnalysisEvidenceRequirement[],
});
```

| Element | Shape |
| --- | --- |
| `AnalysisSignal` | `{ label, rationale, importance: CRITICAL\|HIGH\|MEDIUM\|LOW }` |
| `AnalysisTriggerSignal` | `AnalysisSignal` + `lookbackDays: 1..1095` |
| `AnalysisBuyerRole` | `{ title, seniority, department, importance, rationale }` |
| `AnalysisKeywordGroup` | `{ label, terms: string[] }` |
| `AnalysisEvidenceRequirement` | `{ claim, acceptableSources: string[], freshnessDays: 1..1825, rationale }` |

Two deliberate choices:

- **Objects are not `.strict()`.** An extra key from a model is stripped, not
  treated as a failed analysis. Missing or wrongly typed required keys still
  fail — that is what the gate is for. A `finalScore` the model volunteers is
  silently dropped, which is also what rule B3 requires.
- **The analysis mirrors the ICP's ten sections rather than inventing a second
  ICP definition.** It is derived intelligence *about* the configuration: what to
  look for in the wild, not what the criteria are.

The JSON Schema Groq decodes against is generated from this Zod schema by
`zod-to-json-schema`, so the two cannot drift. A test asserts every dimension
appears in the generated `required` list.

---

## 8. Database

New enum and table (`packages/server/prisma/schema.prisma`):

```prisma
enum IcpAnalysisStatus { PENDING RUNNING COMPLETED FAILED }

model ICPAnalysis {
  id                    String  @id @default(uuid()) @db.Uuid
  icpProfileId          String  @map("icp_profile_id") @db.Uuid
  icpVersion            Int     @map("icp_version")
  status                IcpAnalysisStatus @default(PENDING)
  provider              String  @db.VarChar(64)
  model                 String  @db.VarChar(120)
  promptVersion         String  @map("prompt_version") @db.VarChar(32)
  analysisSchemaVersion String  @map("analysis_schema_version") @db.VarChar(32)
  inputSnapshot         Json    @map("input_snapshot")
  output                Json?
  errorCode             String? @map("error_code") @db.VarChar(64)
  errorMessage          String? @map("error_message")
  durationMs            Int?    @map("duration_ms")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  profile ICPProfile @relation(fields: [icpProfileId], references: [id], onDelete: Cascade)

  @@index([icpProfileId, createdAt])
  @@index([status])
  @@map("icp_analyses")
}
```

`ICPProfile` gains `analyses ICPAnalysis[]` — a one-to-many, as required.
No other table changed; `ICPProfile` and `ICPProfileVersion` are untouched.

Migration: `packages/server/prisma/migrations/20260907161108_add_icp_analysis/`.

### Input snapshot

`inputSnapshot` holds the exact `IcpModelInput` that was sent, including the ICP
version. The question *"which configuration produced this result?"* is therefore
answerable after the ICP has been edited — a test edits the ICP after an analysis
and asserts the snapshot still shows the old values.

---

## 9. API

All endpoints use the existing envelope.

| Method | Path | Invokes the model |
| --- | --- | --- |
| `POST` | `/api/icps/:id/analyze` | yes |
| `GET` | `/api/icps/:id/analyses` | no |
| `GET` | `/api/icps/:id/analyses/:analysisId` | no |
| `GET` | `/api/model/health` | no (reachability probe only) |

`GET /health` additionally now reports `analysisSchemaVersion` and the resolved
provider descriptor.

### Request / response examples

**Run an analysis**

```bash
curl -s -X POST http://localhost:4000/api/icps/$ICP_ID/analyze
```

```json
{
  "success": true,
  "error": null,
  "data": {
    "id": "6f1c…",
    "icpId": "3a02…",
    "icpVersion": 1,
    "status": "COMPLETED",
    "provider": "groq",
    "model": "openai/gpt-oss-20b",
    "promptVersion": "v1",
    "analysisSchemaVersion": "icp-analysis.v1",
    "inputSnapshot": { "icpId": "3a02…", "icpVersion": 1, "schemaVersion": "icp.v1", "icp": { … } },
    "output": {
      "summary": "…",
      "industrySignals": [
        { "label": "Software product companies", "rationale": "…", "importance": "HIGH" }
      ],
      "triggerSignals": [
        { "label": "Series B funding round", "rationale": "…", "importance": "HIGH", "lookbackDays": 365 }
      ],
      "discoveryKeywords": [{ "label": "Legacy modernization", "terms": ["legacy migration"] }],
      "evidenceRequirements": [
        { "claim": "…", "acceptableSources": ["Job posting"], "freshnessDays": 365, "rationale": "…" }
      ]
    },
    "error": null,
    "durationMs": 3120,
    "createdAt": "2026-09-07T16:30:00.000Z",
    "updatedAt": "2026-09-07T16:30:41.000Z"
  }
}
```

**No API key configured**

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "MODEL_PROVIDER_UNAVAILABLE",
    "message": "GROQ_API_KEY is not configured. Add it to packages/server/.env and restart the API.",
    "details": []
  }
}
```

**Rate limited**

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "MODEL_RATE_LIMITED",
    "message": "The analysis model is rate limited. The provider quota is exhausted for now; wait a moment and run the analysis again. Retry after about 8s.",
    "details": []
  }
}
```

**Read stored analyses**

```bash
curl -s http://localhost:4000/api/icps/$ICP_ID/analyses
```

```json
{ "success": true, "error": null, "data": { "items": [ /* newest first, max 25 */ ], "total": 2 } }
```

### Error codes

| Code | HTTP | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | `:id` is not a UUID |
| `NOT_FOUND` | 404 | The ICP (or the analysis) does not exist |
| `MODEL_PROVIDER_UNAVAILABLE` | 503 | Groq unreachable or returning 5xx, credential missing or rejected, model not served to the account, or `MODEL_PROVIDER=none` |
| `MODEL_RATE_LIMITED` | 429 | Groq returned 429; the message carries `Retry-After` when one was sent |
| `MODEL_TIMEOUT` | 504 | No answer within `MODEL_TIMEOUT_MS` |
| `MODEL_INVALID_RESPONSE` | 502 | The answer was not usable JSON |
| `MODEL_OUTPUT_VALIDATION_FAILED` | 502 | Parsed, but did not satisfy `icp-analysis.v1` |
| `ANALYSIS_PERSISTENCE_FAILED` | 500 | The analysis row could not be written |

> **On `ICP_NOT_FOUND`.** The brief lists it; this codebase already returns
> `NOT_FOUND` for every unknown resource, and the brief also says to use the
> project's existing error conventions where available. Introducing a second
> 404 code for the same condition would have made `GET /api/icps/:id` and
> `POST /api/icps/:id/analyze` disagree about the same missing row, so the
> existing `NOT_FOUND` is used. The condition is handled and tested.

Raw runtime errors never reach a client: the provider's own message stays in the
server log and the client receives the written message keyed to the code. A test
asserts the provider's wording is absent from the response body.

The single exception is a **named configuration problem**. A missing or rejected
`GROQ_API_KEY` is the one failure an operator can act on, so
`ModelProviderNotConfiguredError.reason` is forwarded verbatim. That field is
contractually free of secrets and request data, and a test asserts the API key
itself never appears in it.

---

## 10. Frontend

A new **PURSUIT Analysis** card renders below the ICP form
(`packages/web/src/features/analysis/`). It is visually distinct from the
configuration above it — its own card, a `Model generated` badge, and a
provenance line naming the model, prompt version, contract version, ICP version
and duration.

Behaviour:

- No saved ICP → *"Save the ICP first"*, button disabled.
- A saved ICP → the stored analyses load automatically (a read, never a run).
- **Analyze ICP** → loading state → the structured result, or an error.
- More than one run → a row of buttons to switch between them.
- Every dimension is rendered, including empty ones, which say
  *"The model derived nothing for this dimension."* rather than disappearing.
- `MODEL_PROVIDER_UNAVAILABLE` renders *"The analysis model is unavailable"* plus
  the backend's own explanation, which names the missing setting when there is
  one.
- `MODEL_RATE_LIMITED` renders *"The analysis model is rate limited"* plus the
  retry hint.

Existing UI primitives only (`Alert`, `Badge`, `Button`, `EmptyState`). No new
dependency, no redesign.

### The frontend names no provider

The panel does not know whether Groq, Ollama or nothing is configured, holds no
credential, and never tells a user to go and start something — which runtime
answers is a backend concern. The migration's only UI change was copy:
*"Analyzing the ICP…"* → *"Analyzing ICP…"*, and the Ollama-specific
troubleshooting line replaced by the backend's message. The provenance strip
still names the model that answered, because that is data the API returned:
`groq · openai/gpt-oss-20b · prompt v1 · icp-analysis.v1 · ICP v1 · 3.1s`.

---

## 11. Files

### Created

```
packages/shared/src/model/analysis.ts                          input + output contract, DTOs, JSON Schema
packages/shared/src/model/errors.ts                            provider error vocabulary
packages/shared/tests/icp-analysis-schema.test.ts

packages/server/src/modules/model/groq-model-provider.ts       Groq adapter (the only Groq-aware file)
packages/server/src/modules/model/structured-json.ts           model text → JSON → validated output
packages/server/src/modules/model/icp-analysis-prompt.ts       versioned, provider-independent prompt
packages/server/src/modules/model/model-error-mapping.ts       provider error → API error code
packages/server/src/modules/icp/icp-analysis-repository.ts     persistence port
packages/server/src/modules/icp/prisma-icp-analysis-repository.ts
packages/server/src/modules/icp/in-memory-icp-analysis-repository.ts
packages/server/src/modules/icp/icp-analysis-service.ts        the flow
packages/server/src/modules/icp/icp-analysis-mapper.ts
packages/server/src/modules/icp/icp-analysis-routes.ts
packages/server/prisma/migrations/20260907161108_add_icp_analysis/migration.sql
packages/server/tests/analysis-fixtures.ts                     StubModelProvider + a valid analysis
packages/server/tests/groq-model-provider.test.ts              the Groq adapter, Groq mocked
packages/server/tests/analysis-provider-selection.test.ts      provider selection through the real stack
packages/server/tests/icp-analysis-api.test.ts

packages/web/src/features/analysis/useIcpAnalysis.ts
packages/web/src/features/analysis/IcpAnalysisPanel.tsx
packages/web/tests/IcpAnalysisPanel.test.tsx

DAY2_MODEL_INTEGRATION.md
```

### Modified

```
packages/shared/src/model/provider.ts      healthCheck + analyzeICP + ICP_ANALYSIS capability
packages/shared/src/model/errors.ts        + ModelRateLimitedError; NotConfigured carries a reason
packages/shared/src/api/response.ts        model error codes + their HTTP statuses (incl. MODEL_RATE_LIMITED / 429)
packages/shared/src/index.ts               export the new modules
packages/shared/package.json               + zod-to-json-schema
packages/shared/tests/model-provider.test.ts

packages/server/package.json               + groq-sdk
packages/server/prisma/schema.prisma       ICPAnalysis, IcpAnalysisStatus, ICPProfile.analyses
packages/server/src/config/env.ts          MODEL_PROVIDER enum + GROQ_* settings; OLLAMA_* removed
packages/server/src/app.ts                 analysis routes, injectable provider
packages/server/src/server.ts              PrismaIcpAnalysisRepository
packages/server/src/modules/model/model-provider-registry.ts   groq entry; ollama entry removed
packages/server/.env.example               Groq model provider block
packages/server/tests/helpers.ts           analysis repository, injectable provider, env overrides
packages/server/tests/config.test.ts
packages/server/tests/icp-persistence.integration.test.ts

packages/web/src/api/client.ts             analysisApi
packages/web/src/App.tsx                   renders the analysis panel
packages/web/src/features/analysis/IcpAnalysisPanel.tsx        provider-neutral copy + rate-limit state
packages/web/tests/IcpForm.test.tsx        mock analysisApi
packages/web/tests/IcpAnalysisPanel.test.tsx

README.md
```

### Removed

Local inference was first removed from the **runtime path** — the `ollama`
`MODEL_PROVIDER` value, the registry entry and the `OLLAMA_*` environment block —
leaving the adapter in the tree as an unwired second implementation. A later
cleanup pass deleted it outright, since an implementation nothing can select is
dead weight rather than evidence:

```
packages/server/src/modules/model/local-model-provider.ts      Ollama adapter (389 lines)
packages/server/tests/local-model-provider.test.ts             its 23 Ollama-transport tests
```

The port survives the deletion untouched, which is the actual evidence that it
abstracts: `GroqModelProvider` implements `ModelProvider` and nothing above the
registry changed when the second implementation went away. `config.test.ts` still
pins that `MODEL_PROVIDER=ollama` is rejected at boot, so the value cannot come
back by accident.

---

## 12. Local development — exact commands

Requires Node ≥ 20.11, npm 10, PostgreSQL and a Groq API key. **No local model
runtime is required or used.**

```bash
# 1. Install and configure
npm install
npm run setup:env               # copies packages/*/.env.example → .env (never overwrites)

# 2. PostgreSQL
npm run db:up                   # PostgreSQL 16 in Docker on host port 55432
                                # (or point DATABASE_URL at your own instance)

# 3. Apply migrations
npm run prisma:deploy           # applies committed migrations
npm run prisma:generate         # regenerate the client after a schema change

# 4. Groq              https://console.groq.com/keys
#    Add the key to packages/server/.env (gitignored — never commit it):
#      MODEL_PROVIDER=groq
#      GROQ_API_KEY=<your key>
#      GROQ_MODEL=openai/gpt-oss-20b
#      GROQ_BASE_URL=https://api.groq.com/openai/v1

# 5. Confirm the key and the model before touching the UI
curl -s http://localhost:4000/api/model/health | jq .data
#   → { "available": true, "provider": "groq", "model": "openai/gpt-oss-20b", … }

# 6. Build the shared package, then run the app
npm run build:shared
npm run dev                     # API on :4000, form on :5173
```

Then, in the browser at <http://localhost:5173>:

1. **Load example** → **Create ICP**.
2. Scroll to **PURSUIT Analysis** → **Analyze ICP**.
3. A few seconds later the structured result renders.
4. Reload the page and reselect the ICP → the stored analysis loads without
   invoking the model.

The same flow from the command line:

```bash
ICP_ID=$(curl -s -X POST http://localhost:4000/api/icps   -H 'content-type: application/json'   -d @icp.json | jq -r .data.id)

curl -s -X POST http://localhost:4000/api/icps/$ICP_ID/analyze | jq .data.status
curl -s http://localhost:4000/api/icps/$ICP_ID/analyses | jq '.data.total'
curl -s http://localhost:4000/api/model/health | jq .data
```

### Running without a Groq key

Two supported states, both fully working APIs:

- `MODEL_PROVIDER=none` — the analysis endpoint returns
  `MODEL_PROVIDER_UNAVAILABLE` and the UI says so.
- `MODEL_PROVIDER=groq` with an empty `GROQ_API_KEY` — the same, except the
  message names the setting to fix.

The **test suite never calls Groq**: every model call is mocked, and there is no
test that needs a key or a network.

---

## 13. Verification

| Gate | Command | Result |
| --- | --- | --- |
| Install | `npm install` | pass — one package added (`groq-sdk`) |
| Types | `npm run typecheck` | pass (shared, server, web) |
| Lint | `npm run lint` | pass, 0 problems |
| Tests | `npm test` | pass — **261 total** (79 shared, 147 server, 35 web) |
| Prisma schema | `npm run prisma:validate` | valid + formatted |
| Prisma migrations | `npm run prisma:migrate-check` | in sync, **no drift, no new migration** |
| Backend build | `npm run build:server` | pass |
| Frontend build | `npm run build:web` | pass |

### Migration-specific checks

| Check | How | Result |
| --- | --- | --- |
| No local inference in the source tree | `grep -rniE "ollama|11434" packages/*/src` | no match — the adapter was deleted in the cleanup pass (§11) |
| `MODEL_PROVIDER=ollama` cannot be selected | `config.test.ts` | rejected at boot |
| The analysis path never calls a local runtime | `analysis-provider-selection.test.ts` | every request URL asserted against `api.groq.com`; `11434`, `localhost` and `127.0.0.1` asserted absent |
| No credential in the frontend | `grep -rniE "groq|api.?key" packages/web/src packages/web/dist` | no match |
| `.env` is not committed | `git check-ignore packages/server/.env` | ignored by `.gitignore:5` |
| Database unchanged | `prisma migrate diff` | no difference — the only schema edits were `///` doc comments, which emit no SQL |

### Test inventory added or changed by the migration

**`packages/server/tests/groq-model-provider.test.ts` — new, 37 tests, Groq mocked**

Base URL normalisation both ways · descriptor names the configured model ·
capabilities · unavailable with no key · the configured base URL is used, not a
hardcoded one · health available · health probes `GET /models` and **never**
`/chat/completions` · health names `GROQ_API_KEY` with no key and makes no
request · health names it again on a 401 · health names `GROQ_MODEL` when the
account is not served that model · health reports rather than throws when Groq
is unreachable · health reports a probe timeout · analysis stamped with
provider, model and prompt version · POSTs to
`https://api.groq.com/openai/v1/chat/completions` with the configured model ·
`response_format` is `json_schema` with `strict: true` and every dimension
required · **`minLength`/`maxLength`/`$schema` stripped while `maxItems` and
`minimum` are kept** · `stream: false` · the whole ICP is sent · **every request
URL is a Groq URL and none mentions `11434`, `localhost` or `127.0.0.1`** ·
fenced answer recovered · leaked `<think>` block stripped · missing key → named
configuration error with no HTTP call · 401 → named configuration error that does
**not** contain the key · 403 → configuration error · 429 → `MODEL_RATE_LIMITED`
carrying `Retry-After: 7.5` rounded to 8 · **a 429 produces exactly one HTTP
request** (no SDK retries) · 404 → unavailable · 500 → unavailable · connection
failure → unavailable · abort → `MODEL_TIMEOUT` with the budget · 400 →
`MODEL_INVALID_RESPONSE` rather than a crash · empty response rejected · prose
rejected · truncated JSON rejected · `finish_reason: length` reported as
truncation · schema mismatch rejected with a field path · unsupported enum
rejected.

**`packages/server/tests/analysis-provider-selection.test.ts` — new, 5 tests**

The only tests that boot the app from environment variables alone, with no
injected provider, so route → service → registry → adapter → HTTP is all real
and the *global* fetch is what gets stubbed:

`/health` reports `groq` and the configured model · an analysis completes and
stores `provider: groq, model: openai/gpt-oss-20b`, having made exactly one
request, to Groq · **the analysis and the health endpoint together never call a
local runtime** · `/api/model/health` reports Groq configuration status · with an
empty key the API still boots and serves ICPs, health and analyze both name
`GROQ_API_KEY`, and **Groq is never called**.

**`packages/server/tests/icp-analysis-api.test.ts` — 2 tests added (23 total)**

A rate limit becomes a 429 with the retry hint, a `FAILED` row and no leak of the
provider's wording · a missing credential is reported as a 503 that names
`GROQ_API_KEY`, with a `FAILED` row.

**`packages/server/tests/config.test.ts` — rewritten, 14 tests**

Groq defaults applied · `groq` accepted · a provider with no implementation
rejected · **`ollama` rejected** · bad `GROQ_BASE_URL` rejected · empty
`GROQ_MODEL` rejected when Groq is selected · **the API still boots with Groq
selected and no key** · the registry resolves `GroqModelProvider` from
configuration alone with the configured model reaching it · the descriptor
reports unavailable when the key is missing.

**`packages/shared/tests/model-provider.test.ts` — 3 tests added (79 shared total)**

The generic not-configured error carries no reason · a credential failure carries
an operator-facing reason · a rate limit is a distinct code that answers 429.

**`packages/web/tests/IcpAnalysisPanel.test.tsx` — 1 test added, 3 changed (35 web total)**

Unavailable now asserts the backend's explanation is shown and that the panel
names no provider of its own · a rate limit renders with its retry hint · the
provenance strip asserts `groq · openai/gpt-oss-20b`.

### Live end-to-end run

Run against live PostgreSQL and the **live Groq API** with a real key, through
the actual Fastify app — not mocks.

```
GET  /health                          → modelProvider { id: groq,
                                          version: openai/gpt-oss-20b, available: true }
GET  /api/model/health                → available: true,
                                          "Groq API reachable; model openai/gpt-oss-20b is available."
POST /api/icps                        → 201, version 1
POST /api/icps/:id/analyze            → 201 in 1.76s, status COMPLETED
       provider groq · model openai/gpt-oss-20b · prompt v2 · contract icp-analysis.v1
       all 13 dimensions populated, 33–38 entries
       inputSnapshot.icp === the stored config
GET  /api/icps/:id/analyses           → total 1, COMPLETED
GET  /api/icps/:id/analyses/:id       → the same row
GET  /api/icps/:id                    → still version 1
SELECT from icp_analyses              → status COMPLETED, provider groq,
                                          model openai/gpt-oss-20b, output non-null,
                                          error_code null, duration_ms 1729
```

**Repeatability.** Five consecutive analyses of the same ICP: **four COMPLETED**
(1.73s, 2.02s, 1.77s, 1.79s), one `MODEL_OUTPUT_VALIDATION_FAILED` — Groq
returning `json_validate_failed` with empty content. The failure was handled
exactly as designed: 502, a `FAILED` row, `output` null, and nothing malformed
stored. See §14.11.

**No local runtime was involved, and this is worth stating precisely, because
Ollama *was* running on the verification machine** (PID listening on
`127.0.0.1:11434`) — which makes the check meaningful rather than vacuous:

```
netstat -ano | grep 11434     → 127.0.0.1:11434 LISTENING  (Ollama, a different process)
netstat, API process          → only  [::1]:5432 ESTABLISHED  ×2   (PostgreSQL)
                              → and   0.0.0.0:4000 LISTENING       (its own port)
netstat, any conn to :11434   → none, in any state, by any process
```

The API process never opened a connection to the Ollama port, and the analysis
succeeded in 1.8 seconds — a local `qwen3:8b` on this hardware needed 577.

**Error paths, exercised against the live API** (not mocked):

| Condition | Observed |
| --- | --- |
| Bad key | health `available: false`; analyze → `ModelProviderNotConfiguredError`, *"Groq rejected the configured GROQ_API_KEY (HTTP 401)"* |
| Key absent | health and analyze both name `GROQ_API_KEY`; **zero HTTP requests made** |
| Unknown model | health names `GROQ_MODEL`; analyze → `MODEL_PROVIDER_UNAVAILABLE` |
| `MODEL_TIMEOUT_MS=1` | `ModelTimeoutError`, `timeoutMs: 1` |
| Free-tier quota exhausted | 429 in 0.14s, `MODEL_RATE_LIMITED`, *"…wait a moment and run the analysis again. Retry after about 22s."* |
| Schema miss | 502, `MODEL_OUTPUT_VALIDATION_FAILED`, `FAILED` row, `output` null |

**The API key did not leak.** Across 17 log lines covering successes and every
failure above: the key absent, `gsk_` absent, `authorization` absent. The 401
message names the *setting*, never the value; a test asserts that too.

> **Caution for the next developer.** `packages/server/tests/icp-persistence.integration.test.ts`
> runs against whatever `DATABASE_URL` points at and truncates its tables. It
> silently wiped the live ICP and its analyses mid-verification. Pre-existing
> behaviour, not introduced here, but do not run `npm test` against a database
> whose contents you care about.

---

## 14. Known limitations

1. **Synchronous.** `POST …/analyze` holds the HTTP connection for the whole
   model call. On Groq that is seconds rather than minutes, so it is no longer
   the pressing problem it was locally — but it is still the wrong shape. No
   background job infrastructure was introduced, as instructed. A `PENDING`
   status exists in the enum for exactly that future change; nothing writes it
   today.
2. **A RUNNING row can be orphaned.** If the process dies mid-call the row stays
   `RUNNING` forever. There is no reaper.
3. **Quality is not asserted.** The tests prove the output is *structurally*
   valid. Nothing checks that the signals are useful; that needs an eval set,
   which belongs with the discovery slice that consumes them.
4. **Array length is guidance, not grammar.** `maxItems` is compiled, but the
   prompt is what asks for three entries. A model that returns an empty
   dimension produces a valid, if thin, analysis.
5. **Length bounds are validated, not decoded.** Because strict Structured
   Outputs will not compile `minLength`/`maxLength` (§3), an over-long field is
   caught by Zod *after* generation and fails the run rather than being
   prevented.
6. **No concurrency control and no rate limiting of our own.** Two simultaneous
   analyses of one ICP both run and both store a row, and on the free tier a
   third within the minute collects a 429 (§5). The 429 is handled and reported;
   nothing queues, throttles or backs off. `maxRetries: 0` is deliberate (§3),
   so a rate-limited analysis fails rather than waiting.
7. **The ICP leaves the machine.** The configuration is sent to a third-party
   API. That is inherent to hosted inference and is the trade this migration
   made; it is worth stating plainly, because the local provider did not do it.
   No credential, no prospect data and no personal data is sent — only the
   normalized ICP configuration a user authored.
8. **`generateStructured` is only lightly exercised.** `analyzeICP` is the path
   this slice uses; the generic method works but has no capability behind it yet.
9. **No caching.** Re-analyzing an unchanged ICP re-runs the model — and now
   spends someone's quota doing it.
10. **Token cost is not measured or capped.** Groq returns usage figures — about
    4,000 tokens per analysis, three quarters of that the ICP in the prompt —
    and nothing reads, stores or budgets against them.
    `max_completion_tokens` is left unset, so a runaway generation is bounded
    only by the model's own limit and caught after the fact by the
    `finish_reason: length` check.
11. **A rejected answer is still not retried by default.** Because Groq
    validates rather than constrains (§3, fact 2), a model can emit JSON that
    does not fit the contract, and `MODEL_MAX_ATTEMPTS` defaults to `1`. The
    failure is clean — 502, a `FAILED` row, nothing malformed stored — and that
    is the specified behaviour: a schema miss is a failed analysis, not
    something to repair.

    This was the dominant failure of the slice while `gpt-oss-20b` was the
    default: half of eight consecutive runs against the v3 prompt, every one the
    same malformed-array defect (§5). Moving to `gpt-oss-120b` removed it in the
    sample — 14 of 14 complete — so what remains here is the untaken remedy, not
    an observed failure rate. The retry stays off on the free tier for the reason
    it always was: one analysis now costs ~7,500 tokens against an 8,000/minute
    ceiling, so a second attempt inside the same minute would 429 rather than
    land. `MODEL_MAX_ATTEMPTS=2` is correct on any account with per-minute
    headroom.

---

## 15. Next implementation step

The port is now proven end to end, which is what the discovery slice needs.

**Next:** consume `discoveryKeywords` and `mustHaveSignals` from a stored
`ICPAnalysis` to drive a first candidate discovery query, persisting candidates
as their own entity — with the model still on the far side of `ModelProvider`
and scoring still absent. That is the next arrow in the plan's pipeline:

```
ICP → [done] ModelProvider → structured analysis → PostgreSQL
                                    │
                                    ▼
                            Discovery Engine → Prospects → Evidence → …
```
