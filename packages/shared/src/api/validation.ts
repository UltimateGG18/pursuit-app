import type { z } from 'zod';
import type { ApiErrorDetail } from './response.js';

/** Renders a Zod path as the dotted/bracketed path used in API error details. */
export function formatIssuePath(path: readonly (string | number)[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc.length === 0 ? segment : `${acc}.${segment}`;
  }, '');
}

/**
 * Flattens a ZodError into stable, field-addressable details. The frontend keys
 * its inline errors by exactly these paths, so validation performed in the
 * browser and on the server surface identically.
 */
export function zodErrorToDetails(error: z.ZodError, pathPrefix: string[] = []): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: formatIssuePath([...pathPrefix, ...issue.path]),
    message: issue.message,
    code: issue.code,
  }));
}

export interface ValidationFailure {
  readonly ok: false;
  readonly details: ApiErrorDetail[];
}

export interface ValidationSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Typed on the schema's *output*, so a validated value never widens to `any`
 * and the caller keeps the parsed type.
 */
export function validateWith<TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  input: unknown,
  pathPrefix: string[] = [],
): ValidationResult<TOutput> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, details: zodErrorToDetails(parsed.error, pathPrefix) };
}

/** Groups details by path so a form can render every message for a field. */
export function detailsByPath(details: readonly ApiErrorDetail[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const detail of details) {
    const key = detail.path.length > 0 ? detail.path : '_root';
    const bucket = grouped[key];
    if (bucket) bucket.push(detail.message);
    else grouped[key] = [detail.message];
  }
  return grouped;
}
