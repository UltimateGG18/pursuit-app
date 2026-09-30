import type { FastifyInstance } from 'fastify';
import {
  createExampleIcpConfig,
  type ApiErrorDetail,
  type CompanyDiscoveryProvider,
  type CreateIcpRequestInput,
  type IcpConfig,
  type ModelProvider,
  type PeopleDiscoveryProvider,
  type PeopleEnrichmentProvider,
} from '@pursuit/shared';
import { buildApp } from '../src/app.js';
import { loadEnvOrThrow } from '../src/config/env.js';
import { InMemoryIcpRepository } from '../src/modules/icp/in-memory-icp-repository.js';
import { InMemoryIcpAnalysisRepository } from '../src/modules/icp/in-memory-icp-analysis-repository.js';
import { InMemoryCandidateRepository } from '../src/modules/discovery/in-memory-candidate-repository.js';

export interface TestContext {
  app: FastifyInstance;
  repository: InMemoryIcpRepository;
  analyses: InMemoryIcpAnalysisRepository;
  candidates: InMemoryCandidateRepository;
}

export interface TestAppOptions {
  /** Stands in for the model runtime; omitted means `MODEL_PROVIDER=none`. */
  modelProvider?: ModelProvider;
  /**
   * Stands in for the company data provider; omitted means
   * `DISCOVERY_PROVIDER=none`, so a suite that does not test discovery never
   * needs an Apollo credential.
   */
  discoveryProvider?: CompanyDiscoveryProvider;
  /**
   * Stands in for the contact data provider; omitted means
   * `DISCOVERY_PROVIDER=none`, so a suite that does not test prospect search
   * never needs an Apollo credential either.
   */
  peopleProvider?: PeopleDiscoveryProvider;
  /**
   * Stands in for the contact enrichment provider; omitted means
   * `DISCOVERY_PROVIDER=none`, whose null enrichment provider reports every
   * candidate as UNAVAILABLE rather than spending a credential.
   */
  enrichmentProvider?: PeopleEnrichmentProvider;
  /**
   * Stands in for the candidate store. Omitted, the app is built *without* one,
   * which is the configuration that reports `persisted: false` - so a suite has
   * to opt in to persistence rather than accidentally depend on it.
   */
  candidateRepository?: InMemoryCandidateRepository;
  /**
   * Environment overrides. Omitting `modelProvider` as well makes the app
   * resolve its provider through the registry, which is how provider selection
   * itself gets tested rather than assumed.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Boots the real Fastify app - routes, validation, error handler and response
 * envelope - against in-memory repositories, so the HTTP contract is tested
 * without needing a live PostgreSQL instance or a running model.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const env = loadEnvOrThrow({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    LOG_LEVEL: 'silent',
    ...options.env,
  });
  const repository = new InMemoryIcpRepository();
  const analyses = new InMemoryIcpAnalysisRepository();
  const candidates = options.candidateRepository ?? new InMemoryCandidateRepository();
  const app = await buildApp({
    env,
    icpRepository: repository,
    analysisRepository: analyses,
    ...(options.candidateRepository ? { candidateRepository: options.candidateRepository } : {}),
    ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
    ...(options.discoveryProvider ? { discoveryProvider: options.discoveryProvider } : {}),
    ...(options.peopleProvider ? { peopleProvider: options.peopleProvider } : {}),
    ...(options.enrichmentProvider ? { enrichmentProvider: options.enrichmentProvider } : {}),
  });
  await app.ready();
  return { app, repository, analyses, candidates };
}

export function exampleConfig(name?: string): IcpConfig {
  return structuredClone(createExampleIcpConfig(name ? { name } : undefined));
}

export function createBody(name?: string, overrides?: Partial<CreateIcpRequestInput>) {
  return { config: exampleConfig(name), ...overrides };
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details: ApiErrorDetail[] } | null;
}

export function parseBody<T>(payload: string): ApiEnvelope<T> {
  return JSON.parse(payload) as ApiEnvelope<T>;
}

export function detailPaths(body: ApiEnvelope<unknown>): string[] {
  return (body.error?.details ?? []).map((detail) => detail.path);
}
