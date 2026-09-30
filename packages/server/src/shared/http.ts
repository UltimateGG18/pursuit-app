import type { FastifyReply } from 'fastify';
import {
  API_ERROR_STATUS,
  apiFailure,
  apiSuccess,
  type ApiErrorCode,
  type ApiErrorDetail,
} from '@pursuit/shared';

export function sendSuccess<T>(reply: FastifyReply, status: number, data: T): FastifyReply {
  return reply.status(status).send(apiSuccess(data));
}

export function sendFailure(
  reply: FastifyReply,
  code: ApiErrorCode,
  message: string,
  details: ApiErrorDetail[] = [],
): FastifyReply {
  return reply.status(API_ERROR_STATUS[code]).send(apiFailure(code, message, details));
}
