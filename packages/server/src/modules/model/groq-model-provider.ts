import { randomUUID } from 'node:crypto';
import Groq, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from 'groq-sdk';
import { z } from 'zod';
import {
  ModelInvalidResponseError,
  ModelOutputValidationError,
  ModelProviderNotConfiguredError,
  ModelProviderUnavailableError,
  ModelRateLimitedError,
  ModelTimeoutError,
  icpAnalysisOutputJsonSchema,
  icpAnalysisOutputSchema,
  isModelProviderError,
  zodErrorToDetails,
  type ApiErrorDetail,
  type IcpAnalysisModelResult,
  type IcpModelInput,
  type ModelCapability,
  type ModelProvider,
  type ModelProviderDescriptor,
  type ModelProviderError,
  type ModelProviderHealth,
  type StructuredModelRequest,
  type StructuredModelResponse,
} from '@pursuit/shared';
import {
  ICP_ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisCorrection,
  buildIcpAnalysisUserPrompt,
} from './icp-analysis-prompt.js';
import { extractJsonObject, parseStructuredOutput } from './structured-json.js';

/**
 * `ModelProvider` backed by an open-weight model on Groq's hosted API.
 *
 * This is the only file in the codebase that knows Groq exists. Everything
 * above it depends on the port, so swapping in another hosted runtime is one
 * new class plus one registry entry - no service, route or schema changes.
 *
 * Three properties are load-bearing:
 *  - **Structured Outputs.** The JSON Schema derived from
 *    `icpAnalysisOutputSchema` is sent as `response_format.json_schema` with
 *    `strict: true`, so the model is decoded against the contract rather than
 *    asked politely for JSON.
 *  - **Validate, never repair.** The answer still goes through Zod. A response
 *    that does not fit is an error, not something to be patched up.
 *  - **No fallback.** A Groq failure is reported as a model error. There is no
 *    second provider behind this one to retry against.
 */

export const GROQ_MODEL_PROVIDER_ID = 'groq';

/** Named in `json_schema.name`; must match `[a-zA-Z0-9_-]{1,64}`. */
const RESPONSE_FORMAT_NAME = 'icp_analysis';

export interface GroqModelProviderOptions {
  /** Backend-only credential. Empty means "not configured", never "try anyway". */
  readonly apiKey: string;
  /** Groq's OpenAI-compatible base URL, from configuration. */
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  /**
   * Completion budget for one call.
   *
   * Sent explicitly because the `icp-analysis.v2` contract is long enough that
   * the provider default is a real constraint, and running out of it produces a
   * `json_validate_failed` that looks like a schema failure rather than a
   * truncation. See `MODEL_MAX_OUTPUT_TOKENS`.
   */
  readonly maxOutputTokens: number;
  /**
   * How many times one analysis may be attempted, in total.
   *
   * 2 gives a malformed answer one more go with the breach named; 1 turns the
   * retry off, which is the right setting when the account's per-minute token
   * budget cannot fit two analyses. See `MODEL_MAX_ATTEMPTS`.
   */
  readonly maxAttempts: number;
  readonly promptVersion: string;
  /**
   * Reasoning budget. Empty omits the parameter, for a model that does not
   * accept it. See `GROQ_REASONING_EFFORT` for why this is load-bearing.
   */
  readonly reasoningEffort?: GroqReasoningEffort | '';
  /** Injected in tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/** The values Groq accepts; the family a model belongs to decides which. */
export type GroqReasoningEffort = 'none' | 'default' | 'low' | 'medium' | 'high';

const CAPABILITIES: readonly ModelCapability[] = ['ICP_ANALYSIS', 'STRUCTURED_EXTRACTION'];

/** System turn for the generic structured path, which carries no domain intent. */
const GENERIC_SYSTEM_PROMPT = [
  'You are a structured data extraction engine.',
  'Return ONLY valid JSON matching the supplied schema.',
  'Do not add markdown, code fences or any explanation outside the JSON.',
  'Do not invent facts that the supplied input does not support.',
].join('\n');

const MISSING_KEY_DETAIL =
  'GROQ_API_KEY is not configured. Add it to packages/server/.env and restart the API.';

/**
 * Keys removed from the decoding constraint before it is sent.
 *
 * The governing rule: the constraint may be *looser* than the Zod contract,
 * never *stricter*. Zod is what gates persistence, so anything it would accept
 * must survive the round trip - a constraint that rejects an answer the
 * contract would have taken is throwing away good work.
 *
 * `minLength`/`maxLength` are outside Groq's supported strict subset and make
 * it reject the whole schema with an HTTP 400, and `$schema` is metadata it has
 * no use for. Both stay enforced by Zod, so a model that writes a
 * 3000-character explanation still produces a failed analysis rather than an
 * oversized stored one.
 *
 * `minimum`, `maximum`, `maxItems` and `enum` are inside the supported subset
 * and are deliberately kept, so the ranges the contract cares about are
 * enforced during decoding instead of being discovered at validation time.
 *
 * ## `additionalProperties` stays, and it is a known divergence
 *
 * `zodToJsonSchema` emits `additionalProperties: false` at all fourteen object
 * levels, so Groq rejects an answer carrying one extra key - while
 * `icpAnalysisOutputSchema` is deliberately non-strict and *strips* that key.
 * The constraint is therefore stricter than the contract, which is exactly what
 * the rule above forbids.
 *
 * It is kept anyway, because removing it is worse: Groq's `strict: true`
 * *requires* `additionalProperties: false`, and without it the schema itself is
 * rejected. Measured directly - dropping the keyword took the example ICP from
 * roughly three runs in five succeeding to nought in six, every one a rejected
 * request rather than a rejected answer.
 *
 * So the divergence is closed from the other end: the prompt tells the model to
 * emit exactly the twelve keys and no others. See the REQUIRED KEYS block.
 */
const UNSUPPORTED_SCHEMA_KEYS = new Set(['minLength', 'maxLength', '$schema']);

function toDecodingConstraint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toDecodingConstraint);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYS.has(key))
      .map(([key, nested]) => [key, toDecodingConstraint(nested)]),
  );
}

