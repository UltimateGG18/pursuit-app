import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  IcpAnalysisDto,
  IcpProfileDto,
  ModelProviderDescriptor,
  ModelProviderHealth,
} from '@pursuit/shared';
import { createBody, createTestApp, parseBody } from './helpers.js';
import { validAnalysisOutput } from './analysis-fixtures.js';

/**
 * Provider selection, end to end through the real stack.
 *
 * Every other analysis test injects a stub provider, which proves the service
 * but says nothing about *which* provider the configuration resolves. Here the
 * app is booted with only environment variables, so the route, the service, the
 * registry and the adapter's actual HTTP call are all in the picture - and the
 * assertion that matters is where that call goes.
 *
 * The global fetch is stubbed rather than injected: the registry does not hand
 * the adapter a fetch, so this is the same code path production runs.
 */

const GROQ_ENV = {
  MODEL_PROVIDER: 'groq',
  GROQ_API_KEY: 'gsk-test-key',
  GROQ_MODEL: 'openai/gpt-oss-20b',
  GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
  GROQ_REASONING_EFFORT: 'low',
  MODEL_PROMPT_VERSION: 'v3',
};

let app: FastifyInstance;
let fetchMock: ReturnType<typeof vi.fn>;

function chatResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      model: GROQ_ENV.GROQ_MODEL,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(async () => {
  fetchMock = vi.fn().mockResolvedValue(chatResponse(JSON.stringify(validAnalysisOutput())));
  vi.stubGlobal('fetch', fetchMock);
  ({ app } = await createTestApp({ env: GROQ_ENV }));
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

async function createIcp(): Promise<IcpProfileDto> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/icps',
    payload: createBody('Provider selection'),
  });
  const created = parseBody<IcpProfileDto>(response.payload).data;
  if (!created) throw new Error('expected a created ICP');
  return created;
}

describe('MODEL_PROVIDER=groq', () => {
  it('is what /health reports, with the configured model', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    const body = parseBody<{ modelProvider: ModelProviderDescriptor }>(response.payload);
    expect(body.data?.modelProvider).toMatchObject({
      id: 'groq',
      version: 'openai/gpt-oss-20b',
      available: true,
    });
  });

  it('analyzes through the Groq API and stores the provider and model that answered', async () => {
    const icp = await createIcp();

    const response = await app.inject({ method: 'POST', url: `/api/icps/${icp.id}/analyze` });

    expect(response.statusCode).toBe(201);
    expect(parseBody<IcpAnalysisDto>(response.payload).data).toMatchObject({
      status: 'COMPLETED',
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      promptVersion: 'v3',
      analysisSchemaVersion: 'icp-analysis.v2',
    });
    expect(requestedUrls()).toEqual(['https://api.groq.com/openai/v1/chat/completions']);

    // The reasoning budget reaches the wire from configuration alone.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { reasoning_effort?: string };
    expect(body.reasoning_effort).toBe('low');
  });

  /**
   * The regression guard for this migration. Local inference is gone, and the
   * only way to be sure is to watch every request the analysis makes.
   */
  it('never calls a local model runtime', async () => {
    const icp = await createIcp();

    await app.inject({ method: 'POST', url: `/api/icps/${icp.id}/analyze` });
    await app.inject({ method: 'GET', url: '/api/model/health' });

    expect(requestedUrls().length).toBeGreaterThan(0);
    for (const url of requestedUrls()) {
      expect(url.startsWith('https://api.groq.com/')).toBe(true);
      expect(url).not.toContain('11434');
      expect(url).not.toContain('localhost');
      expect(url).not.toContain('127.0.0.1');
    }
  });

  it('reports Groq configuration status on the model health endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'openai/gpt-oss-20b', object: 'model' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await app.inject({ method: 'GET', url: '/api/model/health' });

    expect(response.statusCode).toBe(200);
    expect(parseBody<ModelProviderHealth>(response.payload).data).toMatchObject({
      available: true,
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
    });
  });
});

describe('MODEL_PROVIDER=groq with no API key', () => {
  /**
   * The API has to keep working so it can *report* the missing key. Failing to
   * boot would leave an operator with nothing to read.
   */
  it('boots, serves ICPs, and reports the missing key without calling Groq', async () => {
    await app.close();
    ({ app } = await createTestApp({ env: { ...GROQ_ENV, GROQ_API_KEY: '' } }));
    fetchMock.mockClear();

    const icp = await createIcp();
    expect(icp.id).toBeTruthy();

    const health = await app.inject({ method: 'GET', url: '/api/model/health' });
    const body = parseBody<ModelProviderHealth>(health.payload);
    expect(body.data).toMatchObject({ available: false, provider: 'groq' });
    expect(body.data?.detail).toContain('GROQ_API_KEY');

    const analysis = await app.inject({ method: 'POST', url: `/api/icps/${icp.id}/analyze` });
    expect(analysis.statusCode).toBe(503);
    const error = parseBody(analysis.payload).error;
    expect(error?.code).toBe('MODEL_PROVIDER_UNAVAILABLE');
    expect(error?.message).toContain('GROQ_API_KEY');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
