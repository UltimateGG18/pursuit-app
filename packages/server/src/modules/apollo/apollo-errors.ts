import {
  DiscoveryAuthenticationError,
  DiscoveryInvalidResponseError,
  DiscoveryProviderNotConfiguredError,
  DiscoveryProviderUnavailableError,
  DiscoveryRateLimitError,
  DiscoveryTimeoutError,
  type ApiErrorDetail,
} from '@pursuit/shared';

/**
 * Apollo's failures, in the port's vocabulary.
 *
 * Each class is a one-line subclass of a neutral discovery error. That split is
 * the point of the file:
 *
 *  - `DiscoveryService` and the API layer catch the *neutral* type, so no
 *    domain or HTTP code imports anything named Apollo;
 *  - a stack trace, a log line and a test assertion still name the provider
 *    that actually failed, which is what makes an incident diagnosable.
 *
 * Message discipline, enforced by review rather than by types: these strings
 * reach the server log and - for a configuration mistake - the operator. They
 * carry Apollo's status, error code and endpoint path. They never carry the API
 * key, a request header, or a response payload.
 */

export const APOLLO_PROVIDER_ID = 'apollo';

/** `APOLLO_API_KEY` is absent. Discovery cannot be attempted at all. */
export class ApolloNotConfiguredError extends DiscoveryProviderNotConfiguredError {
  constructor(reason: string) {
    super(APOLLO_PROVIDER_ID, reason);
  }
}

/**
 * Apollo refused the credential: HTTP 401, or a 403 `API_INACCESSIBLE` for a
 * key whose scope excludes the endpoint.
 *
 * A scope failure is deliberately an authentication error and not an
 * unavailability: Apollo is up, the key is simply not allowed to do this, and
 * the repair is in the Apollo console rather than in a retry.
 */
export class ApolloAuthenticationError extends DiscoveryAuthenticationError {
  constructor(message: string) {
    super(APOLLO_PROVIDER_ID, message);
  }
}

/** HTTP 429: a per-minute, per-hour or per-day window is exhausted. */
export class ApolloRateLimitError extends DiscoveryRateLimitError {
  constructor(message: string, retryAfterSeconds?: number) {
    super(APOLLO_PROVIDER_ID, message, retryAfterSeconds);
  }
}

/** The request exceeded `APOLLO_TIMEOUT_MS` and was aborted. */
export class ApolloTimeoutError extends DiscoveryTimeoutError {
  constructor(timeoutMs: number) {
    super(APOLLO_PROVIDER_ID, timeoutMs);
  }
}

/**
 * The call never completed: DNS, TLS, a dropped socket.
 *
 * Reported as unavailability rather than as its own code, because to a caller a
 * network failure and a 503 are the same event - Apollo did not answer.
 */
export class ApolloNetworkError extends DiscoveryProviderUnavailableError {
  constructor(message: string) {
    super(APOLLO_PROVIDER_ID, message);
  }
}

/** Apollo answered 5xx, or with a body it could not explain. */
export class ApolloProviderError extends DiscoveryProviderUnavailableError {
  constructor(message: string) {
    super(APOLLO_PROVIDER_ID, message);
  }
}

/**
 * Apollo answered 200 with a payload that is not an organization search
 * response, or answered 4xx for a request we built wrong.
 *
 * Either way the payload is rejected rather than repaired: `details` says which
 * field broke which rule, and nothing from the response is normalized.
 */
export class ApolloValidationError extends DiscoveryInvalidResponseError {
  constructor(message: string, details: ApiErrorDetail[] = []) {
    super(APOLLO_PROVIDER_ID, message, details);
  }
}
