import { describe, expect, it, vi } from 'vitest';
import {
  ModelInvalidResponseError,
  ModelOutputValidationError,
  ModelProviderNotConfiguredError,
  ModelProviderUnavailableError,
  ModelRateLimitedError,
  ModelTimeoutError,
  buildIcpModelInput,
  createExampleIcpConfig,
} from '@pursuit/shared';
import {
  GroqModelProvider,
  diagnoseFailedGeneration,
  jsonValidateFailedDetails,
  toSdkBaseUrl,
} from '../src/modules/model/groq-model-provider.js';
import { validAnalysisOutput } from './analysis-fixtures.js';

const ICP_ID = '11111111-1111-4111-8111-111111111111';
const MODEL = 'openai/gpt-oss-20b';
const BASE_URL = 'https://api.groq.com/openai/v1';
const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS_URL = 'https://api.groq.com/openai/v1/models';

function modelInput() {
  return buildIcpModelInput({ icpId: ICP_ID, icpVersion: 1, config: createExampleIcpConfig() });
}

function provider(
  fetchImpl: typeof fetch,
  overrides: {
    apiKey?: string;
    baseUrl?: string;
    timeoutMs?: number;
    maxOutputTokens?: number;
    maxAttempts?: number;
    reasoningEffort?: 'none' | 'default' | 'low' | 'medium' | 'high' | '';
  } = {},
) {
  return new GroqModelProvider({
    apiKey: overrides.apiKey ?? 'gsk-test-key',
    baseUrl: overrides.baseUrl ?? BASE_URL,
    model: MODEL,
    reasoningEffort: overrides.reasoningEffort ?? 'low',
    timeoutMs: overrides.timeoutMs ?? 5000,
    maxOutputTokens: overrides.maxOutputTokens ?? 8192,
    // One attempt by default, so a test asserting a failure asserts exactly one
    // call. The retry has its own tests, which opt in.
    maxAttempts: overrides.maxAttempts ?? 1,
    promptVersion: 'v3',
    fetchImpl,
  });
}

/**
 * Groq answers a chat completion with a single JSON body - Structured Outputs
 * and streaming are mutually exclusive, so there is no stream to reassemble.
 */
function chatResponse(content: string, finishReason = 'stop'): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      model: MODEL,
      choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** The account's model list, as `GET /openai/v1/models` returns it. */