const OPENAI_COMPATIBLE_SUFFIX = '/openai/v1';

/**
 * The SDK builds its own `/openai/v1/...` paths, so it wants the host root
 * while `GROQ_BASE_URL` is documented - and recognised by operators - as the
 * OpenAI-compatible base `https://api.groq.com/openai/v1`. Both forms are
 * accepted here; neither is hardcoded.
 */
export function toSdkBaseUrl(configured: string): string {
  const trimmed = configured.replace(/\/+$/, '');
  return trimmed.endsWith(OPENAI_COMPATIBLE_SUFFIX)
    ? trimmed.slice(0, -OPENAI_COMPATIBLE_SUFFIX.length)
    : trimmed;
}

/**
 * The answer Groq generated and then rejected, when it sent one back.
 *
 * Groq returns the offending text in `failed_generation`, which is the only
 * account of the failure available when it declines to name a constraint - see
 * `jsonValidateFailedDetails` for what that is worth.
 */
function groqFailedGeneration(error: object): string {
  const body = (error as { error?: unknown }).error;
  if (typeof body !== 'object' || body === null) return '';

  const direct = (body as { failed_generation?: unknown }).failed_generation;
  if (typeof direct === 'string') return direct;

  const nested = (body as { error?: unknown }).error;
  if (typeof nested !== 'object' || nested === null) return '';
  const failed = (nested as { failed_generation?: unknown }).failed_generation;
  return typeof failed === 'string' ? failed : '';
}

/**
 * Groq's error `code`, when it sent a structured error body.
 *
 * `APIError.error` holds the *whole* parsed body, so the code sits at
 * `error.error.error.code` for Groq's `{ "error": { "code": … } }` envelope.
 * Both nestings are accepted rather than assuming one, and it is read
 * structurally because `instanceof` on a generic class types this `any`.
 */
