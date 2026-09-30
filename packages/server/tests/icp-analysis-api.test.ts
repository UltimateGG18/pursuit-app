import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ICP_ANALYSIS_SECTIONS,
  ModelOutputValidationError,
  ModelProviderNotConfiguredError,
  ModelProviderUnavailableError,
  ModelRateLimitedError,
  ModelTimeoutError,
  readAnalysisOutput,
  type IcpAnalysisDto,
  type IcpAnalysisListDto,
  type IcpModelInput,
  type IcpProfileDto,
  type ModelProviderHealth,
} from '@pursuit/shared';
import { createBody, createTestApp, parseBody } from './helpers.js';
import { StubModelProvider, validAnalysisOutput } from './analysis-fixtures.js';
import type { InMemoryIcpRepository } from '../src/modules/icp/in-memory-icp-repository.js';
import type { InMemoryIcpAnalysisRepository } from '../src/modules/icp/in-memory-icp-analysis-repository.js';

const MISSING_ID = '99999999-9999-4999-8999-999999999999';

let app: FastifyInstance;
let repository: InMemoryIcpRepository;
let analyses: InMemoryIcpAnalysisRepository;
let provider: StubModelProvider;

async function boot(stub: StubModelProvider): Promise<void> {
  provider = stub;
  ({ app, repository, analyses } = await createTestApp({ modelProvider: stub }));
}

beforeEach(async () => {
  await boot(new StubModelProvider());
});

afterEach(async () => {
  await app.close();
});

async function createIcp(name?: string): Promise<IcpProfileDto> {
  const response = await app.inject({ method: 'POST', url: '/api/icps', payload: createBody(name) });
  expect(response.statusCode).toBe(201);
  const created = parseBody<IcpProfileDto>(response.payload).data;
  if (!created) throw new Error('expected a created ICP');
  return created;
}

function analyze(icpId: string) {
  return app.inject({ method: 'POST', url: `/api/icps/${icpId}/analyze` });
}

describe('POST /api/icps/:id/analyze - success', () => {
  it('analyzes a stored ICP and returns a COMPLETED result', async () => {
    const icp = await createIcp('Analyze me');

    const response = await analyze(icp.id);

    expect(response.statusCode).toBe(201);
    const body = parseBody<IcpAnalysisDto>(response.payload);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      icpId: icp.id,
      icpVersion: 1,
      status: 'COMPLETED',
      provider: 'stub',
      model: 'stub-model:1b',
      promptVersion: 'stub-v1',
      analysisSchemaVersion: 'icp-analysis.v2',
    });
    expect(body.data?.error).toBeNull();
  });

  /**
   * The endpoint's actual promise to the discovery stage: a COMPLETED run
   * carries readable intelligence under the version it says it does, not merely
   * some JSON.
   */
  it('returns intelligence readable under the version the row declares', async () => {
    const icp = await createIcp('Readable intelligence');

    const body = parseBody<IcpAnalysisDto>((await analyze(icp.id)).payload);
    const output = readAnalysisOutput(body.data!);

    expect(output).not.toBeNull();
    for (const section of ICP_ANALYSIS_SECTIONS) {
      expect(output).toHaveProperty(section);
    }
    expect(output?.discoveryStrategy.recommendedSequence.length).toBeGreaterThan(0);
    expect(output?.evidenceStrategy[0]?.evidenceTypes.length).toBeGreaterThan(0);
  });

  it('persists the analysis, so a later GET returns it', async () => {
    const icp = await createIcp('Persisted analysis');
    const created = parseBody<IcpAnalysisDto>((await analyze(icp.id)).payload).data;

    const stored = await analyses.findById(icp.id, created!.id);

    expect(stored).toMatchObject({ status: 'COMPLETED', icpProfileId: icp.id });
    expect(stored?.output?.icpInterpretation.targetProfile).toBe(
      validAnalysisOutput().icpInterpretation.targetProfile,
    );
  });

  it('stores the exact normalized input that produced the result', async () => {
    const icp = await createIcp('Snapshot check');

    const created = parseBody<IcpAnalysisDto>((await analyze(icp.id)).payload).data;

    const snapshot = created?.inputSnapshot as IcpModelInput;
    expect(snapshot).toMatchObject({ icpId: icp.id, icpVersion: 1, schemaVersion: 'icp.v1' });
    expect(snapshot.icp).toEqual(icp.config);
  });

  it('keeps the snapshot even after the ICP is edited, so the run stays reproducible', async () => {
    const icp = await createIcp('Reproducibility');
    const created = parseBody<IcpAnalysisDto>((await analyze(icp.id)).payload).data;

    const edited = createBody('Reproducibility');
    edited.config.basicProfile.priority = 'P2';
    await app.inject({ method: 'PUT', url: `/api/icps/${icp.id}`, payload: edited });

    const stored = await analyses.findById(icp.id, created!.id);
    const snapshot = stored?.inputSnapshot as IcpModelInput;
    expect(snapshot.icp.basicProfile.priority).toBe(icp.config.basicProfile.priority);
    expect(snapshot.icpVersion).toBe(1);
  });

  it('hands the model the whole normalized configuration and never mutates the ICP', async () => {
    const icp = await createIcp('No mutation');

    await analyze(icp.id);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.icp).toEqual(icp.config);

    const reread = parseBody<IcpProfileDto>(
      (await app.inject({ method: 'GET', url: `/api/icps/${icp.id}` })).payload,
    ).data;
    expect(reread).toMatchObject({ version: 1, config: icp.config });
  });
});

