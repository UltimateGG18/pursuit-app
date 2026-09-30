import type { z } from 'zod';
import {
  ModelInvalidResponseError,
  ModelOutputValidationError,
  zodErrorToDetails,
} from '@pursuit/shared';

/**
 * Turning a model's answer into a validated object.
 *
 * Shared by every `ModelProvider` adapter, because the rule is the same
 * whichever runtime produced the text: recover the JSON, parse it, validate it
 * against the contract, and reject anything that does not fit. No adapter is
 * allowed to repair, coerce or partially accept an answer - a response that
 * misses the contract is a failed analysis, and the caller needs to be told
 * which of the three steps failed.
 */

/**
 * Recovers the JSON object from a model answer.
 *
 * With schema-constrained decoding the content is already bare JSON, so the
 * fence and `<think>` handling here is a safety net for a model or a runtime
 * that ignores the constraint - not a licence to parse prose.
 */
export function extractJsonObject(content: string): string {
  let text = content.trim();

  // Reasoning models can leak a thinking block into the message content.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new ModelInvalidResponseError('The model response contained no JSON object');
  }
  return text.slice(start, end + 1);
}

/**
 * `content` -> JSON -> validated `T`.
 *
 * Distinguishes "not JSON" (`MODEL_INVALID_RESPONSE`) from "JSON of the wrong
 * shape" (`MODEL_OUTPUT_VALIDATION_FAILED`), so a stored failure says which
 * one happened and the Zod paths point at the offending fields.
 */
export function parseStructuredOutput<T>(
  content: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  if (content.trim().length === 0) {
    throw new ModelInvalidResponseError('The model returned an empty response');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonObject(content));
  } catch (error) {
    if (error instanceof ModelInvalidResponseError) throw error;
    throw new ModelInvalidResponseError('The model response was not parsable JSON');
  }

  const validated = schema.safeParse(parsedJson);
  if (!validated.success) {
    throw new ModelOutputValidationError(
      'The model response did not match the expected output schema',
      zodErrorToDetails(validated.error, ['output']),
    );
  }
  return validated.data;
}
