import { z } from 'zod';

/** Groq's OpenAI-compatible base URL, the value operators recognise. */
export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Apollo's API root. The adapter appends `/api/v1/...` itself. */
export const DEFAULT_APOLLO_BASE_URL = 'https://api.apollo.io';

/**
 * The open-weight model this slice was built and measured against.
 *
 * `gpt-oss-120b` rather than the `20b` it started on, and the reason is
 * measured rather than aesthetic. Groq's strict Structured Outputs *validates
 * after generating* instead of constraining the decoder, so nothing stops a
 * model from emitting malformed JSON - and against the `icp-analysis.v2`
 * contract, `20b` did, on half its runs: it closed a nested string array with
 * `}` instead of `]` (`"observableEvidence":["…"}]`), which Groq rejected as a
 * 400 `json_validate_failed`. `120b` produced fourteen consecutive complete,
 * Zod-valid analyses against the same prompt and schema.
 *
 * It costs about 600 more completion tokens and a few seconds per analysis.
 * That is the price of the contract being satisfied rather than half-satisfied.
 */
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

/**
 * Environment contract. Validated once at boot so a misconfigured deployment
 * fails immediately instead of at the first request.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    /**
     * Which `ModelProvider` implementation to resolve. `none` stays a fully
     * working configuration (plan Part B, B8): the API keeps serving ICPs and
     * only the analysis endpoint reports the provider as unavailable.
     *
     * There is deliberately no local-inference option. Analysis runs against
     * Groq's hosted API, and a Groq failure is reported as a model error rather
     * than silently falling back to anything else.
     */
    MODEL_PROVIDER: z.enum(['none', 'groq']).default('none'),

    /**
     * Groq API credential. Backend only - it is never sent to the frontend,
     * stored in PostgreSQL or written to a log.
     *
     * Deliberately *not* required at boot even when Groq is selected: the API
     * still has to start so `/health` and `/api/model/health` can report the
     * missing key, and an analysis attempt returns a named configuration error.
     * A server that refuses to boot can report nothing at all.
     */
    GROQ_API_KEY: z.string().trim().default(''),

    /** Groq's OpenAI-compatible endpoint. Never hardcoded in the provider. */
    GROQ_BASE_URL: z
      .string()
      .url('GROQ_BASE_URL must be a URL')
      .default(DEFAULT_GROQ_BASE_URL),

    /**
     * The concrete open-weight model, e.g. `openai/gpt-oss-120b`. Business
     * logic never names one; this is the only place a model id is chosen.
     */
    GROQ_MODEL: z.string().trim().min(1).default(DEFAULT_GROQ_MODEL),

    /**
     * How much reasoning the model may spend before answering.
     *
     * `low` is not a performance tweak, it is what makes the analysis work at
     * all. Reasoning tokens are drawn from the same completion budget as the
     * answer, so a model left at its own default spends the budget thinking and
     * then closes the JSON object early - dropping the last few sections and
     * failing the contract. Measured on the example ICP against `gpt-oss-20b`:
     * with `low`, 11-17 reasoning tokens and a complete analysis in ~1.9s;
     * without it, a 400 `json_validate_failed` from Groq on roughly two runs in
     * three. Kept at `low` for `gpt-oss-120b`, which every measurement behind
     * `DEFAULT_GROQ_MODEL` was taken at.
     *
     * The accepted values differ per model family (`gpt-oss` takes
     * low/medium/high, `qwen3` takes none/default), and a model that supports
     * none of them rejects the parameter outright - so an empty value omits it.
     */
    GROQ_REASONING_EFFORT: z
      .enum(['', 'none', 'default', 'low', 'medium', 'high'])
      .default('low'),

    /**
     * Wall-clock budget for one model call.
     *
     * Two minutes against a hosted API: a `gpt-oss` analysis on Groq
     * answers in seconds, so this is headroom for a slow network or a queued
     * request, not an expected duration. It is also the only thing standing
     * between a hung socket and a request that never returns.
     */
    MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(1800000).default(120000),

    /**
     * Completion budget for one analysis, in tokens.
     *
     * Explicit rather than left to the provider's default, because the failure
     * it prevents is silent-looking: an analysis that runs out of budget
     * mid-object is rejected by Groq as `json_validate_failed`, which reads like
     * a model that cannot follow a schema rather than one that was cut off.
     *
     * The `icp-analysis.v2` contract is twelve sections of reasoned prose, so it
     * needs several thousand tokens of room where the old signal lists needed a
     * few hundred. 8192 leaves roughly double the headroom a complete analysis
     * uses, on top of whatever the model spends on reasoning.
     */
    MODEL_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(512).max(65536).default(8192),

    /**
     * How many times one analysis may be attempted, in total.
     *
     * The retry covers exactly one class of failure: the model was reached, it
     * answered, and the answer missed the output contract - a top-level array
     * instead of an object, a required key dropped, a list left short. Groq's
     * strict mode validates *after* generating, so these arrive as an HTTP 400
     * on work that was otherwise fine, and asking the same question again with
     * the breach named usually lands. Nothing else is retried; a rate limit or a
     * timeout is not improved by asking twice.
     *
     * It is a second attempt, not a repair - the analysis is regenerated from
     * the briefing and no part of the rejected answer survives.
     *
     * **Defaults to 1 - off - because of measured token limits, not doubt about
     * the mechanism.** One analysis costs roughly 5.3k tokens, and Groq's free
     * tier allows 8k per minute: a second call issued immediately cannot fit, so
     * the retry would 429 rather than succeed, while still spending against a
     * 200k daily ceiling that only affords about 37 analyses as it is. The
     * provider guards against the worst of that - a rate limit provoked by its
     * own retry still reports the malformed answer underneath - but budget spent
     * on an attempt that cannot land buys nothing.
     *
     * Raise it to 2 on any account with per-minute headroom. That is where it
     * pays: a malformed answer is stochastic and structural, and asking again
     * with the breach named usually lands.
     */
    MODEL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(1),

    /** Stamped onto every analysis so a stored result stays reproducible. */
    MODEL_PROMPT_VERSION: z.string().trim().min(1).max(32).default('v3'),

    // --- Prospect discovery -------------------------------------------------

    /**
     * Which data provider to resolve - for both the `CompanyDiscoveryProvider`
     * (firmographic search) and the `PeopleDiscoveryProvider` (prospect
     * search). One setting covers both because it names the vendor rather than
     * one of its endpoints; a vendor offering only one registers the null
     * implementation for the other, and that endpoint reports as unavailable
     * while the rest keeps working.
     *
     * `none` stays a fully working configuration, for the same reason
     * `MODEL_PROVIDER=none` does: the API keeps serving ICPs and analyses, and
     * only a discovery attempt reports the provider as unavailable. A server
     * that refuses to boot without an Apollo key can report nothing at all -
     * and the whole test suite would need a credential to run.
     */
    DISCOVERY_PROVIDER: z.enum(['none', 'apollo']).default('none'),

    /**
     * Apollo API credential. Backend only - it is never sent to the frontend,
     * stored in PostgreSQL or written to a log, and it must never be given a
     * `VITE_` prefix.
     *
     * Deliberately *not* required at boot even when Apollo is selected: the API
     * still has to start so `/health` and `/api/discovery/health` can report
     * the missing key, and a discovery attempt returns a named configuration
     * error instead of a mystery.
     */
    APOLLO_API_KEY: z.string().trim().default(''),

    /** Apollo's API root. Never hardcoded in the adapter. */
    APOLLO_BASE_URL: z
      .string()
      .url('APOLLO_BASE_URL must be a URL')
      .default(DEFAULT_APOLLO_BASE_URL),

    /**
     * Wall-clock budget for one Apollo HTTP request.
     *
     * Ten seconds: organization search is a filtered index lookup that answers
     * in well under a second, so this is headroom for a slow network, not an
     * expected duration. It is also the only thing standing between a hung
     * socket and a discovery request that never returns - and because a search
     * walks several pages, a generous per-request budget multiplies.
     */
    APOLLO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10000),

    /**
     * How many times one Apollo request may be attempted, in total.
     *
     * The retry covers only failures where the call did not happen: a network
     * error, or a 408/5xx. Two attempts is the useful setting - a dropped
     * socket is usually not dropped twice - and nothing else is retried. A 429
     * in particular is never retried: the window is exhausted, and asking again
     * inside it makes the rate limit worse while burning quota.
     */
    APOLLO_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),

    /** First backoff step between Apollo attempts; doubled per attempt. */
    APOLLO_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).max(10000).default(250),

    /**
     * Hard ceiling on Apollo pages per discovery search.
     *
     * Apollo bills a credit per page, so this is a spend control rather than a
     * performance one, and it is independent of the caller's `limit` so a bad
     * request cannot walk 500 pages. Five pages x 100 companies is 500
     * candidates, comfortably above the contract's own 200-candidate ceiling.
     */
    APOLLO_MAX_PAGES_PER_SEARCH: z.coerce.number().int().min(1).max(50).default(5),

    // --- Contact enrichment -------------------------------------------------

    /**
     * Whether to enrich surviving candidates with contact details.
     *
     * On by default, because without it a prospect search cannot answer the
     * question it exists for: Apollo's people *search* returns neither email
     * addresses nor phone numbers - those come only from the separate
     * enrichment endpoints - so a discovery run with enrichment off produces a
     * list of names nobody can contact.
     *
     * It stays a setting rather than being unconditional for two reasons: an
     * account whose plan excludes enrichment should be able to turn off calls
     * that can only fail, and an account-mapping exercise that wants companies
     * rather than contacts should not be billed per person for data it will not
     * read. With it off, the pipeline runs exactly as before and the response
     * carries no enrichment block.
     */
    APOLLO_ENRICHMENT_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    /**
     * Whether to ask Apollo to reveal phone numbers during enrichment.
     *
     * **Off by default, and deliberately the one thing an operator has to opt
     * into.** Phone reveal consumes a separate Apollo credit type from email
     * enrichment, and Apollo resolves it *asynchronously* - so the numbers are
     * frequently not in the response that requested them, and the credit is
     * spent either way.
     *
     * This application has no public HTTPS webhook receiver, so the request is
     * always sent poll-only: whatever Apollo has ready comes back, anything
     * still running is reported as `PENDING` on that prospect, and a later run
     * picks it up. Building a webhook endpoint purely for this would be a far
     * larger commitment than the stage warrants.
     */
    APOLLO_REVEAL_PHONE_NUMBERS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /**
     * Hard ceiling on candidates enriched per search run.
     *
     * A spend control, independent of the caller's page size, so a large page
     * cannot quietly become a large bill - the same role
     * `APOLLO_MAX_PAGES_PER_SEARCH` plays for search. Defaults to the default
     * page size, so an ordinary run enriches everything it found and a
     * hundred-person page enriches the first 25 and says so.
     */
    APOLLO_MAX_ENRICHMENTS_PER_RUN: z.coerce.number().int().min(1).max(500).default(25),
  })
  .superRefine((env, ctx) => {
    // Defaults make the Groq settings optional, but an empty override is a
    // configuration mistake worth failing on rather than silently defaulting.
    if (env.MODEL_PROVIDER !== 'groq') return;
    if (env.GROQ_MODEL.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GROQ_MODEL'],
        message: 'GROQ_MODEL is required when MODEL_PROVIDER=groq',
      });
    }
  });

export type Env = z.output<typeof envSchema>;

export interface EnvLoadFailure {
  readonly ok: false;
  readonly messages: string[];
}

export interface EnvLoadSuccess {
  readonly ok: true;
  readonly env: Env;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): EnvLoadSuccess | EnvLoadFailure {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) return { ok: true, env: parsed.data };
  return {
    ok: false,
    messages: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
  };
}

/** Loads the environment or exits with a readable message. */
export function loadEnvOrThrow(source: NodeJS.ProcessEnv = process.env): Env {
  const result = loadEnv(source);
  if (!result.ok) {
    throw new Error(`Invalid environment configuration:\n  - ${result.messages.join('\n  - ')}`);
  }
  return result.env;
}

export function corsOrigins(env: Env): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
