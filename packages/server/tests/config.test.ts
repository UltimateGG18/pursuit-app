import { describe, expect, it } from 'vitest';
import { ModelProviderNotConfiguredError, buildIcpModelInput, createExampleIcpConfig } from '@pursuit/shared';
import { corsOrigins, loadEnv, loadEnvOrThrow } from '../src/config/env.js';
import {
  describeModelProvider,
  resolveModelProvider,
} from '../src/modules/model/model-provider-registry.js';
import { GroqModelProvider } from '../src/modules/model/groq-model-provider.js';

const baseEnv = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' };
const groqEnv = { ...baseEnv, MODEL_PROVIDER: 'groq', GROQ_API_KEY: 'gsk-test-key' };

describe('environment configuration', () => {
  it('applies defaults', () => {
    const result = loadEnv(baseEnv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      // The system stays fully working with no model configured.
      MODEL_PROVIDER: 'none',
      GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
      // 120b, not 20b: Groq validates a structured answer after generating it,
      // and 20b emitted JSON that did not parse on half its runs against the
      // twelve-section contract. See `DEFAULT_GROQ_MODEL`.
      GROQ_MODEL: 'openai/gpt-oss-120b',
      MODEL_TIMEOUT_MS: 120000,
      MODEL_PROMPT_VERSION: 'v3',
      // A twelve-section analysis needs room; an unset cap is how a run ends
      // as `json_validate_failed` for want of output tokens.
      MODEL_MAX_OUTPUT_TOKENS: 8192,
      // Off by default: one analysis does not leave room for a second inside
      // the free tier's per-minute token budget.
      MODEL_MAX_ATTEMPTS: 1,
      // Load-bearing: the model drops sections at its own default effort.
      GROQ_REASONING_EFFORT: 'low',
    });
  });

  it('rejects a completion budget too small to hold an analysis', () => {
    expect(loadEnv({ ...groqEnv, MODEL_MAX_OUTPUT_TOKENS: '64' }).ok).toBe(false);
  });

  it('accepts an empty reasoning effort, so the parameter can be omitted', () => {
    const result = loadEnv({ ...groqEnv, GROQ_REASONING_EFFORT: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.GROQ_REASONING_EFFORT).toBe('');
  });

  it('rejects a reasoning effort Groq does not accept', () => {
    expect(loadEnv({ ...groqEnv, GROQ_REASONING_EFFORT: 'maximum' }).ok).toBe(false);
  });

  it('fails when DATABASE_URL is missing', () => {
    const result = loadEnv({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.messages.join(' ')).toContain('DATABASE_URL');
  });

  it('accepts the providers that have an implementation', () => {
    expect(loadEnv({ ...baseEnv, MODEL_PROVIDER: 'none' }).ok).toBe(true);
    expect(loadEnv({ ...baseEnv, MODEL_PROVIDER: 'groq' }).ok).toBe(true);
  });

  it('rejects a provider with no implementation behind it', () => {
    expect(loadEnv({ ...baseEnv, MODEL_PROVIDER: 'anthropic' }).ok).toBe(false);
  });

  /**
   * The whole point of the migration: there is no configuration that selects
   * local inference any more, so nothing can quietly go back to it.
   */
  it('rejects the retired local-inference provider', () => {
    expect(loadEnv({ ...baseEnv, MODEL_PROVIDER: 'ollama' }).ok).toBe(false);
  });

  it('rejects a GROQ_BASE_URL that is not a URL', () => {
    expect(loadEnv({ ...baseEnv, GROQ_BASE_URL: 'not a url' }).ok).toBe(false);
  });

  it('rejects an empty model override when Groq is selected', () => {
    const result = loadEnv({ ...groqEnv, GROQ_MODEL: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.messages.join(' ')).toContain('GROQ_MODEL');
  });

  /**
   * A missing key must not stop the API from booting: `/health` and
   * `/api/model/health` are how an operator finds out it is missing.
   */
  it('still boots with Groq selected and no API key', () => {
    const result = loadEnv({ ...baseEnv, MODEL_PROVIDER: 'groq' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.GROQ_API_KEY).toBe('');
  });

  it('throws a readable error for an invalid environment', () => {
    expect(() => loadEnvOrThrow({ ...baseEnv, PORT: 'not-a-port' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('splits the CORS origin list', () => {
    const env = loadEnvOrThrow({
      ...baseEnv,
      CORS_ORIGINS: 'http://localhost:5173, http://127.0.0.1:5173 ',
    });
    expect(corsOrigins(env)).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
  });
});

describe('model provider registry', () => {
  it('resolves the null provider and reports it unavailable when none is configured', () => {
    const env = loadEnvOrThrow(baseEnv);
    expect(describeModelProvider(env)).toMatchObject({ id: 'none', available: false });
  });

  it('rejects calls so no code path can silently depend on a model', async () => {
    const provider = resolveModelProvider(loadEnvOrThrow(baseEnv));
    const input = buildIcpModelInput({
      icpId: '11111111-1111-4111-8111-111111111111',
      icpVersion: 1,
      config: createExampleIcpConfig(),
    });

    await expect(provider.analyzeICP(input)).rejects.toBeInstanceOf(
      ModelProviderNotConfiguredError,
    );
  });

  it('resolves the Groq provider from configuration alone', () => {
    const env = loadEnvOrThrow({ ...groqEnv, GROQ_MODEL: 'openai/gpt-oss-120b' });

    const provider = resolveModelProvider(env);

    expect(provider).toBeInstanceOf(GroqModelProvider);
    // The configured model reaches the provider; nothing hardcodes a name.
    expect(describeModelProvider(env)).toMatchObject({
      id: 'groq',
      version: 'openai/gpt-oss-120b',
      available: true,
    });
  });

  it('reports the Groq provider unavailable when the key is missing', () => {
    const env = loadEnvOrThrow({ ...baseEnv, MODEL_PROVIDER: 'groq' });

    expect(describeModelProvider(env)).toMatchObject({ id: 'groq', available: false });
  });
});
