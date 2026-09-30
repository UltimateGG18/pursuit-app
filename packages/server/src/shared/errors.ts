import type { ApiErrorCode, ApiErrorDetail } from '@pursuit/shared';

/**
 * Application error carrying the API error code, so every failure maps onto
 * exactly one entry of the shared response contract.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details: ApiErrorDetail[];

  constructor(code: ApiErrorCode, message: string, details: ApiErrorDetail[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  static validation(message: string, details: ApiErrorDetail[] = []): AppError {
    return new AppError('VALIDATION_ERROR', message, details);
  }

  static badRequest(message: string, details: ApiErrorDetail[] = []): AppError {
    return new AppError('BAD_REQUEST', message, details);
  }

  static notFound(message: string, details: ApiErrorDetail[] = []): AppError {
    return new AppError('NOT_FOUND', message, details);
  }

  static conflict(message: string, details: ApiErrorDetail[] = []): AppError {
    return new AppError('CONFLICT', message, details);
  }

  static internal(message: string, details: ApiErrorDetail[] = []): AppError {
    return new AppError('INTERNAL_ERROR', message, details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