function modelListResponse(ids: string[] = [MODEL]): Response {
  return new Response(
    JSON.stringify({
      object: 'list',
      data: ids.map((id) => ({ id, object: 'model', created: 0, owned_by: 'groq' })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** An HTTP failure shaped the way Groq sends one. */
function errorResponse(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface GroqChatBody {
  model: string;
  stream: boolean;
  temperature: number;
  reasoning_effort?: string;
  max_completion_tokens?: number;
  response_format: {
    type: string;
    json_schema?: { name: string; strict: boolean; schema: Record<string, unknown> };
  };
  messages: { role: string; content: string }[];
}

/** The JSON body the provider posted, as Groq would receive it. */
function postedBody(fetchMock: { mock: { calls: unknown[][] } }, call = 0): GroqChatBody {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse((init?.body as string | undefined) ?? '{}') as GroqChatBody;
}

/** The user turn the provider sent: the ICP briefing. */
function userMessage(fetchMock: { mock: { calls: unknown[][] } }, call = 0): string {
  return (
    postedBody(fetchMock, call).messages.find((message) => message.role === 'user')?.content ?? ''
  );
}

function requestedUrls(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

/** A rejection that a spec-compliant fetch produces when the signal aborts. */
function abortRejection(): Promise<never> {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return Promise.reject(error);
}

describe('toSdkBaseUrl', () => {
  /**
   * `GROQ_BASE_URL` is documented as the OpenAI-compatible base because that is
   * the value operators recognise, while the SDK builds its own `/openai/v1`
   * paths. Both forms have to land on the same request.
   */
  it('accepts the OpenAI-compatible base and the host root alike', () => {
    expect(toSdkBaseUrl('https://api.groq.com/openai/v1')).toBe('https://api.groq.com');
    expect(toSdkBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com');
    expect(toSdkBaseUrl('https://api.groq.com')).toBe('https://api.groq.com');
    expect(toSdkBaseUrl('https://proxy.internal:8443/groq/openai/v1')).toBe(
      'https://proxy.internal:8443/groq',
    );
  });
});

describe('GroqModelProvider - construction and capabilities', () => {
  it('describes the configured model', () => {
    const descriptor = provider(vi.fn()).describe();
    expect(descriptor).toMatchObject({ id: 'groq', version: MODEL, available: true });
    expect(descriptor.displayName).toContain(MODEL);
  });

  it('advertises the ICP analysis capability', () => {
    expect(provider(vi.fn()).supports('ICP_ANALYSIS')).toBe(true);
    expect(provider(vi.fn()).supports('SIMILARITY')).toBe(false);
  });

  it('reports itself unavailable when no API key is configured', () => {
    expect(provider(vi.fn(), { apiKey: '' }).describe().available).toBe(false);
  });

  it('does not hardcode the endpoint; the configured base URL is used', async () => {
    const fetchMock = vi.fn().mockResolvedValue(modelListResponse());

    await provider(fetchMock, { baseUrl: 'https://groq.proxy.internal/openai/v1' }).healthCheck();

    expect(requestedUrls(fetchMock)[0]).toBe('https://groq.proxy.internal/openai/v1/models');
  });
});

describe('GroqModelProvider.healthCheck', () => {
  it('reports available when Groq serves the configured model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(modelListResponse());

    const health = await provider(fetchMock).healthCheck();

    expect(health).toMatchObject({ available: true, provider: 'groq', model: MODEL });
    expect(health.detail).toContain(MODEL);
  });

  /** A health check must not spend tokens to answer. */
  it('probes the model list rather than generating anything', async () => {
    const fetchMock = vi.fn().mockResolvedValue(modelListResponse());

    await provider(fetchMock).healthCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrls(fetchMock)[0]).toBe(MODELS_URL);
    expect(requestedUrls(fetchMock)).not.toContain(CHAT_URL);
  });

  it('names the missing setting, without calling Groq, when the key is absent', async () => {
    const fetchMock = vi.fn();

    const health = await provider(fetchMock, { apiKey: '' }).healthCheck();

    expect(health.available).toBe(false);
    expect(health.detail).toContain('GROQ_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unavailable, naming the key, when Groq rejects the credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, 'Invalid API Key'));

    const health = await provider(fetchMock).healthCheck();

    expect(health.available).toBe(false);
    expect(health.detail).toContain('GROQ_API_KEY');
  });

  it('reports unavailable, naming GROQ_MODEL, when the account is not served that model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(modelListResponse(['llama-3.3-70b-versatile']));

    const health = await provider(fetchMock).healthCheck();

    expect(health.available).toBe(false);
    expect(health.detail).toContain(MODEL);
    expect(health.detail).toContain('GROQ_MODEL');
  });

  it('reports unavailable rather than throwing when Groq cannot be reached', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const health = await provider(fetchMock).healthCheck();

    expect(health.available).toBe(false);
    expect(health.detail).toContain('Groq');
  });

  it('reports unavailable when the probe times out', async () => {
    const fetchMock = vi.fn().mockImplementation(abortRejection);

    const health = await provider(fetchMock).healthCheck();

    expect(health.available).toBe(false);
    expect(health.detail).toContain('did not respond in time');
  });
});

describe('GroqModelProvider.analyzeICP - happy path', () => {
  it('returns the validated output stamped with provider, model and prompt version', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    const result = await provider(fetchMock).analyzeICP(modelInput());

    expect(result).toMatchObject({ provider: 'groq', model: MODEL, promptVersion: 'v3' });
    expect(result.output.icpInterpretation.targetProfile).toContain('mid-market');
    expect(result.output.discoveryStrategy.recommendedSequence.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('calls Groq chat completions with the configured model', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock).analyzeICP(modelInput());

    expect(requestedUrls(fetchMock)[0]).toBe(CHAT_URL);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(postedBody(fetchMock).model).toBe(MODEL);
  });

  it('asks for schema-constrained JSON rather than trusting prose', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock).analyzeICP(modelInput());

    const format = postedBody(fetchMock).response_format;
    expect(format.type).toBe('json_schema');
    expect(format.json_schema?.strict).toBe(true);
    // The sections a model is most likely to drop by running out of room are
    // the last ones, which are also the ones discovery actually consumes.
    expect(format.json_schema?.schema.required).toContain('evidenceStrategy');
    expect(format.json_schema?.schema.required).toContain('opportunityHypotheses');
    // Kept, though it makes Groq stricter than the Zod contract: strict mode
    // requires it, and without it Groq rejects the schema outright.
    expect(format.json_schema?.schema.additionalProperties).toBe(false);
  });

  /**
   * Explicit, not left to the provider default: a twelve-section analysis plus
   * reasoning tokens is enough output that running out mid-object is a real
   * failure mode, and Groq reports it as a schema violation rather than as a
   * truncation.
   */
  it('sends an explicit completion budget', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock, { maxOutputTokens: 12000 }).analyzeICP(modelInput());

    expect(postedBody(fetchMock).max_completion_tokens).toBe(12000);
  });

  /**
   * Not a style preference: string length bounds are outside Groq's strict
   * Structured Outputs subset and make it reject the whole schema with a 400.
   * They stay in the Zod contract, which is what actually gates persistence.
   */
  it('strips the schema keywords strict mode cannot compile', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock).analyzeICP(modelInput());

    const schema = JSON.stringify(postedBody(fetchMock).response_format.json_schema?.schema);
    expect(schema).not.toContain('minLength');
    expect(schema).not.toContain('maxLength');
    expect(schema).not.toContain('$schema');
    // The keywords strict mode does support are kept, so the ranges are
    // enforced while decoding instead of failing validation afterwards.
    expect(schema).toContain('maxItems');
    expect(schema).toContain('minimum');
  });

  /**
   * The single most important parameter in the request. Left at the model's own
   * default, `gpt-oss-20b` spends its completion budget on reasoning tokens and
   * closes the analysis object before the last dimensions, which Groq rejects.
   */
  it('sends the configured reasoning effort', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock).analyzeICP(modelInput());

    expect(postedBody(fetchMock).reasoning_effort).toBe('low');
  });

  /**
   * The accepted values are model-specific, and a model that takes none of them
   * rejects the parameter outright - so an empty setting has to omit the key
   * rather than send an empty value.
   */
  it('omits reasoning effort entirely when it is not configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock, { reasoningEffort: '' }).analyzeICP(modelInput());

    expect('reasoning_effort' in postedBody(fetchMock)).toBe(false);
  });

  /** Structured Outputs and streaming are mutually exclusive on Groq. */
  it('does not stream', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock).analyzeICP(modelInput());

    expect(postedBody(fetchMock).stream).toBe(false);
  });

  it('sends the whole ICP, not a hand-picked subset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock).analyzeICP(modelInput());

    const userTurn = userMessage(fetchMock);
    // Every section of the configuration reaches the model, because the
    // analysis is judged on reasoning across them.
    for (const heading of [
      'COMMERCIAL INTENT',
      'TARGET GEOGRAPHY',
      'COMPANY PROFILE',
      'TECHNOLOGY ENVIRONMENT',
      'SERVICES OFFERED TO THIS ICP',
      'BUSINESS PROBLEMS THIS ICP IS SELECTED FOR',
      'HARD FILTERS AND SCORING RULES',
      'CONFIGURED INTENT TRIGGERS',
      'TARGET BUYER',
      'EVIDENCE AND DISCOVERY CONSTRAINTS',
    ]) {
      expect(userTurn).toContain(heading);
    }
  });

  /**
   * The input-side half of the v3 change, and the one that fixed the enum
   * echoing: handed `"requiredTechnologies": ["NODEJS"]`, the model's most
   * defensible answer was that NODEJS is required. It now receives the words.
   */
  it('sends the ICP as a decoded briefing rather than as raw JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock).analyzeICP(modelInput());

    const userTurn = userMessage(fetchMock);
    expect(userTurn).toContain('Legacy ERP');
    expect(userTurn).toContain('Platform modernization');
    expect(userTurn).toContain('Netherlands');

    expect(userTurn).not.toContain('LEGACY_ERP');
    expect(userTurn).not.toContain('PLATFORM_MODERNIZATION');
    // The field names themselves are gone too - a model that can see
    // `requiredTechnologies` can cite it as a rationale.
    expect(userTurn).not.toContain('requiredTechnologies');
    expect(userTurn).not.toContain('mustNiceExclude');
  });

  /** The one code vocabulary the output contract needs answered verbatim. */
  it('names the allowed evidence source codes, which the output schema requires back', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock).analyzeICP(modelInput());

    expect(userMessage(fetchMock)).toContain('JOB_POSTING');
  });

  it('tells the model its job is intelligence, not restatement', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock).analyzeICP(modelInput());

    const systemTurn =
      postedBody(fetchMock).messages.find((message) => message.role === 'system')?.content ?? '';
    expect(systemTurn).toContain('NOT to repeat, restate or summarize');
    expect(systemTurn).toContain('REASON ACROSS FIELDS');
  });

  /**
   * The migration's regression guard: the active path must not reach a local
   * runtime, whatever is installed on the machine running this.
   */
  it('talks only to the configured Groq host, never to a local runtime', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));

    const listing = vi.fn().mockResolvedValue(modelListResponse());

    await provider(fetchMock).analyzeICP(modelInput());
    await provider(listing).healthCheck();

    for (const url of [...requestedUrls(fetchMock), ...requestedUrls(listing)]) {
      expect(url.startsWith('https://api.groq.com/')).toBe(true);
      expect(url).not.toContain('11434');
      expect(url).not.toContain('localhost');
      expect(url).not.toContain('127.0.0.1');
    }
  });

  it('recovers a fenced answer, in case the format constraint is ignored', async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validAnalysisOutput())}\n\`\`\``;
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(fenced));

    const result = await provider(fetchMock).analyzeICP(modelInput());

    expect(result.output.painHypotheses).toHaveLength(2);
  });

  it('strips a leaked reasoning block', async () => {
    const leaked = `<think>Let me consider the ICP.</think>${JSON.stringify(validAnalysisOutput())}`;
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(leaked));

    const result = await provider(fetchMock).analyzeICP(modelInput());

    expect(result.output.icpInterpretation.targetProfile).toContain('mid-market');
  });
});

