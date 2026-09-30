/**
 * Single response envelope for every endpoint.
 *
 *   success: { success: true,  data: T,    error: null }
 *   failure: { success: false, data: null, error: { code, message, details } }
 */

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
  // Model analysis. A missing ICP keeps using NOT_FOUND, the code this API
  // already returns for every unknown resource.
  'MODEL_PROVIDER_UNAVAILABLE',
  'MODEL_RATE_LIMITED',
  'MODEL_TIMEOUT',
  'MODEL_INVALID_RESPONSE',
  'MODEL_OUTPUT_VALIDATION_FAILED',
  'ANALYSIS_PERSISTENCE_FAILED',
  // Prospect discovery. Separate from the MODEL_* family because a company
  // data provider being rate limited says nothing about the analysis model,
  // and the UI has to be able to tell the two outages apart.
  'DISCOVERY_PROVIDER_UNAVAILABLE',
  'DISCOVERY_PROVIDER_RATE_LIMITED',
  'DISCOVERY_PROVIDER_TIMEOUT',
  'DISCOVERY_PROVIDER_INVALID_RESPONSE',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorDetail {
  /** Dot/bracket path into the request payload, e.g. `config.geography.includedCountries`. */
  readonly path: string;
  readonly message: string
  readonly code?: string;
}

export interface ApiErrorBody {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details: ApiErrorDetail[];
}

export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
  readonly error: null;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly data: null;
  readonly error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export function apiSuccess<T>(data: T): ApiSuccessResponse<T> {
  return { success: true, data, error: null };
}

export function apiFailure(
  code: ApiErrorCode,
  message: string,
  details: ApiErrorDetail[] = [],
): ApiErrorResponse {
  return { success: false, data: null, error: { code, message, details } };
}

export function isApiSuccess<T>(response: ApiResponse<T>): response is ApiSuccessResponse<T> {
  return response.success;
}

/** HTTP status that belongs with each error code. */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  // 502/503/504: the API is fine, the model behind it is not.
  MODEL_PROVIDER_UNAVAILABLE: 503,
  // 429 is passed through rather than folded into 503: a hosted provider's
  // rate limit is "try again shortly", which a caller can act on.
  MODEL_RATE_LIMITED: 429,
  MODEL_TIMEOUT: 504,
  MODEL_INVALID_RESPONSE: 502,
  MODEL_OUTPUT_VALIDATION_FAILED: 502,
  ANALYSIS_PERSISTENCE_FAILED: 500,
  // Same reasoning as the MODEL_* family: the API is fine, the provider it
  // depends on is not. 429 is passed through so a caller can act on it.
  DISCOVERY_PROVIDER_UNAVAILABLE: 503,
  DISCOVERY_PROVIDER_RATE_LIMITED: 429,
  DISCOVERY_PROVIDER_TIMEOUT: 504,
  DISCOVERY_PROVIDER_INVALID_RESPONSE: 502,
};