function groqErrorCode(error: object): string {
  const body = (error as { error?: unknown }).error;
  if (typeof body !== 'object' || body === null) return '';

  const direct = (body as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;

  const nested = (body as { error?: unknown }).error;
  if (typeof nested !== 'object' || nested === null) return '';
  const code = (nested as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

/**
 * The HTTP status behind an `APIError`.
 *
 * Read structurally rather than through `error.status`: `instanceof` on a
 * generic class widens its type arguments to `any`, and an `any` status is
 * exactly the kind of value that should not flow into an error message.
 */
function httpStatusOf(error: object): number {
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : 0;
}

/** `Retry-After` in whole seconds, when Groq sent one. */
function retryAfterSeconds(error: APIError): number | undefined {
  const raw = error.headers?.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number.parseFloat(raw);
  return Number.isFinite(seconds) ? Math.ceil(seconds) : undefined;
}

/**
 * The failing constraint behind a `json_validate_failed`, as a field detail.
 *
 * Groq validates the answer *after* generating it and reports the breach in one
 * sentence of its 400 body:
 *
 *   Error: jsonschema: '/fitModel/strongFit' does not validate with
 *   /properties/fitModel/properties/strongFit/minItems: minimum 3 items
 *   required, but found 1 items
 *
 * Without this, that sentence is buried in a message the API layer replaces
 * before it reaches anyone, so a caller sees `MODEL_OUTPUT_VALIDATION_FAILED`
 * with `details: []` and no way to tell a truncated answer from a model that
 * returned four fit criteria where the contract wanted three. The JSON pointer
 * is rewritten into the same `output.a.b` path shape the Zod path produces, so
 * a client cannot tell which of the two validators rejected the answer - and
 * should not have to.
 *
 * Best-effort by design: an unrecognised body yields no details rather than a
 * guess, and never throws while another error is being constructed.
 */
export function jsonValidateFailedDetails(message: string): ApiErrorDetail[] {
  const pointed = /jsonschema:\s*'([^']*)'\s*does not validate with\s*\S+:\s*([^"\\]+)/.exec(message);
  if (pointed) {
    const reason = pointed[2]?.trim() ?? '';
    // `/fitModel/strongFit` -> `output.fitModel.strongFit`; array indices stay
    // as segments, matching how `zodErrorToDetails` renders a path.
    const path = (pointed[1] ?? '')
      .split('/')
      .filter((segment) => segment.length > 0)
      .join('.');

    if (reason.length > 0) {
      return [
        {
          path: path.length > 0 ? `output.${path}` : 'output',
          message: reason,
          code: 'json_validate_failed',
        },
      ];
    }
  }

  /**
   * Not every rejection carries a JSON pointer. Groq also reports breaches as a
   * bare `Error: missing properties: 'evidenceStrategy'`, and an unrecognised
   * form left `details` empty - which is the state this function exists to
   * prevent, because an empty `details` is indistinguishable from "we have no
   * idea". Anything after `Error:` is attributed to the answer as a whole,
   * which is true and more use than nothing.
   */
  const bare = /Error:\s*([^"\\]+)/.exec(message)?.[1]?.trim();
  if (bare === undefined || bare.length === 0) return [];
  return [{ path: 'output', message: bare, code: 'json_validate_failed' }];
}

/**
 * Diagnoses a rejected answer ourselves, from the text Groq handed back.
 *
 * Groq has more than one way of reporting a `json_validate_failed`. Sometimes
 * it names the breached constraint, and `jsonValidateFailedDetails` lifts that
 * out. Sometimes it says only:
 *
 *   Failed to generate JSON. Please adjust your prompt. See 'failed_generation'
 *
 * which names nothing at all - and "adjust your prompt" is not advice anyone
 * can act on without knowing which of a twelve-section contract was missed.
 *
 * But `failed_generation` carries the answer itself, and we hold the contract
 * it was judged against, so the diagnosis is recoverable: parse the text and
 * run it through Zod. What comes back is the same field-addressable detail the
 * normal validation path produces.
 *
 * This is diagnosis, never recovery. The parsed value is used only to explain
 * the rejection and is then discarded - a rejected answer stays rejected, which
 * is what "validate, never repair" means. Best-effort and total: unparsable
 * text, or text that somehow satisfies the contract, yields no detail rather
 * than a guess.
 */
export function diagnoseFailedGeneration(failedGeneration: string): ApiErrorDetail[] {
  if (failedGeneration.trim().length === 0) return [];

  let parsed: unknown;
  try {
    /**
     * Parsed strictly, and only then loosely.
     *
     * `extractJsonObject` takes the first `{` to the last `}`, which would
     * quietly salvage the inner object out of a `[{ ... }]` and report the
     * answer as valid - hiding the top-level-array breach that is one of the
     * failures this diagnosis exists to name. Diagnosis wants what the model
     * actually produced; the loose path is kept only as a fallback for an
     * answer wrapped in a code fence or a stray reasoning block.
     */
    parsed = JSON.parse(failedGeneration.trim());
  } catch {
    try {
      parsed = JSON.parse(extractJsonObject(failedGeneration));
    } catch {
      // Not JSON at all: the shape of the failure is itself the finding.
      return [
        {
          path: 'output',
          message: 'The model did not return parsable JSON',
          code: 'json_validate_failed',
        },
      ];
    }
  }

  const validated = icpAnalysisOutputSchema.safeParse(parsed);
  if (validated.success) return [];
  return zodErrorToDetails(validated.error, ['output']);
}

/**
 * Whether a failure is the model producing a bad *answer*, as opposed to the
 * call not happening at all.
 *
 * Only these two are worth a second attempt: the model was reached, it wrote
 * something, and what it wrote missed the contract. A rate limit, a timeout, a
 * rejected key or an unreachable API are not answers and asking again does not
 * improve them.
 */
function isMalformedAnswer(error: unknown): error is ModelProviderError {
  return error instanceof ModelOutputValidationError || error instanceof ModelInvalidResponseError;
}

/**
 * Maps a Groq SDK failure onto the port's error vocabulary.
 *
 * The messages here are for the server log and for `MODEL_PROVIDER_UNAVAILABLE`
 * diagnostics; the API layer replaces them with its own written copy before
 * anything reaches a client. Nothing in them can contain the API key - the SDK
 * builds its message from the response status and body, never from the request
 * headers.
 */
function toModelError(error: unknown, model: string, timeoutMs: number): never {
  // Already in the port's vocabulary: raised by our own parsing/validation.
  if (isModelProviderError(error)) throw error;

  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) {
    throw new ModelTimeoutError(timeoutMs);
  }
  if (error instanceof RateLimitError) {
    throw new ModelRateLimitedError(
      `Groq rate limit reached: ${error.message}`,
      retryAfterSeconds(error),
    );
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    // A rejected credential is a configuration problem, not an outage, and the
    // operator has to be told which credential to fix.
    throw new ModelProviderNotConfiguredError(
      'ICP_ANALYSIS',
      `Groq rejected the configured GROQ_API_KEY (HTTP ${String(error.status)}). Check the key and its permissions.`,
    );
  }
  if (error instanceof NotFoundError) {
    throw new ModelProviderUnavailableError(
      `The model "${model}" is not available to this Groq account`,
    );
  }
  if (error instanceof APIConnectionError) {
    throw new ModelProviderUnavailableError('Could not reach the Groq API');
  }
  if (error instanceof APIError) {
    const status = httpStatusOf(error);
    if (status >= 500) {
      throw new ModelProviderUnavailableError(`The Groq API answered ${String(status)}`);
    }

    /**
     * `json_validate_failed` is a 400, but it is not a bad request: Groq
     * generated an answer and then rejected it against the schema we sent.
     * Strict Structured Outputs validates *after* generating rather than
     * constraining the decoder, so this is the model missing the contract -
     * exactly what `MODEL_OUTPUT_VALIDATION_FAILED` means. Reporting it as a
     * malformed request would point an operator at the wrong thing.
     */
    if (groqErrorCode(error) === 'json_validate_failed') {
      // The full body - `failed_generation` included - stays in the message so
      // the server log has the answer that was rejected. `details` carries the
      // one part a caller can act on: which field broke which constraint.
      // Groq's own account of the breach first; if it named none, work it out
      // from the answer it rejected.
      const named = jsonValidateFailedDetails(error.message);
      throw new ModelOutputValidationError(
        `The model's answer did not satisfy the analysis schema: ${error.message}`,
        named.length > 0 ? named : diagnoseFailedGeneration(groqFailedGeneration(error)),
      );
    }

    // Any other 400/422: the request we built is not acceptable - a wrong model
    // id, or a schema Groq's strict mode will not compile. Not retryable, and
    // not something a caller can fix.
    throw new ModelInvalidResponseError(
      `Groq rejected the analysis request (HTTP ${String(status)}): ${error.message}`,
    );
  }

  // A non-API failure from the SDK, or anything else unforeseen.
  const detail = error instanceof Error ? error.message : String(error);
  throw new ModelProviderUnavailableError(`The Groq call failed: ${detail}`);
}

export class GroqModelProvider implements ModelProvider {
  /** Built on first use, so a missing key is a reported state, not a crash. */
  private client: Groq | undefined;

  constructor(private readonly options: GroqModelProviderOptions) {}

  describe(): ModelProviderDescriptor {
    return {
      id: GROQ_MODEL_PROVIDER_ID,
      displayName: `Open-weight model on Groq (${this.options.model})`,
      version: this.options.model,
      capabilities: CAPABILITIES,
      // "Selected and able to be constructed". Whether Groq answers is
      // healthCheck's business, not the descriptor's.
      available: this.isConfigured(),
    };
  }

  supports(capability: ModelCapability): boolean {
    return CAPABILITIES.includes(capability);
  }

  /**
   * Configuration and reachability probe. Deliberately total: callers use it to
   * render a status, so an unreachable API is a result, not an exception.
   *
   * It lists the account's models rather than generating anything: a health
   * check must not spend tokens, and one GET already proves the three things
   * that can be wrong - the key is present, the key is accepted, and the
   * configured model is served to this account.
   *
   * The list endpoint is used in preference to `models/{id}`, because a model
   * id containing a slash (`openai/gpt-oss-20b`) has to be percent-encoded
   * into that path and a health check is the wrong place to depend on how a
   * server decodes it.
   */
  async healthCheck(): Promise<ModelProviderHealth> {
    const base = {
      provider: GROQ_MODEL_PROVIDER_ID,
      model: this.options.model,
      checkedAt: new Date().toISOString(),
    };

    if (!this.isConfigured()) {
      return { ...base, available: false, detail: MISSING_KEY_DETAIL };
    }

    try {
      const models = await this.requireClient().models.list({
        // A status probe must not sit on the full analysis budget.
        timeout: Math.min(this.options.timeoutMs, 10000),
      });
      const served = models.data.some((model) => model.id === this.options.model);

      if (!served) {
        return {
          ...base,
          available: false,
          detail: `The Groq API is reachable but does not serve the model "${this.options.model}" to this account. Check GROQ_MODEL.`,
        };
      }
      return {
        ...base,
        available: true,
        detail: `Groq API reachable; model "${this.options.model}" is available.`,
      };
    } catch (error) {
      return { ...base, available: false, detail: this.describeUnhealthy(error) };
    }
  }

  /**
   * One analysis, with a bounded second attempt on a malformed answer.
   *
   * The failures worth retrying are structural and stochastic: a top-level
   * array instead of an object, one required key missed, a list left short.
   * Groq's strict mode validates *after* generating, so these surface as an
   * HTTP 400 on an answer that was otherwise good, and the same question asked
   * again - with the breach named - usually lands.
   *
   * This is a second attempt, not a repair. The analysis is regenerated from
   * the briefing; no part of the rejected answer is kept, patched or merged, so
   * "validate, never repair" still holds. Nothing else is retried: a rate
   * limit, a timeout, a rejected credential or an unreachable API are not
   * improved by asking again, and the SDK's own retries stay off so a rate
   * limit is still reported to the caller rather than absorbed.
   *
   * `MODEL_MAX_ATTEMPTS=1` turns it off, which is the right setting on an
   * account whose per-minute token budget cannot fit two analyses.
   */
  async analyzeICP(input: IcpModelInput): Promise<IcpAnalysisModelResult> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const attempts = Math.max(1, this.options.maxAttempts);

    /** The first malformed answer: the diagnosis worth reporting if all fail. */
    let firstAnswerFailure: ModelProviderError | undefined;
    /** The most recent one: what the next attempt is told to avoid. */
    let lastAnswerFailure: ModelProviderError | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const output = await this.chatForStructuredOutput(
          ICP_ANALYSIS_SYSTEM_PROMPT,
          buildIcpAnalysisUserPrompt(
            input,
            lastAnswerFailure ? buildAnalysisCorrection(lastAnswerFailure.details) : undefined,
          ),
          icpAnalysisOutputSchema,
          icpAnalysisOutputJsonSchema,
        );

        return {
          requestId,
          provider: GROQ_MODEL_PROVIDER_ID,
          model: this.options.model,
          promptVersion: this.options.promptVersion,
          output,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        // Anything that is not a malformed answer ends the attempt loop. If our
        // own retry is what hit the rate limit, the malformed answer that
        // provoked it is the more useful thing to report - a 429 caused by
        // retrying would send an operator after the wrong problem.
        if (!isMalformedAnswer(error)) throw firstAnswerFailure ?? error;

        firstAnswerFailure ??= error;
        lastAnswerFailure = error;
        if (attempt === attempts) throw firstAnswerFailure;
      }
    }

    // Unreachable: the loop either returns or throws on its last attempt.
    throw firstAnswerFailure ?? new ModelInvalidResponseError('The analysis produced no answer');
  }

  /**
   * Generic structured call. `outputContract` must be a Zod schema - the port
   * types it as `unknown` so it can stay vendor-neutral, and this adapter is
   * where that gets pinned down.
   */
  async generateStructured<TOutput, TSchema = unknown>(
    request: StructuredModelRequest<TSchema>,
  ): Promise<StructuredModelResponse<TOutput>> {
    const contract = request.outputContract;
    if (!(contract instanceof z.ZodType)) {
      throw new ModelInvalidResponseError(
        'GroqModelProvider requires a Zod schema as the output contract',
      );
    }

    const output = (await this.chatForStructuredOutput(
      GENERIC_SYSTEM_PROMPT,
      JSON.stringify(request.input, null, 2),
      contract as z.ZodType<TOutput, z.ZodTypeDef, unknown>,
      // No JSON Schema: only ICP analysis has a precomputed one, so this path
      // falls back to plain JSON mode and relies on the Zod parse.
      undefined,
    )) as TOutput;

    return {
      requestId: request.requestId,
      modelId: GROQ_MODEL_PROVIDER_ID,
      modelVersion: this.options.model,
      output,
      // The model reports no calibrated confidence, so none is claimed.
      // Inventing one would hand the deterministic scorer a number to trust.
      confidence: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Groq transport
  // -------------------------------------------------------------------------

  private isConfigured(): boolean {
    return this.options.apiKey.length > 0;
  }

  /**
   * The SDK client, built once.
   *
   * `maxRetries: 0` on purpose: the SDK retries 429s and 5xxs by default, which
   * would make the real wall-clock budget `timeout x (retries + 1)` and hide a
   * rate limit the caller is entitled to see. One call, one budget, one error.
   */
  private requireClient(): Groq {
    if (!this.isConfigured()) {
      throw new ModelProviderNotConfiguredError('ICP_ANALYSIS', MISSING_KEY_DETAIL);
    }

    this.client ??= new Groq({
      apiKey: this.options.apiKey,
      baseURL: toSdkBaseUrl(this.options.baseUrl),
      timeout: this.options.timeoutMs,
      maxRetries: 0,
      ...(this.options.fetchImpl ? { fetch: this.options.fetchImpl } : {}),
    });
    return this.client;
  }

  /** Health copy for a failed probe. Never a raw stack trace. */
  private describeUnhealthy(error: unknown): string {
    try {
      toModelError(error, this.options.model, this.options.timeoutMs);
    } catch (mapped) {
      if (mapped instanceof ModelProviderNotConfiguredError) {
        return mapped.reason ?? mapped.message;
      }
      if (mapped instanceof ModelTimeoutError) {
        return 'The Groq API did not respond in time.';
      }
      if (isModelProviderError(mapped)) return mapped.message;
    }
    return 'The Groq API could not be reached.';
  }

  private async chatForStructuredOutput<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    jsonSchema: Record<string, unknown> | undefined,
  ): Promise<T> {
    const client = this.requireClient();

    try {
      const effort = this.options.reasoningEffort;

      const completion = await client.chat.completions.create({
        model: this.options.model,
        /**
         * Sent only when configured, because the accepted values are
         * model-specific and an unsupported one is a hard 400.
         *
         * This is the single most important line in the request. Left at the
         * model's default, a `gpt-oss` model spends its completion budget on
         * reasoning and then closes the analysis object early, which Groq
         * rejects with `json_validate_failed`.
         */
        ...(effort ? { reasoning_effort: effort } : {}),
        /**
         * The room the analysis has to finish in.
         *
         * Reasoning tokens are drawn from the same budget as the answer, so an
         * unset cap plus a twelve-section contract is how a run ends as
         * `json_validate_failed` on a model that was doing nothing wrong.
         */
        max_completion_tokens: this.options.maxOutputTokens,
        // Structured Outputs and streaming are mutually exclusive on Groq, and
        // a hosted call answers in seconds, so streaming buys nothing here.
        stream: false,
        temperature: 0.2,
        response_format: jsonSchema
          ? {
              type: 'json_schema',
              json_schema: {
                name: RESPONSE_FORMAT_NAME,
                strict: true,
                schema: toDecodingConstraint(jsonSchema) as Record<string, unknown>,
              },
            }
          : { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const choice = completion.choices[0];
      if (choice?.finish_reason === 'length') {
        // Truncated mid-object: the text would fail to parse anyway, but saying
        // why is the difference between a fixable and a mysterious failure.
        throw new ModelInvalidResponseError(
          'The model response was truncated before the JSON was complete',
        );
      }

      return parseStructuredOutput(choice?.message?.content ?? '', schema);
    } catch (error) {
      toModelError(error, this.options.model, this.options.timeoutMs);
    }
  }
}
