import {
  DiscoveryProviderNotConfiguredError,
  DiscoveryRateLimitError,
  DiscoveryStrategyUnsupportedError,
  isDiscoveryProviderError,
  type ApiErrorCode,
} from '@pursuit/shared';
import { AppError } from '../../shared/errors.js';

/**
 * Translates a discovery provider failure into the API's error vocabulary.
 *
 * The same three rules the model mapping follows, for the same reasons:
 *
 *  - the *code* is stable and machine-readable, so a client can say "wait and
 *    retry" rather than showing a transport error;
 *  - the *message* is our own copy, not the provider's words. A raw provider
 *    message could carry a URL, a filter or an internal id, and it stays in the
 *    server log. The one exception is a named configuration problem, which is
 *    only fixable if it is named;
 *  - the copy is provider-neutral. Which data provider answers is a backend
 *    concern; nothing here tells a user to go and configure Apollo.
 *
 * `MESSAGES` is typed over the codes the *discovery path* can produce, so it is
 * exhaustive over what it owns and is not broken by an unrelated error code
 * being added to the API vocabulary.
 */
type DiscoveryApiErrorCode = (typeof CODE_MAP)[keyof typeof CODE_MAP] | 'INTERNAL_ERROR';

const MESSAGES: Readonly<Record<DiscoveryApiErrorCode, string>> = {
  INTERNAL_ERROR: 'An unexpected error occurred',
  // Asking for an unimplemented strategy is the caller's mistake, and the error
  // that carries this code replaces the copy with the specific strategy names.
  BAD_REQUEST: 'The discovery request is invalid',
  DISCOVERY_PROVIDER_UNAVAILABLE:
    'Prospect discovery is unavailable. The company data provider could not be reached.',
  DISCOVERY_PROVIDER_RATE_LIMITED:
    'Prospect discovery is rate limited. The provider quota is exhausted for now; wait a moment and run discovery again.',
  DISCOVERY_PROVIDER_TIMEOUT: 'The company data provider did not respond in time.',
  DISCOVERY_PROVIDER_INVALID_RESPONSE:
    'The company data provider returned a response that could not be read.',
};

/** Discovery error code -> API error code. */
const CODE_MAP = {
  // "Not configured" and "not reachable" are the same thing to a caller: no
  // provider answered. The message tells the two apart.
  DISCOVERY_PROVIDER_NOT_CONFIGURED: 'DISCOVERY_PROVIDER_UNAVAILABLE',
  DISCOVERY_PROVIDER_UNAVAILABLE: 'DISCOVERY_PROVIDER_UNAVAILABLE',
  // A rejected credential is reported as unavailability with a named reason,
  // not as a 401 on *our* API: the caller is authenticated, our upstream is not.
  DISCOVERY_PROVIDER_AUTHENTICATION_FAILED: 'DISCOVERY_PROVIDER_UNAVAILABLE',
  DISCOVERY_PROVIDER_RATE_LIMITED: 'DISCOVERY_PROVIDER_RATE_LIMITED',
  DISCOVERY_PROVIDER_TIMEOUT: 'DISCOVERY_PROVIDER_TIMEOUT',
  DISCOVERY_PROVIDER_INVALID_RESPONSE: 'DISCOVERY_PROVIDER_INVALID_RESPONSE',
  // Asking for a strategy that does not exist is a bad request, not an outage.
  DISCOVERY_STRATEGY_UNSUPPORTED: 'BAD_REQUEST',
} as const satisfies Record<string, ApiErrorCode>;

export function apiErrorCodeForDiscoveryError(error: unknown): DiscoveryApiErrorCode {
  if (!isDiscoveryProviderError(error)) return 'INTERNAL_ERROR';
  return CODE_MAP[error.code];
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (!isDiscoveryProviderError(error)) {
    return AppError.internal('An unexpected error occurred');
  }

  const code = apiErrorCodeForDiscoveryError(error);

  if (error instanceof DiscoveryStrategyUnsupportedError) {
    // The one case where the provider's own message is the right answer: it
    // names which strategies the caller asked for and which exist, and a client
    // cannot correct the request without that.
    return new AppError(code, error.message, [
      { path: 'strategies', message: error.message, code: error.code },
    ]);
  }

  if (error instanceof DiscoveryProviderNotConfiguredError) {
    // A configuration mistake is the one failure the operator can fix, so the
    // provider's own wording is forwarded when it named the missing setting.
    // `reason` is contractually free of secrets and request data.
    return new AppError(
      code,
      error.reason ??
        'No discovery provider is configured. Set DISCOVERY_PROVIDER to a configured provider.',
      error.details,
    );
  }

  if (error.code === 'DISCOVERY_PROVIDER_AUTHENTICATION_FAILED') {
    // Named on purpose. A rejected or out-of-scope API key looks exactly like
    // an outage from the outside, and the repair - rotate the key, or widen its
    // scope - is only findable if the difference is stated.
    return new AppError(
      code,
      'Prospect discovery is unavailable. The company data provider rejected the configured API credential; check the key and the endpoints its scope allows.',
      error.details,
    );
  }

  if (error instanceof DiscoveryRateLimitError && error.retryAfterSeconds !== undefined) {
    return new AppError(
      code,
      `${MESSAGES.DISCOVERY_PROVIDER_RATE_LIMITED} Retry after about ${String(error.retryAfterSeconds)}s.`,
      error.details,
    );
  }

  return new AppError(code, MESSAGES[code], error.details);
}

/** Diagnostic message for the server log; never sent to a client. */
export function describeErrorForLog(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
