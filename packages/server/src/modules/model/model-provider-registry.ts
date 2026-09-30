import { NullModelProvider, type ModelProvider, type ModelProviderDescriptor } from '@pursuit/shared';
import type { Env } from '../../config/env.js';
import { GroqModelProvider } from './groq-model-provider.js';

/**
 * Resolves the configured ModelProvider.
 *
 * The registry is the whole switching mechanism: adding a provider is one entry
 * here plus one class implementing the port. Nothing above this file mentions
 * Groq, so the API and the analysis service are unaware of which runtime is
 * answering.
 *
 * There are exactly two selectable providers, and neither falls back to the
 * other. `none` fails every model call loudly (plan Part B, B8) and `groq`
 * reports a Groq failure as a Groq failure - no silent second attempt behind
 * either of them.
 */
const providers: Record<Env['MODEL_PROVIDER'], (env: Env) => ModelProvider> = {
  none: () => new NullModelProvider(),
  groq: (env) =>
    new GroqModelProvider({
      apiKey: env.GROQ_API_KEY,
      baseUrl: env.GROQ_BASE_URL,
      model: env.GROQ_MODEL,
      reasoningEffort: env.GROQ_REASONING_EFFORT,
      timeoutMs: env.MODEL_TIMEOUT_MS,
      maxOutputTokens: env.MODEL_MAX_OUTPUT_TOKENS,
      maxAttempts: env.MODEL_MAX_ATTEMPTS,
      promptVersion: env.MODEL_PROMPT_VERSION,
    }),
};

export function resolveModelProvider(env: Env): ModelProvider {
  return providers[env.MODEL_PROVIDER](env);
}

export function describeModelProvider(env: Env): ModelProviderDescriptor {
  return resolveModelProvider(env).describe();
}
