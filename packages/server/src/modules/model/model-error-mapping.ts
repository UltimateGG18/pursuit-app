import {
  ModelProviderNotConfiguredError,
  ModelRateLimitedError,
  isModelProviderError,
  type ApiErrorCode,
} from '@pursuit/shared';
import { AppError } from '../../shared/errors.js';

/**
 * Translates a provider failure into the API's error vocabulary.
 *
 * Three rules the frontend depends on:
 *  - the *code* is stable and machine-readable, so the UI can say "wait and
 *    retry" instead of showing a transport error;
 *  - the *message* never carries the provider's own words. Raw runtime errors
 *    stay in the server log. The single exception is a named configuration
 *    problem, which is only fixable if it is named;
 *  - the copy is provider-neutral. Which runtime answers is a backend concern,
 *    so nothing here tells a user to go and start something.
 *
 * `MESSAGES` is typed over the codes the *analysis path* can produce rather
 * than over every `ApiErrorCode`, so it stays exhaustive over what it is
 * responsible for. A record over the whole vocabulary made every new error code
 * elsewhere in the API a compile error here, and invited a placeholder message
 * for a failure this file has no opinion about.
 */
type ModelApiErrorCode =
  | (typeof CODE_MAP)[keyof typeof CODE_MAP]
  | 'INTERNAL_ERROR'
  | 'ANALYSIS_PERSISTENCE_FAILED';

const MESSAGES: Readonly<Record<ModelApiErrorCode, string>> = {
  INTERNAL_ERROR: 'An unexpected error occurred',
  MODEL_PROVIDER_UNAVAILABLE:
    'The analysis model is unavailable. The model provider could not be reached, or the configured model is not available to this account.',
  MODEL_RATE_LIMITED:
    'The analysis model is rate limited. The provider quota is exhausted for now; wait a moment and run the analysis again.',
  MODEL_TIMEOUT: 'The analysis model did not respond in time.',
  MODEL_INVALID_RESPONSE: 'The analysis model returned a response that could not be read.',
  MODEL_OUTPUT_VALIDATION_FAILED:
    'The analysis model returned a result that does not match the expected schema.',
  ANALYSIS_PERSISTENCE_FAILED: 'The analysis result could not be stored.',
};

/** Model error code -> API error code. */
const CODE_MAP = {
  // "Not configured" and "not reachable" are the same thing to a caller: no
  // model answered. The message tells the two apart.
  MODEL_PROVIDER_NOT_CONFIGURED: 'MODEL_PROVIDER_UNAVAILABLE',
  MODEL_PROVIDER_UNAVAILABLE: 'MODEL_PROVIDER_UNAVAILABLE',
  MODEL_RATE_LIMITED: 'MODEL_RATE_LIMITED',
  MODEL_TIMEOUT: 'MODEL_TIMEOUT',
  MODEL_INVALID_RESPONSE: 'MODEL_INVALID_RESPONSE',
  MODEL_OUTPUT_VALIDATION_FAILED: 'MODEL_OUTPUT_VALIDATION_FAILED',
} as const satisfies Record<string, ApiErrorCode>;

/**
 * Returns the narrow `ModelApiErrorCode` rather than the whole `ApiErrorCode`
 * union, because that is all this function can produce - and saying so is what
 * lets `MESSAGES` be indexed by it without a fallback for codes the analysis
 * path never reaches.
 */
export function apiErrorCodeForModelError(error: unknown): ModelApiErrorCode {
  if (!isModelProviderError(error)) return 'INTERNAL_ERROR';
  return CODE_MAP[error.code];
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const code = apiErrorCodeForModelError(error);
  const details = isModelProviderError(error) ? error.details : [];

  if (error instanceof ModelProviderNotConfiguredError) {
    // A configuration mistake is the one failure the operator can fix, so the
    // provider's own wording is forwarded when it named the missing setting.
    // `reason` is contractually free of secrets and request data.
    return new AppError(
      code,
      error.reason ??
        'No analysis model is configured. Set MODEL_PROVIDER to a configured provider.',
      details,
    );
  }

  if (error instanceof ModelRateLimitedError && error.retryAfterSeconds !== undefined) {
    return new AppError(
      code,
      `${MESSAGES.MODEL_RATE_LIMITED} Retry after about ${String(error.retryAfterSeconds)}s.`,
      details,
    );
  }

  return new AppError(code, MESSAGES[code], details);
}

/** Diagnostic message for the server log; never sent to a client. */
export function describeErrorForLog(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
