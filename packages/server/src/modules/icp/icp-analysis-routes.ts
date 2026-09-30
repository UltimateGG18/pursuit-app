import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { analysisIdParamsSchema, icpIdParamsSchema, validateWith } from '@pursuit/shared';
import { sendFailure, sendSuccess } from '../../shared/http.js';
import type { IcpAnalysisService } from './icp-analysis-service.js';

interface IcpAnalysisRoutesOptions {
  service: IcpAnalysisService;
}

/** Rejects a bad `:id` before the service is asked for it. */
function parseIcpId(request: FastifyRequest, reply: FastifyReply): string | null {
  const parsed = validateWith(icpIdParamsSchema, request.params);
  if (!parsed.ok) {
    sendFailure(reply, 'VALIDATION_ERROR', 'Invalid ICP id', parsed.details);
    return null;
  }
  return parsed.value.id;
}

/**
 * Analysis endpoints.
 *
 * Only POST invokes the model. The GETs read what was stored, so refreshing a
 * results page is free and can never spend a model call.
 */
export function registerIcpAnalysisRoutes(
  app: FastifyInstance,
  options: IcpAnalysisRoutesOptions,
): void {
  const { service } = options;

  app.get('/api/model/health', async (_request, reply) =>
    sendSuccess(reply, 200, await service.health()),
  );

  app.post('/api/icps/:id/analyze', async (request, reply) => {
    const id = parseIcpId(request, reply);
    if (id === null) return reply;
    // 201: the call creates an analysis resource, it does not mutate the ICP.
    return sendSuccess(reply, 201, await service.analyze(id));
  });

  app.get('/api/icps/:id/analyses', async (request, reply) => {
    const id = parseIcpId(request, reply);
    if (id === null) return reply;
    return sendSuccess(reply, 200, await service.list(id));
  });

  app.get('/api/icps/:id/analyses/:analysisId', async (request, reply) => {
    const parsed = validateWith(analysisIdParamsSchema, request.params);
    if (!parsed.ok) {
      return sendFailure(reply, 'VALIDATION_ERROR', 'Invalid analysis id', parsed.details);
    }
    return sendSuccess(reply, 200, await service.getById(parsed.value.id, parsed.value.analysisId));
  });
}