describe('GroqModelProvider.analyzeICP - failures', () => {
  it('reports a missing API key as a named configuration error, without calling Groq', async () => {
    const fetchMock = vi.fn();

    const failure = provider(fetchMock, { apiKey: '' }).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelProviderNotConfiguredError);
    await failure.catch((error: ModelProviderNotConfiguredError) => {
      expect(error.reason).toContain('GROQ_API_KEY');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a rejected credential (401) onto a named configuration error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, 'Invalid API Key'));

    const failure = provider(fetchMock).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelProviderNotConfiguredError);
    await failure.catch((error: ModelProviderNotConfiguredError) => {
      expect(error.reason).toContain('GROQ_API_KEY');
      // Nothing that could carry the credential itself.
      expect(error.reason).not.toContain('gsk-test-key');
    });
  });

  it('maps a forbidden credential (403) onto a configuration error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(403, 'forbidden'));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelProviderNotConfiguredError,
    );
  });

  it('maps a rate limit (429) onto MODEL_RATE_LIMITED and carries the retry hint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errorResponse(429, 'rate limit exceeded', { 'retry-after': '7.5' }));

    const failure = provider(fetchMock).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelRateLimitedError);
    await failure.catch((error: ModelRateLimitedError) => {
      expect(error.code).toBe('MODEL_RATE_LIMITED');
      expect(error.retryAfterSeconds).toBe(8);
    });
  });

  /**
   * The SDK retries 429s and 5xxs by default, which would turn one analysis
   * budget into several and hide the rate limit from the caller.
   */
  it('does not retry, so one analysis is one call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(429, 'rate limit exceeded'));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelRateLimitedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps a missing model (404) onto MODEL_PROVIDER_UNAVAILABLE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404, 'model does not exist'));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelProviderUnavailableError,
    );
  });

  it('maps a Groq outage (500) onto MODEL_PROVIDER_UNAVAILABLE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(500, 'internal server error'));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelProviderUnavailableError,
    );
  });

  it('maps an unreachable API onto MODEL_PROVIDER_UNAVAILABLE', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelProviderUnavailableError,
    );
  });

  it('maps an aborted call onto MODEL_TIMEOUT and reports the budget', async () => {
    const fetchMock = vi.fn().mockImplementation(abortRejection);

    const failure = provider(fetchMock, { timeoutMs: 1234 }).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelTimeoutError);
    await failure.catch((error: ModelTimeoutError) => {
      expect(error.timeoutMs).toBe(1234);
    });
  });

  /**
   * Groq's strict mode validates *after* generating rather than constraining the
   * decoder, so a `json_validate_failed` 400 is the model missing the contract,
   * not a malformed request. Reporting it as the latter points an operator at
   * the wrong thing entirely.
   */
  it('maps json_validate_failed onto MODEL_OUTPUT_VALIDATION_FAILED', async () => {
    const groqBody = {
      error: {
        message:
          'Generated JSON does not match the expected schema. Error: missing properties: evidenceStrategy',
        type: 'invalid_request_error',
        code: 'json_validate_failed',
        failed_generation: '{"icpInterpretation":{}}',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(groqBody), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const failure = provider(fetchMock).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelOutputValidationError);
    await failure.catch((error: ModelOutputValidationError) => {
      expect(error.code).toBe('MODEL_OUTPUT_VALIDATION_FAILED');
      expect(error.message).toContain('did not satisfy the analysis schema');
    });
  });

  /**
   * Groq names the breached constraint in its 400, and the API layer replaces
   * the message before it reaches a client - so without lifting it into
   * `details`, a caller sees MODEL_OUTPUT_VALIDATION_FAILED with an empty
   * `details` array and no way to tell a truncated answer from one thin list.
   */
  it('reports which field breached which constraint', async () => {
    const groqBody = {
      error: {
        message:
          "Generated JSON does not match the expected schema. Error: jsonschema: '/fitModel/strongFit' does not validate with /properties/fitModel/properties/strongFit/minItems: minimum 2 items required, but found 1 items",
        type: 'invalid_request_error',
        code: 'json_validate_failed',
        failed_generation: '{"fitModel":{"strongFit":["one"]}}',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(groqBody), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const failure = provider(fetchMock).analyzeICP(modelInput());

    await failure.catch((error: ModelOutputValidationError) => {
      // Same `output.a.b` path shape the Zod path produces, so a client cannot
      // tell which of the two validators rejected the answer.
      expect(error.details).toEqual([
        {
          path: 'output.fitModel.strongFit',
          message: 'minimum 2 items required, but found 1 items',
          code: 'json_validate_failed',
        },
      ]);
    });
  });

  /**
   * Not every rejection carries a JSON pointer. An empty `details` is
   * indistinguishable from "no idea what went wrong", so a breach reported
   * without a pointer is still attributed - to the answer as a whole.
   */
  it('reports the breach even when Groq names no field', () => {
    expect(
      jsonValidateFailedDetails(
        "Generated JSON does not match the expected schema. Error: missing properties: 'evidenceStrategy'",
      ),
    ).toEqual([
      {
        path: 'output',
        message: "missing properties: 'evidenceStrategy'",
        code: 'json_validate_failed',
      },
    ]);
  });

  it('reports no detail rather than a guess when the body is not recognised', () => {
    expect(jsonValidateFailedDetails('something entirely different')).toEqual([]);
  });

  /**
   * Groq's least helpful rejection, and the common one in practice:
   *
   *   Failed to generate JSON. Please adjust your prompt. See 'failed_generation'
   *
   * It names nothing. But it returns the answer it rejected, and we hold the
   * contract it was judged against - so the diagnosis is recovered rather than
   * lost, from the same Zod schema the normal path uses.
   */
  it('diagnoses the rejected answer itself when Groq names no constraint', async () => {
    const { evidenceStrategy: _dropped, ...incomplete } = validAnalysisOutput();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
            type: 'invalid_request_error',
            code: 'json_validate_failed',
            failed_generation: JSON.stringify(incomplete),
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );

    const failure = provider(fetchMock).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelOutputValidationError);
    await failure.catch((error: ModelOutputValidationError) => {
      expect(error.details.map((detail) => detail.path)).toContain('output.evidenceStrategy');
    });
  });

  /** The rejected answer explains the failure; it is never used as a result. */
  it('finds the offending field in a rejected answer', () => {
    const { fitModel, ...rest } = validAnalysisOutput();
    const details = diagnoseFailedGeneration(
      JSON.stringify({ ...rest, fitModel: { ...fitModel, strongFit: ['only one'] } }),
    );

    expect(details.map((detail) => detail.path)).toContain('output.fitModel.strongFit');
  });

  it('reports a top-level array as the breach it is', () => {
    const details = diagnoseFailedGeneration(JSON.stringify([validAnalysisOutput()]));

    expect(details.length).toBeGreaterThan(0);
    expect(details[0]?.path).toBe('output');
  });

  it('says so when the rejected answer was not JSON at all', () => {
    expect(diagnoseFailedGeneration('I am afraid I cannot do that')).toEqual([
      {
        path: 'output',
        message: 'The model did not return parsable JSON',
        code: 'json_validate_failed',
      },
    ]);
  });

  it('offers no diagnosis when there is nothing to diagnose', () => {
    expect(diagnoseFailedGeneration('')).toEqual([]);
    // Groq rejected it, but the contract does not - nothing honest to say.
    expect(diagnoseFailedGeneration(JSON.stringify(validAnalysisOutput()))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The bounded second attempt
// ---------------------------------------------------------------------------

/**
 * Groq's strict mode validates *after* generating, so a structurally malformed
 * answer - a top-level array, a dropped key, one list left short - arrives as a
 * 400 on work that was otherwise good. Asking again, with the breach named, is
 * worth one attempt.
 */
describe('GroqModelProvider.analyzeICP - retrying a malformed answer', () => {
  /** A `json_validate_failed` 400, shaped the way Groq sends one. */
  function validateFailedResponse(constraint: string): Response {
    return new Response(
      JSON.stringify({
        error: {
          message: `Generated JSON does not match the expected schema. Error: ${constraint}`,
          type: 'invalid_request_error',
          code: 'json_validate_failed',
          failed_generation: '[{"icpInterpretation":{}}]',
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const ROOT_ARRAY = "jsonschema: '' does not validate with /type: expected object, but got array";

  it('asks again and succeeds, so a one-off malformed answer is not a failed analysis', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validateFailedResponse(ROOT_ARRAY))
      .mockResolvedValueOnce(chatResponse(JSON.stringify(validAnalysisOutput())));

    const result = await provider(fetchMock, { maxAttempts: 2 }).analyzeICP(modelInput());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.output.icpInterpretation.targetProfile).toContain('mid-market');
  });

  /**
   * The retry is only worth making if the model is told what went wrong: at low
   * temperature, the same question tends to produce the same structural
   * mistake.
   */
  it('names the breach in the second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validateFailedResponse(ROOT_ARRAY))
      .mockResolvedValueOnce(chatResponse(JSON.stringify(validAnalysisOutput())));

    await provider(fetchMock, { maxAttempts: 2 }).analyzeICP(modelInput());

    const retry = userMessage(fetchMock, 1);
    expect(retry).toContain('was REJECTED');
    expect(retry).toContain('expected object, but got array');
    // Regenerated from the same briefing - a second attempt, not a patch.
    expect(retry).toContain('=== ICP BRIEFING ===');
    expect(userMessage(fetchMock, 0)).not.toContain('was REJECTED');
  });

  it('gives up after the configured number of attempts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(validateFailedResponse(ROOT_ARRAY));

    const failure = provider(fetchMock, { maxAttempts: 2 }).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelOutputValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('makes exactly one call when the retry is turned off', async () => {
    const fetchMock = vi.fn().mockResolvedValue(validateFailedResponse(ROOT_ARRAY));

    await expect(
      provider(fetchMock, { maxAttempts: 1 }).analyzeICP(modelInput()),
    ).rejects.toBeInstanceOf(ModelOutputValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Asking again does not fix a rate limit, a timeout or a rejected key, and
   * spending a second call on one would only delay the report.
   */
  it('does not retry a failure that is not an answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(429, 'slow down'));

    await expect(
      provider(fetchMock, { maxAttempts: 2 }).analyzeICP(modelInput()),
    ).rejects.toBeInstanceOf(ModelRateLimitedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The case that makes the retry safe on a token-constrained account: if the
   * second call is what exhausted the per-minute budget, the malformed answer
   * that provoked it is still what gets reported. Surfacing the 429 would send
   * an operator after a problem this provider created for itself.
   */
  it('reports the malformed answer, not a rate limit its own retry caused', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(validateFailedResponse(ROOT_ARRAY))
      .mockResolvedValueOnce(errorResponse(429, 'tokens per minute exceeded'));

    const failure = provider(fetchMock, { maxAttempts: 2 }).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelOutputValidationError);
    await failure.catch((error: ModelOutputValidationError) => {
      expect(error.details[0]?.path).toBe('output');
      expect(error.details[0]?.message).toContain('expected object, but got array');
    });
  });

  it('retries an unparsable answer too, not only a schema breach', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse('not json at all'))
      .mockResolvedValueOnce(chatResponse(JSON.stringify(validAnalysisOutput())));

    const result = await provider(fetchMock, { maxAttempts: 2 }).analyzeICP(modelInput());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.output.fitModel.strongFit.length).toBeGreaterThan(0);
  });

  it('reports a rejected request (400) rather than crashing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errorResponse(400, "Invalid schema: 'minLength' is not permitted"));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelInvalidResponseError,
    );
  });

  it('rejects an empty response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(''));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelInvalidResponseError,
    );
  });

  it('rejects prose instead of trying to parse it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('I think this ICP looks great!'));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelInvalidResponseError,
    );
  });

  it('rejects truncated JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('{"summary": "It was going wel'));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelInvalidResponseError,
    );
  });

  it('says so when the model ran out of output tokens mid-object', async () => {
    const truncated = JSON.stringify(validAnalysisOutput()).slice(0, 200);
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(truncated, 'length'));

    const failure = provider(fetchMock).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelInvalidResponseError);
    await failure.catch((error: ModelInvalidResponseError) => {
      expect(error.message).toContain('truncated');
    });
  });

  it('rejects well-formed JSON that does not match the analysis schema', async () => {
    const { evidenceStrategy: _dropped, ...incomplete } = validAnalysisOutput();
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(JSON.stringify(incomplete)));

    const failure = provider(fetchMock).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelOutputValidationError);
    await failure.catch((error: ModelOutputValidationError) => {
      expect(error.details.map((detail) => detail.path)).toContain('output.evidenceStrategy');
    });
  });

  it('rejects an unsupported enum value rather than coercing it', async () => {
    const output = {
      ...validAnalysisOutput(),
      painHypotheses: validAnalysisOutput().painHypotheses.map((pain) => ({
        ...pain,
        severity: 'URGENT',
      })),
    };
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(JSON.stringify(output)));

    await expect(provider(fetchMock).analyzeICP(modelInput())).rejects.toBeInstanceOf(
      ModelOutputValidationError,
    );
  });

  /**
   * The failure this contract exists to prevent, arriving as a well-formed
   * answer. A model that reverts to restating fields must produce a failed
   * analysis rather than a stored one that looks like intelligence.
   */
  it('rejects an answer that restates the ICP instead of interpreting it', async () => {
    const output = {
      ...validAnalysisOutput(),
      icpInterpretation: {
        targetProfile: 'Software & SaaS, IT services',
        primaryOpportunity: 'Platform modernization',
        buyingContext: 'Configured in the ICP',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(JSON.stringify(output)));

    const failure = provider(fetchMock).analyzeICP(modelInput());

    await expect(failure).rejects.toBeInstanceOf(ModelOutputValidationError);
    await failure.catch((error: ModelOutputValidationError) => {
      expect(error.details.map((detail) => detail.path)).toContain(
        'output.icpInterpretation.targetProfile',
      );
    });
  });
});
