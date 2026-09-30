import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  DISCOVERY_QUERY_VERSION,
  ICP_ANALYSIS_SCHEMA_VERSION,
  zodErrorToDetails,
  type CompanyDiscoveryProvider,
  type ModelProvider,
  type PeopleDiscoveryProvider,
  type PeopleEnrichmentProvider,
} from '@pursuit/shared';
import { corsOrigins, type Env } from './config/env.js';
import { isAppError } from './shared/errors.js';
import { sendFailure, sendSuccess } from './shared/http.js';
import { registerIcpRoutes } from './modules/icp/icp-routes.js';
import { registerIcpAnalysisRoutes } from './modules/icp/icp-analysis-routes.js';
import { IcpService } from './modules/icp/icp-service.js';
import { IcpAnalysisService } from './modules/icp/icp-analysis-service.js';
import type { IcpRepository } from './modules/icp/icp-repository.js';
import type { IcpAnalysisRepository } from './modules/icp/icp-analysis-repository.js';
import { resolveModelProvider } from './modules/model/model-provider-registry.js';
import { registerDiscoveryRoutes } from './modules/discovery/discovery-routes.js';
import { DiscoveryService } from './modules/discovery/discovery-service.js';
import { FirmographicDiscoveryStrategy } from './modules/discovery/discovery-strategy.js';
import { ProspectService } from './modules/discovery/prospect-service.js';
import { CandidateProcessingService } from './modules/discovery/candidate-processing-service.js';
import type { CandidateRepository } from './modules/discovery/candidate-repository.js';
import { ProspectEnrichmentService } from './modules/discovery/prospect-enrichment-service.js';
import {
  resolveDiscoveryProvider,
  resolvePeopleEnrichmentProvider,
  resolvePeopleProvider,
} from './modules/discovery/discovery-provider-registry.js';

export interface BuildAppOptions {
  env: Env;
  /** Injected so the HTTP layer can be tested against an in-memory store. */
  icpRepository: IcpRepository;
  analysisRepository: IcpAnalysisRepository;
  /** Injected so the analyze flow can be tested without a model runtime. */
  modelProvider?: ModelProvider;
  /** Injected so discovery can be tested without a live company data provider. */
  discoveryProvider?: CompanyDiscoveryProvider;
  /** Injected so prospect search can be tested without a live contact provider. */
  peopleProvider?: PeopleDiscoveryProvider;
  /**
   * Injected so the enrichment stage can be tested without spending credits.
   *
   * Separate from `peopleProvider` because they are separate ports: a suite
   * testing search should not have to stub enrichment, and one testing
   * enrichment should not have to stub search.
   */
  enrichmentProvider?: PeopleEnrichmentProvider;
  /**
   * Where processed search runs are recorded.
   *
   * Optional, and its absence is a supported configuration rather than a
   * degraded one: a run is still processed, still filtered and still returned,
   * and the response says plainly that it was not stored. That keeps every
   * suite that has no interest in persistence free of a database.
   */
  candidateRepository?: CandidateRepository;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { env, icpRepository, analysisRepository } = options;
  const modelProvider = options.modelProvider ?? resolveModelProvider(env);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log credentials or full payloads. `x-api-key` is redacted
      // because it is the header shape a provider credential travels in, and a
      // client mistakenly sending one must not leave it in our log.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
    },
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, { origin: corsOrigins(env), methods: ['GET', 'POST', 'PUT', 'DELETE'] });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', String(request.id));
  });

  /**
   * The discovery provider is resolved once, at boot, and shared by the
   * strategy and the health route - so `/api/discovery/health` reports on the
   * same instance a discovery run would use, rather than on a fresh one.
   */
  const discoveryProvider =
    options.discoveryProvider ?? resolveDiscoveryProvider(env, { logger: app.log });
  /**
   * Resolved separately from the company provider and shared by the prospect
   * route and its health probe, for the same reason: `/api/prospects/health`
   * has to report on the instance a search would actually use.
   */
  const peopleProvider =
    options.peopleProvider ?? resolvePeopleProvider(env, { logger: app.log });
  /**
   * The contact enrichment provider, resolved once at boot like the other two
   * and sharing the same Apollo client behind the registry - one credential,
   * one timeout budget, one rate-limit window to reason about.
   */
  const enrichmentProvider =
    options.enrichmentProvider ?? resolvePeopleEnrichmentProvider(env, { logger: app.log });

  app.get('/health', async (_request, reply) =>
    sendSuccess(reply, 200, {
      status: 'ok',
      environment: env.NODE_ENV,
      icpSchemaVersion: 'icp.v1',
      analysisSchemaVersion: ICP_ANALYSIS_SCHEMA_VERSION,
      discoveryQueryVersion: DISCOVERY_QUERY_VERSION,
      // Which providers are wired up. Reachability is a separate, awaited probe
      // at /api/model/health and /api/discovery/health, so /health never waits
      // on a model runtime or a data provider.
      modelProvider: modelProvider.describe(),
      discoveryProvider: discoveryProvider.describe(),
      peopleProvider: peopleProvider.describePeople(),
      enrichmentProvider: enrichmentProvider.describeEnrichment(),
    }),
  );

  registerIcpRoutes(app, { service: new IcpService(icpRepository) });

  registerIcpAnalysisRoutes(app, {
    service: new IcpAnalysisService({
      icpRepository,
      analysisRepository,
      provider: modelProvider,
      promptVersion: env.MODEL_PROMPT_VERSION,
      logger: app.log,
    }),
  });

  registerDiscoveryRoutes(app, {
    service: new DiscoveryService({
      icpRepository,
      provider: discoveryProvider,
      // Only the P0 strategy. The others are registered here as they land, and
      // an ICP asking for one that is absent is told so rather than served a
      // quietly narrower search.
      strategies: [new FirmographicDiscoveryStrategy(discoveryProvider)],
    }),
    prospects: new ProspectService({
      icpRepository,
      analysisRepository,
      provider: peopleProvider,
      // The deterministic stage after discovery: dedupe, entity resolution,
      // suppression, hard ICP filters, contact enrichment, reachability sanity.
      // No model, no score.
      processing: new CandidateProcessingService({
        ...(options.candidateRepository ? { repository: options.candidateRepository } : {}),
        enrichment: new ProspectEnrichmentService({
          provider: enrichmentProvider,
          revealPhoneNumbers: env.APOLLO_REVEAL_PHONE_NUMBERS,
          maxCandidatesPerRun: env.APOLLO_MAX_ENRICHMENTS_PER_RUN,
          logger: app.log,
        }),
        logger: app.log,
      }),
    }),
  });

  app.setNotFoundHandler((request, reply) =>
    sendFailure(reply, 'NOT_FOUND', `Route ${request.method} ${request.url} not found`),
  );

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      if (error.code === 'INTERNAL_ERROR') {
        request.log.error({ err: error, code: error.code }, 'request failed');
      } else {
        request.log.info({ code: error.code }, 'request rejected');
      }
      return sendFailure(reply, error.code, error.message, error.details);
    }

    if (error instanceof ZodError) {
      return sendFailure(reply, 'VALIDATION_ERROR', 'The payload is invalid', zodErrorToDetails(error));
    }

    // Fastify's own errors (malformed JSON, unsupported media type, ...).
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';

    if (statusCode === 404) {
      return sendFailure(reply, 'NOT_FOUND', message);
    }
    if (statusCode < 500) {
      return sendFailure(reply, 'BAD_REQUEST', message);
    }

    request.log.error({ err: error }, 'unhandled error');
    return sendFailure(reply, 'INTERNAL_ERROR', 'An unexpected error occurred');
  });

  return app;
}
