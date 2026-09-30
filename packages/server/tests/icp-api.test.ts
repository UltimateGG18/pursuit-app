import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { IcpProfileDto, IcpProfileListDto } from '@pursuit/shared';
import { createBody, createTestApp, detailPaths, exampleConfig, parseBody } from './helpers.js';
import type { InMemoryIcpRepository } from '../src/modules/icp/in-memory-icp-repository.js';

let app: FastifyInstance;
let repository: InMemoryIcpRepository;

beforeEach(async () => {
  ({ app, repository } = await createTestApp());
});

afterEach(async () => {
  await app.close();
});

async function createIcp(name?: string): Promise<IcpProfileDto> {
  const response = await app.inject({ method: 'POST', url: '/api/icps', payload: createBody(name) });
  expect(response.statusCode).toBe(201);
  const body = parseBody<IcpProfileDto>(response.payload);
  if (!body.data) throw new Error('expected a created ICP');
  return body.data;
}

describe('POST /api/icps - valid submission', () => {
  it('creates the profile at version 1 and returns it', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/icps', payload: createBody() });

    expect(response.statusCode).toBe(201);
    const body = parseBody<IcpProfileDto>(response.payload);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      name: 'Benelux mid-market platform modernization',
      slug: 'benelux-mid-market-platform-modernization',
      version: 1,
      status: 'ACTIVE',
      schemaVersion: 'icp.v1',
    });
    expect(body.data?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('normalizes the stored configuration', async () => {
    const config = exampleConfig();
    config.basicProfile.name = '  Normalization   check  ';
    config.geography.includedCountries = ['LU', 'BE', 'NL', 'NL'];

    const response = await app.inject({
      method: 'POST',
      url: '/api/icps',
      payload: { config },
    });

    expect(response.statusCode).toBe(201);
    const created = parseBody<IcpProfileDto>(response.payload).data;
    expect(created?.name).toBe('Normalization check');
    expect(created?.config.geography.includedCountries).toEqual(['NL', 'BE', 'LU']);
  });

  it('keeps the submitted configuration exactly as sent', async () => {
    const config = exampleConfig('Audit trail check');
    config.geography.includedCountries = ['LU', 'BE', 'NL'];

    const response = await app.inject({ method: 'POST', url: '/api/icps', payload: { config } });
    const created = parseBody<IcpProfileDto>(response.payload).data;

    expect(created?.submittedConfig).toEqual(config);
    expect(created?.config.geography.includedCountries).toEqual(['NL', 'BE', 'LU']);
  });

  it('records defaulted scoring weights with the profile', async () => {
    const created = await createIcp('Weights check');
    expect(created.scoringWeights).toEqual({
      ICP_FIT: 20,
      BUSINESS_FIT: 15,
      NEED: 20,
      INTENT: 20,
      TIMING: 10,
      OPPORTUNITY: 10,
      EVIDENCE: 5,
    });
  });

  it('honours an explicit INACTIVE status', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/icps',
      payload: createBody('Inactive icp', { status: 'INACTIVE' }),
    });
    expect(parseBody<IcpProfileDto>(response.payload).data?.status).toBe('INACTIVE');
  });

  it('rejects a duplicate ICP name with a conflict', async () => {
    await createIcp('Duplicate name');
    const response = await app.inject({
      method: 'POST',
      url: '/api/icps',
      payload: createBody('Duplicate name'),
    });

    expect(response.statusCode).toBe(409);
    const body = parseBody<never>(response.payload);
    expect(body).toMatchObject({ success: false, data: null });
    expect(body.error?.code).toBe('CONFLICT');
    expect(detailPaths(body)).toContain('config.basicProfile.name');
  });
});