describe('POST /api/icps/:id/analyze - the ICP does not exist', () => {
  it('returns 404 without calling the model', async () => {
    const response = await analyze(MISSING_ID);

    expect(response.statusCode).toBe(404);
    expect(parseBody(response.payload).error?.code).toBe('NOT_FOUND');
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects an id that is not a UUID', async () => {
    const response = await analyze('not-a-uuid');

    expect(response.statusCode).toBe(400);
    expect(parseBody(response.payload).error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an archived ICP', async () => {
    const icp = await createIcp('Archived');
    await app.inject({ method: 'DELETE', url: `/api/icps/${icp.id}` });

    expect((await analyze(icp.id)).statusCode).toBe(404);
  });
});

describe('POST /api/icps/:id/analyze - model failures', () => {
  it('records a FAILED analysis and returns MODEL_PROVIDER_UNAVAILABLE when the runtime is down', async () => {
    await app.close();
    await boot(new StubModelProvider({ error: new ModelProviderUnavailableError('down') }));
    const icp = await createIcp('Runtime down');

    const response = await analyze(icp.id);

    expect(response.statusCode).toBe(503);
    const error = parseBody(response.payload).error;
    expect(error?.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
    // The provider's own wording never reaches the client.
    expect(error?.message).not.toContain('down');

    const stored = await analyses.listForIcp(icp.id, 10);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      status: 'FAILED',
      output: null,
      errorCode: 'MODEL_PROVIDER_UNAVAILABLE',
    });
  });

  it('maps a rate limit onto MODEL_RATE_LIMITED and passes the retry hint on', async () => {
    await app.close();
    await boot(
      new StubModelProvider({ error: new ModelRateLimitedError('quota exhausted', 12) }),
    );
    const icp = await createIcp('Rate limited');

    const response = await analyze(icp.id);

    expect(response.statusCode).toBe(429);
    const error = parseBody(response.payload).error;
    expect(error?.code).toBe('MODEL_RATE_LIMITED');
    expect(error?.message).toContain('12s');
    // The provider's own wording never reaches the client.
    expect(error?.message).not.toContain('quota exhausted');

    const stored = await analyses.listForIcp(icp.id, 10);
    expect(stored[0]).toMatchObject({
      status: 'FAILED',
      output: null,
      errorCode: 'MODEL_RATE_LIMITED',
    });
  });

  /**
   * A missing credential is the one failure an operator can fix, so the setting
   * it has to be fixed in is named. It is still reported as unavailability,
   * because to a caller nothing answered either way.
   */
  it('names the missing configuration setting when a credential is absent', async () => {
    await app.close();
    await boot(
      new StubModelProvider({
        error: new ModelProviderNotConfiguredError(
          'ICP_ANALYSIS',
          'GROQ_API_KEY is not configured. Add it to packages/server/.env and restart the API.',
        ),
      }),
    );
    const icp = await createIcp('No credential');

    const response = await analyze(icp.id);

    expect(response.statusCode).toBe(503);
    const error = parseBody(response.payload).error;
    expect(error?.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
    expect(error?.message).toContain('GROQ_API_KEY');
    expect((await analyses.listForIcp(icp.id, 10))[0]?.status).toBe('FAILED');
  });

  it('maps a timeout onto MODEL_TIMEOUT', async () => {
    await app.close();
    await boot(new StubModelProvider({ error: new ModelTimeoutError(120000) }));
    const icp = await createIcp('Timeout');

    const response = await analyze(icp.id);

    expect(response.statusCode).toBe(504);
    expect(parseBody(response.payload).error?.code).toBe('MODEL_TIMEOUT');
    expect((await analyses.listForIcp(icp.id, 10))[0]?.status).toBe('FAILED');
  });

  it('maps a provider-side validation failure onto MODEL_OUTPUT_VALIDATION_FAILED', async () => {
    await app.close();
    await boot(
      new StubModelProvider({
        error: new ModelOutputValidationError('bad shape', [
          { path: 'output.summary', message: 'Required' },
        ]),
      }),
    );
    const icp = await createIcp('Bad shape');

    const response = await analyze(icp.id);

    expect(response.statusCode).toBe(502);
    const error = parseBody(response.payload).error;
    expect(error?.code).toBe('MODEL_OUTPUT_VALIDATION_FAILED');
    expect(error?.details.map((detail) => detail.path)).toContain('output.summary');
  });

  it('never stores an invalid output as COMPLETED, even if a provider returns one', async () => {
    await app.close();
    // A provider that skipped its own validation - the persistence boundary is
    // the last gate, and it has to hold on its own.
    await boot(new StubModelProvider({ output: { summary: 'too short' } }));
    const icp = await createIcp('Invalid output');

    const response = await analyze(icp.id);

    expect(response.statusCode).toBe(502);
    expect(parseBody(response.payload).error?.code).toBe('MODEL_OUTPUT_VALIDATION_FAILED');

    const stored = await analyses.listForIcp(icp.id, 10);
    expect(stored[0]).toMatchObject({ status: 'FAILED', output: null });
  });

  it('returns ANALYSIS_PERSISTENCE_FAILED when the analysis row cannot be opened', async () => {
    const icp = await createIcp('Write failure');
    analyses.failNextWrite = new Error('connection reset');

    const response = await analyze(icp.id);

    expect(response.statusCode).toBe(500);
    expect(parseBody(response.payload).error?.code).toBe('ANALYSIS_PERSISTENCE_FAILED');
    expect(provider.calls).toHaveLength(0);
  });
});

describe('GET /api/icps/:id/analyses', () => {
  it('returns the stored analyses newest first without invoking the model', async () => {
    const icp = await createIcp('History');
    await analyze(icp.id);
    await analyze(icp.id);
    const callsAfterRuns = provider.calls.length;

    const response = await app.inject({ method: 'GET', url: `/api/icps/${icp.id}/analyses` });

    expect(response.statusCode).toBe(200);
    const body = parseBody<IcpAnalysisListDto>(response.payload);
    expect(body.data?.total).toBe(2);
    expect(body.data?.items).toHaveLength(2);
    const [newest, oldest] = body.data!.items;
    expect(new Date(newest!.createdAt).getTime()).toBeGreaterThan(
      new Date(oldest!.createdAt).getTime(),
    );
    expect(provider.calls).toHaveLength(callsAfterRuns);
  });

  it('returns an empty list for an ICP that has never been analyzed', async () => {
    const icp = await createIcp('Never analyzed');

    const response = await app.inject({ method: 'GET', url: `/api/icps/${icp.id}/analyses` });

    expect(response.statusCode).toBe(200);
    expect(parseBody<IcpAnalysisListDto>(response.payload).data).toMatchObject({
      items: [],
      total: 0,
    });
  });

  it('returns 404 for an unknown ICP', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/icps/${MISSING_ID}/analyses` });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/icps/:id/analyses/:analysisId', () => {
  it('returns one stored analysis', async () => {
    const icp = await createIcp('Single analysis');
    const created = parseBody<IcpAnalysisDto>((await analyze(icp.id)).payload).data;

    const response = await app.inject({
      method: 'GET',
      url: `/api/icps/${icp.id}/analyses/${created!.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<IcpAnalysisDto>(response.payload).data?.id).toBe(created!.id);
  });

  it('does not leak an analysis that belongs to another ICP', async () => {
    const first = await createIcp('Owner');
    const second = await createIcp('Other');
    const created = parseBody<IcpAnalysisDto>((await analyze(first.id)).payload).data;

    const response = await app.inject({
      method: 'GET',
      url: `/api/icps/${second.id}/analyses/${created!.id}`,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/model/health', () => {
  it('reports the provider health without running an analysis', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/model/health' });

    expect(response.statusCode).toBe(200);
    expect(parseBody<ModelProviderHealth>(response.payload).data).toMatchObject({
      available: true,
      provider: 'stub',
    });
    expect(provider.calls).toHaveLength(0);
  });
});

describe('the analysis flow leaves ICP behaviour untouched', () => {
  it('keeps /health describing the configured provider', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(parseBody<{ modelProvider: { id: string } }>(response.payload).data).toMatchObject({
      status: 'ok',
      analysisSchemaVersion: 'icp-analysis.v2',
      modelProvider: { id: 'stub' },
    });
  });

  it('does not add a version to the ICP when it is analyzed', async () => {
    const icp = await createIcp('Version count');
    await analyze(icp.id);

    expect(await repository.countVersions(icp.id)).toBe(1);
  });
});
