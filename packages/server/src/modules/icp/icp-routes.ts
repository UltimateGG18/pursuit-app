import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createIcpRequestSchema,
  icpIdParamsSchema,
  listIcpQuerySchema,
  updateIcpRequestSchema,
  validateWith,
} from '@pursuit/shared';
import { sendFailure, sendSuccess } from '../../shared/http.js';
import type { IcpService } from './icp-service.js';

interface IcpRoutesOptions {
  service: IcpService;
}

/** Rejects a bad `:id` before the service is asked for it. */
function parseId(request: FastifyRequest, reply: FastifyReply): string | null {
  const parsed = validateWith(icpIdParamsSchema, request.params);
  if (!parsed.ok) {
    sendFailure(reply, 'VALIDATION_ERROR', 'Invalid ICP id', parsed.details);
    return null;
  }
  return parsed.value.id;
}

export function registerIcpRoutes(app: FastifyInstance, options: IcpRoutesOptions): void {
  const { service } = options;

  app.post('/api/icps', async (request, reply) => {
    const parsed = validateWith(createIcpRequestSchema, request.body);
    if (!parsed.ok) {
      return sendFailure(reply, 'VALIDATION_ERROR', 'The ICP payload is invalid', parsed.details);
    }
    const created = await service.create(parsed.value);
    return sendSuccess(reply, 201, created);
  });

  app.get('/api/icps', async (request, reply) => {
    const parsed = validateWith(listIcpQuerySchema, request.query);
    if (!parsed.ok) {
      return sendFailure(reply, 'VALIDATION_ERROR', 'Invalid list query', parsed.details);
    }
    return sendSuccess(reply, 200, await service.list(parsed.value));
  });

  app.get('/api/icps/:id', async (request, reply) => {
    const id = parseId(request, reply);
    if (id === null) return reply;
    return sendSuccess(reply, 200, await service.getById(id));
  });

  app.put('/api/icps/:id', async (request, reply) => {
    const id = parseId(request, reply);
    if (id === null) return reply;

    const parsed = validateWith(updateIcpRequestSchema, request.body);
    if (!parsed.ok) {
      return sendFailure(reply, 'VALIDATION_ERROR', 'The ICP payload is invalid', parsed.details);
    }
    return sendSuccess(reply, 200, await service.update(id, parsed.value));
  });

  app.delete('/api/icps/:id', async (request, reply) => {
    const id = parseId(request, reply);
    if (id === null) return reply;
    return sendSuccess(reply, 200, await service.remove(id));
  });
}