describe('POST /api/icps - invalid submission', () => {
  it('returns 400 with field-addressable details', async () => {
    const config = exampleConfig();
    config.basicProfile.name = '';
    config.geography.includedCountries = [];
    config.mustNiceExclude.mustHave = [];

    const response = await app.inject({ method: 'POST', url: '/api/icps', payload: { config } });

    expect(response.statusCode).toBe(400);
    const body = parseBody<never>(response.payload);
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(detailPaths(body)).toEqual(
      expect.arrayContaining([
        'config.basicProfile.name',
        'config.geography.includedCountries',
        'config.mustNiceExclude.mustHave',
      ]),
    );
  });

  it('reports invalid enum values', async () => {
    const config = exampleConfig() as unknown as { companyProfile: { industries: string[] } };
    config.companyProfile.industries = ['NOT_AN_INDUSTRY'];

    const response = await app.inject({ method: 'POST', url: '/api/icps', payload: { config } });
    expect(response.statusCode).toBe(400);
    expect(detailPaths(parseBody(response.payload))).toContain('config.companyProfile.industries[0]');
  });

  it('reports an invalid rule structure', async () => {
    const config = exampleConfig();
    config.mustNiceExclude.mustHave = [
      {
        id: 'r1',
        field: 'company.country',
        operator: 'BETWEEN',
        range: { min: 1, max: 2 },
        unknownHandling: 'TREAT_AS_UNKNOWN',
      },
    ];

    const response = await app.inject({ method: 'POST', url: '/api/icps', payload: { config } });
    expect(response.statusCode).toBe(400);
    expect(detailPaths(parseBody(response.payload))).toContain(
      'config.mustNiceExclude.mustHave[0].operator',
    );
  });

  it('rejects a missing body', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/icps' });
    expect(response.statusCode).toBe(400);
    expect(parseBody(response.payload).success).toBe(false);
  });

  it('rejects malformed JSON with the shared error envelope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/icps',
      headers: { 'content-type': 'application/json' },
      payload: '{"config":',
    });

    expect(response.statusCode).toBe(400);
    const body = parseBody(response.payload);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('persists nothing when validation fails', async () => {
    const config = exampleConfig();
    config.basicProfile.name = '';
    await app.inject({ method: 'POST', url: '/api/icps', payload: { config } });

    const list = await app.inject({ method: 'GET', url: '/api/icps' });
    expect(parseBody<IcpProfileListDto>(list.payload).data?.total).toBe(0);
  });
});

describe('GET /api/icps', () => {
  it('returns an empty page when nothing is stored', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/icps' });
    expect(response.statusCode).toBe(200);
    expect(parseBody<IcpProfileListDto>(response.payload).data).toEqual({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
  });

  it('lists summaries newest first', async () => {
    await createIcp('First icp');
    await createIcp('Second icp');

    const response = await app.inject({ method: 'GET', url: '/api/icps' });
    const data = parseBody<IcpProfileListDto>(response.payload).data;

    expect(data?.total).toBe(2);
    expect(data?.items.map((item) => item.name)).toEqual(['Second icp', 'First icp']);
    expect(data?.items[0]).toMatchObject({ version: 1, status: 'ACTIVE', priority: 'P0' });
    expect(data?.items[0]).not.toHaveProperty('config');
  });

  it('paginates and filters', async () => {
    await createIcp('Alpha icp');
    await createIcp('Beta icp');
    await createIcp('Gamma icp');

    const page = await app.inject({ method: 'GET', url: '/api/icps?limit=2&offset=1' });
    const pageData = parseBody<IcpProfileListDto>(page.payload).data;
    expect(pageData?.total).toBe(3);
    expect(pageData?.items).toHaveLength(2);
    expect(pageData?.limit).toBe(2);
    expect(pageData?.offset).toBe(1);

    const search = await app.inject({ method: 'GET', url: '/api/icps?search=beta' });
    expect(parseBody<IcpProfileListDto>(search.payload).data?.items.map((i) => i.name)).toEqual([
      'Beta icp',
    ]);
  });

  it('rejects an invalid query parameter', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/icps?limit=999' });
    expect(response.statusCode).toBe(400);
    expect(detailPaths(parseBody(response.payload))).toContain('limit');
  });
});

describe('GET /api/icps/:id', () => {
  it('returns the full profile including its configuration', async () => {
    const created = await createIcp('Retrieval check');
    const response = await app.inject({ method: 'GET', url: `/api/icps/${created.id}` });

    expect(response.statusCode).toBe(200);
    const body = parseBody<IcpProfileDto>(response.payload);
    expect(body.data?.id).toBe(created.id);
    expect(body.data?.config.basicProfile.name).toBe('Retrieval check');
    expect(body.data?.config.mustNiceExclude.mustHave).toHaveLength(2);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/icps/11111111-1111-4111-8111-111111111111',
    });
    expect(response.statusCode).toBe(404);
    expect(parseBody(response.payload).error?.code).toBe('NOT_FOUND');
  });

  it('returns 400 for an id that is not a UUID', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/icps/not-a-uuid' });
    expect(response.statusCode).toBe(400);
    const body = parseBody(response.payload);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(detailPaths(body)).toContain('id');
  });
});

