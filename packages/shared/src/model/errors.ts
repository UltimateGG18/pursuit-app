import type { ApiErrorDetail } from '../api/response.js';

/**
 * Failures a `ModelProvider` implementation may raise.
 *
 * They live in the shared package rather than next to a concrete adapter
 * because they are part of the port's contract: every provider signals the
 * same conditions, and the API maps each onto exactly one error code without
 * knowing which adapter produced it.
 */
export type ModelErrorCode =
  | 'MODEL_PROVIDER_NOT_CONFIGURED'
  | 'MODEL_PROVIDER_UNAVAILABLE'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_TIMEOUT'
  | 'MODEL_INVALID_RESPONSE'
  | 'MODEL_OUTPUT_VALIDATION_FAILED';

export abstract class ModelProviderError extends Error {
  abstract readonly code: ModelErrorCode;
  /** Field-addressable diagnostics; empty unless the output failed validation. */
  readonly details: ApiErrorDetail[];

  protected constructor(message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

/**
 * The provider cannot run at all: none is wired up (`MODEL_PROVIDER=none`), or
 * the selected one is missing a credential it needs.
 *
 * `reason` is the operator-facing detail - "GROQ_API_KEY is not configured" -
 * and is the one provider-authored message the API is allowed to forward,
 * because a configuration mistake is only fixable if it is named. Implementations
 * must never put a secret, a header or a request body in it.
 */
export class ModelProviderNotConfiguredError extends ModelProviderError {
  readonly code = 'MODEL_PROVIDER_NOT_CONFIGURED';
  readonly reason: string | undefined;

  constructor(capability?: string, reason?: string) {
    super(
      capability
        ? `No model provider is configured; "${capability}" is unavailable.`
        : 'No model provider is configured.',
    );
    this.reason = reason;
  }
}

/**
 * The provider refused the call because the account's rate or token quota is
 * exhausted. Distinct from unavailability: nothing is broken and a later retry
 * is expected to succeed, which is advice worth giving the caller.
 */
export class ModelRateLimitedError extends ModelProviderError {
  readonly code = 'MODEL_RATE_LIMITED';
  /** Seconds the provider asked us to wait, when it said. */
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The provider is configured but could not be reached. */
export class ModelProviderUnavailableError extends ModelProviderError {
  readonly code = 'MODEL_PROVIDER_UNAVAILABLE';

  constructor(message: string) {
    super(message);
  }
}

/** The provider was reached but did not answer within the configured budget. */
export class ModelTimeoutError extends ModelProviderError {
  readonly code = 'MODEL_TIMEOUT';

  constructor(readonly timeoutMs: number) {
    super(`The model did not respond within ${timeoutMs}ms`);
  }
}

/** The provider answered, but the payload was not usable JSON. */
export class ModelInvalidResponseError extends ModelProviderError {
  readonly code = 'MODEL_INVALID_RESPONSE';

  constructor(message: string) {
    super(message);
  }
}

/** The payload parsed as JSON but did not satisfy the output schema. */
export class ModelOutputValidationError extends ModelProviderError {
  readonly code = 'MODEL_OUTPUT_VALIDATION_FAILED';

  constructor(message: string, details: ApiErrorDetail[] = []) {
    super(message, details);
  }
}

export function isModelProviderError(error: unknown): error is ModelProviderError {
  return error instanceof ModelProviderError;
}
