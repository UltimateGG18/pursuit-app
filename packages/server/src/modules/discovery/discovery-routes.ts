import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  discoverIcpRequestSchema,
  discoverProspectsRequestSchema,
  icpIdParamsSchema,
  validateWith,
} from '@pursuit/shared';
import { sendFailure, sendSuccess } from '../../shared/http.js';
import { describeErrorForLog, toAppError } from './discovery-error-mapping.js';
import type { DiscoveryService } from './discovery-service.js';
import type { ProspectService } from './prospect-service.js';

interface DiscoveryRoutesOptions {
  service: DiscoveryService;
  prospects: ProspectService;
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
 * Discovery endpoints.
 *
 * `POST /api/icps/:id/discover` is the smallest endpoint that exercises the
 * whole slice end to end. It is deliberately *not* `POST /api/search-runs`,
 * which the plan eventually specifies: a search run is an audited, persisted
 * lifecycle over a `search_runs` table that does not exist yet, and building
 * the route before the lifecycle would leave an endpoint whose name promises
 * durability it cannot deliver. Discovery hangs off the ICP because an ICP is
 * what it needs and what already exists.
 *
 * The response carries normalized candidates. No Apollo DTO reaches this layer -
 * there is nothing to strip here, because the provider contract never let one
 * through.
 */
export function registerDiscoveryRoutes(
  app: FastifyInstance,
  options: DiscoveryRoutesOptions,
): void {
  const { service, prospects } = options;

  app.get('/api/discovery/health', async (_request, reply) =>
    sendSuccess(reply, 200, await service.health()),
  );

  app.get('/api/prospects/health', async (_request, reply) =>
    sendSuccess(reply, 200, await prospects.health()),
  );

  app.post('/api/icps/:id/discover', async (request, reply) => {
    const id = parseIcpId(request, reply);
    if (id === null) return reply;

    // A bare `{}` - or no body at all - is a valid request: the ICP already
    // says what to look for.
    const parsed = validateWith(discoverIcpRequestSchema, request.body ?? {});
    if (!parsed.ok) {
      return sendFailure(reply, 'VALIDATION_ERROR', 'The discovery request is invalid', parsed.details);
    }

    try {
      const run = await service.discoverForIcp(id, {
        limit: parsed.value.limit,
        ...(parsed.value.cursor !== undefined ? { cursor: parsed.value.cursor } : {}),
        ...(parsed.value.strategies !== undefined ? { strategies: parsed.value.strategies } : {}),
      });
      // 200, not 201: this slice creates no persisted resource. It will become
      // a 201 when a search run is actually stored.
      return sendSuccess(reply, 200, run);
    } catch (error) {
      const appError = toAppError(error);
      /**
       * The provider's own message is logged and then discarded. It is the only
       * account of *why* Apollo refused - a scope error, a malformed filter -
       * and it is not written for a client, so it stays server-side while the
       * response carries our own copy.
       */
      request.log.warn(
        { icpId: id, code: appError.code, err: describeErrorForLog(error) },
        'discovery failed',
      );
      return sendFailure(reply, appError.code, appError.message, appError.details);
    }
  });

  /**
   * `POST /api/icps/:id/prospects` - the step after analysis.
   *
   * Hangs off the ICP for the same reason `discover` does: an ICP is what a
   * prospect search needs and what already exists, and this slice persists no
   * search run it could name a resource after. 200 rather than 201 for exactly
   * that reason - nothing was created.
   *
   * Pagination is page-based rather than the cursor `discover` uses, because
   * these two are different interactions: firmographic discovery is a budgeted
   * walk the server performs, and this is a result set a person browses. A
   * shared contract would have to pretend one of them is the other.
   */
  app.post('/api/icps/:id/prospects', async (request, reply) => {
    const id = parseIcpId(request, reply);
    if (id === null) return reply;

    // A bare `{}` - or no body at all - is a valid request: the ICP already
    // says who to look for, and the defaults are page 1 at the default size.
    const parsed = validateWith(discoverProspectsRequestSchema, request.body ?? {});
    if (!parsed.ok) {
      return sendFailure(
        reply,
        'VALIDATION_ERROR',
        'The prospect search request is invalid',
        parsed.details,
      );
    }

    const { page, perPage, analysisId } = parsed.value;
    // Filters and counts only. No credential, no person, no company - a lead
    // list is personal data and does not belong in an application log.
    request.log.info({ icpId: id, page, perPage }, 'prospect search started');

    try {
      const run = await prospects.searchForIcp(id, {
        page,
        perPage,
        ...(analysisId !== undefined ? { analysisId } : {}),
      });
      request.log.info(
        {
          icpId: id,
          provider: run.meta.provider,
          page: run.pagination.page,
          returned: run.meta.returned,
          totalEntries: run.pagination.totalEntries,
          durationMs: run.meta.durationMs,
        },
        'prospect search completed',
      );
      return sendSuccess(reply, 200, run);
    } catch (error) {
      const appError = toAppError(error);
      /**
       * The provider's own message is logged and then discarded. It is the only
       * account of *why* the provider refused - a scope error, a malformed
       * filter - and it is not written for a client, so it stays server-side
       * while the response carries our own copy.
       */
      request.log.warn(
        { icpId: id, code: appError.code, err: describeErrorForLog(error) },
        'prospect search failed',
      );
      return sendFailure(reply, appError.code, appError.message, appError.details);
    }
  });
}