describe('PUT /api/icps/:id', () => {
  it('stores the update as a new version', async () => {
    const created = await createIcp('Versioned icp');

    const config = exampleConfig('Versioned icp');
    config.companyProfile.employeeRange = { min: 500, max: 9000 };

    const response = await app.inject({
      method: 'PUT',
      url: `/api/icps/${created.id}`,
      payload: { config, changeReason: 'Widened the size band' },
    });

    expect(response.statusCode).toBe(200);
    const updated = parseBody<IcpProfileDto>(response.payload).data;
    expect(updated?.version).toBe(2);
    expect(updated?.changeReason).toBe('Widened the size band');
    expect(updated?.config.companyProfile.employeeRange).toEqual({ min: 500, max: 9000 });
    expect(await repository.countVersions(created.id)).toBe(2);
  });

  it('keeps the configuration submitted for every earlier version', async () => {
    const created = await createIcp('History icp');
    const config = exampleConfig('History icp');
    config.companyProfile.employeeRange = { min: 10, max: 20 };

    await app.inject({ method: 'PUT', url: `/api/icps/${created.id}`, payload: { config } });

    const first = repository.submittedConfigForVersion(created.id, 1) as typeof config;
    const second = repository.submittedConfigForVersion(created.id, 2) as typeof config;
    expect(first.companyProfile.employeeRange).toEqual({ min: 200, max: 5000 });
    expect(second.companyProfile.employeeRange).toEqual({ min: 10, max: 20 });
  });

  it('can rename an ICP and can toggle it inactive', async () => {
    const created = await createIcp('Original name');
    const response = await app.inject({
      method: 'PUT',
      url: `/api/icps/${created.id}`,
      payload: { config: exampleConfig('Renamed icp'), status: 'INACTIVE' },
    });

    const updated = parseBody<IcpProfileDto>(response.payload).data;
    expect(updated?.name).toBe('Renamed icp');
    expect(updated?.slug).toBe('renamed-icp');
    expect(updated?.status).toBe('INACTIVE');
  });

  it('rejects a rename onto another ICP name', async () => {
    await createIcp('Taken name');
    const other = await createIcp('Other name');

    const response = await app.inject({
      method: 'PUT',
      url: `/api/icps/${other.id}`,
      payload: { config: exampleConfig('Taken name') },
    });

    expect(response.statusCode).toBe(409);
    expect(parseBody(response.payload).error?.code).toBe('CONFLICT');
  });

  it('returns 400 for an invalid payload and leaves the stored version untouched', async () => {
    const created = await createIcp('Untouched icp');
    const config = exampleConfig('Untouched icp');
    config.targetBuyer.departments = [];

    const response = await app.inject({
      method: 'PUT',
      url: `/api/icps/${created.id}`,
      payload: { config },
    });

    expect(response.statusCode).toBe(400);
    expect(detailPaths(parseBody(response.payload))).toContain('config.targetBuyer.departments');

    const stored = await app.inject({ method: 'GET', url: `/api/icps/${created.id}` });
    expect(parseBody<IcpProfileDto>(stored.payload).data?.version).toBe(1);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/icps/11111111-1111-4111-8111-111111111111',
      payload: createBody(),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /api/icps/:id', () => {
  it('archives the profile and removes it from reads', async () => {
    const created = await createIcp('Deletable icp');

    const response = await app.inject({ method: 'DELETE', url: `/api/icps/${created.id}` });
    expect(response.statusCode).toBe(200);
    expect(parseBody<{ status: string }>(response.payload).data?.status).toBe('ARCHIVED');

    const get = await app.inject({ method: 'GET', url: `/api/icps/${created.id}` });
    expect(get.statusCode).toBe(404);

    const list = await app.inject({ method: 'GET', url: '/api/icps' });
    expect(parseBody<IcpProfileListDto>(list.payload).data?.total).toBe(0);
  });

  it('retains the stored version history after a delete', async () => {
    const created = await createIcp('Retained icp');
    await app.inject({ method: 'DELETE', url: `/api/icps/${created.id}` });
    expect(await repository.countVersions(created.id)).toBe(1);
  });

  it('frees the name for reuse', async () => {
    const created = await createIcp('Recyclable name');
    await app.inject({ method: 'DELETE', url: `/api/icps/${created.id}` });

    const response = await app.inject({
      method: 'POST',
      url: '/api/icps',
      payload: createBody('Recyclable name'),
    });
    expect(response.statusCode).toBe(201);
  });

  it('returns 404 when deleting twice', async () => {
    const created = await createIcp('Twice deleted');
    await app.inject({ method: 'DELETE', url: `/api/icps/${created.id}` });
    const second = await app.inject({ method: 'DELETE', url: `/api/icps/${created.id}` });
    expect(second.statusCode).toBe(404);
  });
});

describe('cross-cutting API behaviour', () => {
  it('reports health and states that no model provider is connected', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = parseBody<{
      status: string;
      icpSchemaVersion: string;
      modelProvider: { id: string; available: boolean };
    }>(response.payload);
    expect(body.data).toMatchObject({
      status: 'ok',
      icpSchemaVersion: 'icp.v1',
      modelProvider: { id: 'none', available: false },
    });
  });

  it('uses the shared envelope for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(parseBody(response.payload)).toMatchObject({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('echoes a correlation id back to the caller', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'trace-123' },
    });
    expect(response.headers['x-request-id']).toBe('trace-123');
  });
});
