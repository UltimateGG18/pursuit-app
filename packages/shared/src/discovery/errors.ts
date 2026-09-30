import type { ApiErrorDetail } from '../api/response.js';

/**
 * Failures a discovery provider may raise.
 *
 * They live in the shared package for the same reason the model errors do:
 * they are part of the *port's* contract, not of one adapter. `DiscoveryService`
 * needs to understand "the provider is rate limited" without importing
 * anything named Apollo, and the API layer maps each code onto exactly one
 * response code without knowing which provider produced it.
 *
 * Concrete adapters subclass these - see `ApolloRateLimitError` and friends -
 * so a stack trace still names the provider that failed while the type the
 * domain catches stays neutral.
 *
 * Nothing here may carry a credential, a request header or a request body.
 * Messages reach the server log and, for a configuration mistake, the operator.
 */
export type DiscoveryErrorCode =
  | 'DISCOVERY_PROVIDER_NOT_CONFIGURED'
  | 'DISCOVERY_PROVIDER_AUTHENTICATION_FAILED'
  | 'DISCOVERY_PROVIDER_UNAVAILABLE'
  | 'DISCOVERY_PROVIDER_RATE_LIMITED'
  | 'DISCOVERY_PROVIDER_TIMEOUT'
  | 'DISCOVERY_PROVIDER_INVALID_RESPONSE'
  | 'DISCOVERY_STRATEGY_UNSUPPORTED';

export abstract class DiscoveryProviderError extends Error {
  abstract readonly code: DiscoveryErrorCode;
  /** Which provider failed, e.g. `apollo`. Never a URL or a credential. */
  readonly provider: string;
  /** Field-addressable diagnostics; empty unless a payload failed validation. */
  readonly details: ApiErrorDetail[];

  protected constructor(provider: string, message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = new.target.name;
    this.provider = provider;
    this.details = details;
  }
}

/**
 * No provider is selected, or the selected one is missing a credential.
 *
 * `reason` is the operator-facing detail - "APOLLO_API_KEY is not configured" -
 * and is the one provider-authored message the API forwards verbatim, because a
 * configuration mistake is only fixable if it is named.
 */
export class DiscoveryProviderNotConfiguredError extends DiscoveryProviderError {
  readonly code = 'DISCOVERY_PROVIDER_NOT_CONFIGURED';
  readonly reason: string | undefined;

  constructor(provider: string, reason?: string) {
    super(provider, reason ?? `No discovery provider is configured ("${provider}").`);
    this.reason = reason;
  }
}

/**
 * The provider rejected the credential we sent (401/403).
 *
 * Kept apart from "not configured": a key that is present but refused is a
 * different repair - rotate it, or widen its scope - and apologising for a
 * missing key would point the operator at the wrong thing.
 */
export class DiscoveryAuthenticationError extends DiscoveryProviderError {
  readonly code = 'DISCOVERY_PROVIDER_AUTHENTICATION_FAILED';

  constructor(provider: string, message: string) {
    super(provider, message);
  }
}

/** The provider is configured but could not be reached, or answered 5xx. */
export class DiscoveryProviderUnavailableError extends DiscoveryProviderError {
  readonly code = 'DISCOVERY_PROVIDER_UNAVAILABLE';

  constructor(provider: string, message: string) {
    super(provider, message);
  }
}

/**
 * The provider refused the call because a rate window is exhausted. Distinct
 * from unavailability: nothing is broken and a later retry is expected to work,
 * which is advice worth passing to the caller.
 */
export class DiscoveryRateLimitError extends DiscoveryProviderError {
  readonly code = 'DISCOVERY_PROVIDER_RATE_LIMITED';
  /** Seconds the provider asked us to wait, when it said. */
  readonly retryAfterSeconds: number | undefined;

  constructor(provider: string, message: string, retryAfterSeconds?: number) {
    super(provider, message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The provider was reached but did not answer within the configured budget. */
export class DiscoveryTimeoutError extends DiscoveryProviderError {
  readonly code = 'DISCOVERY_PROVIDER_TIMEOUT';
  readonly timeoutMs: number;

  constructor(provider: string, timeoutMs: number) {
    super(provider, `${provider} did not respond within ${String(timeoutMs)}ms`);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * The provider answered, but the payload was not what its contract promises.
 *
 * This is the error that keeps unvalidated external data out of the domain: a
 * response that fails the Zod schema is reported, never coerced into
 * valid-looking companies.
 */
export class DiscoveryInvalidResponseError extends DiscoveryProviderError {
  readonly code = 'DISCOVERY_PROVIDER_INVALID_RESPONSE';

  constructor(provider: string, message: string, details: ApiErrorDetail[] = []) {
    super(provider, message, details);
  }
}

/**
 * A configured strategy has no implementation yet.
 *
 * Reported rather than skipped: an ICP configured for `SIGNAL_FIRST` that
 * silently ran only firmographic discovery would look like a working search
 * returning poor results.
 */
export class DiscoveryStrategyUnsupportedError extends DiscoveryProviderError {
  readonly code = 'DISCOVERY_STRATEGY_UNSUPPORTED';
  readonly strategies: readonly string[];

  constructor(strategies: readonly string[]) {
    super(
      'discovery',
      `No implementation for discovery ${strategies.length === 1 ? 'strategy' : 'strategies'}: ${strategies.join(', ')}. Only FIRMOGRAPHIC is implemented.`,
    );
    this.strategies = strategies;
  }
}

export function isDiscoveryProviderError(error: unknown): error is DiscoveryProviderError {
  return error instanceof DiscoveryProviderError;
}
