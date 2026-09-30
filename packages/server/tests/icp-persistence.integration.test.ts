import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { IcpProfileDto, IcpProfileListDto } from '@pursuit/shared';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { PrismaIcpRepository } from '../src/modules/icp/prisma-icp-repository.js';
import { PrismaIcpAnalysisRepository } from '../src/modules/icp/prisma-icp-analysis-repository.js';
import { createBody, detailPaths, exampleConfig, parseBody } from './helpers.js';

/**
 * Full-stack persistence test: HTTP -> Zod -> normalization -> Prisma ->
 * PostgreSQL. It runs only when a database is reachable, so the suite still
 * passes on a machine without one.
 *
 *   npm run db:up && npm run prisma:deploy
 */
const envResult = loadEnv(process.env);
const databaseUrl = envResult.ok ? envResult.env.DATABASE_URL : undefined;

async function databaseIsReachable(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  const probe = new PrismaClient({ datasources: { db: { url } } });
  try {
    await probe.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

const reachable = await databaseIsReachable(databaseUrl);

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(
    '[icp-persistence] skipped: no reachable PostgreSQL. Run `npm run db:up && npm run prisma:deploy` to enable.',
  );
}

describe.skipIf(!reachable)('ICP persistence against PostgreSQL', () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl!,
      LOG_LEVEL: 'silent',
    });
    if (!env.ok) throw new Error(env.messages.join(', '));
    app = await buildApp({
      env: env.env,
      icpRepository: new PrismaIcpRepository(prisma),
      analysisRepository: new PrismaIcpAnalysisRepository(prisma),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    // Version rows cascade with the profile.
    await prisma.iCPProfile.deleteMany({});
  });

  async function create(name: string): Promise<IcpProfileDto> {
    const response = await app.inject({ method: 'POST', url: '/api/icps', payload: createBody(name) });
    expect(response.statusCode).toBe(201);
    const created = parseBody<IcpProfileDto>(response.payload).data;
    if (!created) throw new Error('expected a created ICP');
    return created;
  }

  it('writes the profile and its first version row', async () => {
    const created = await create('Persisted icp');

    const row = await prisma.iCPProfile.findUniqueOrThrow({
      where: { id: created.id },
      include: { versions: true },
    });

    expect(row).toMatchObject({
      name: 'Persisted icp',
      slug: 'persisted-icp',
      version: 1,
      status: 'ACTIVE',
      schemaVersion: 'icp.v1',
      deletedAt: null,
    });
    expect(row.versions).toHaveLength(1);
    expect(row.versions[0]).toMatchObject({ version: 1, status: 'ACTIVE' });
  });

  it('stores the normalized config and the submitted config separately', async () => {
    const config = exampleConfig('Audit icp');
    config.geography.includedCountries = ['LU', 'BE', 'NL'];

    const response = await app.inject({ method: 'POST', url: '/api/icps', payload: { config } });
    const created = parseBody<IcpProfileDto>(response.payload).data!;

    const row = await prisma.iCPProfile.findUniqueOrThrow({ where: { id: created.id } });
    const stored = row.config as unknown as typeof config;
    const submitted = row.submittedConfig as unknown as typeof config;

    expect(stored.geography.includedCountries).toEqual(['NL', 'BE', 'LU']);
    expect(submitted.geography.includedCountries).toEqual(['LU', 'BE', 'NL']);
    expect(row.scoringWeights).toMatchObject({ ICP_FIT: 20, EVIDENCE: 5 });
  });

  it('reads a stored profile back through the API', async () => {
    const created = await create('Readback icp');

    const response = await app.inject({ method: 'GET', url: `/api/icps/${created.id}` });
    expect(response.statusCode).toBe(200);
    const fetched = parseBody<IcpProfileDto>(response.payload).data;

    expect(fetched?.config).toEqual(created.config);
    expect(fetched?.config.mustNiceExclude.mustHave[0]?.values).toEqual(['BE', 'LU', 'NL']);
  });

  it('lists stored profiles newest first', async () => {
    await create('Older icp');
    await create('Newer icp');

    const response = await app.inject({ method: 'GET', url: '/api/icps' });
    const data = parseBody<IcpProfileListDto>(response.payload).data;

    expect(data?.total).toBe(2);
    expect(data?.items.map((item) => item.name)).toEqual(['Newer icp', 'Older icp']);
  });

  it('appends a version on update and keeps every submitted config', async () => {
    const created = await create('Versioned icp');

    const config = exampleConfig('Versioned icp');
    config.companyProfile.employeeRange = { min: 1000, max: 20000 };
    const response = await app.inject({
      method: 'PUT',
      url: `/api/icps/${created.id}`,
      payload: { config, changeReason: 'Widened the size band' },
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<IcpProfileDto>(response.payload).data?.version).toBe(2);

    const versions = await prisma.iCPProfileVersion.findMany({
      where: { icpProfileId: created.id },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((version) => version.version)).toEqual([1, 2]);

    const first = versions[0]!.submittedConfig as unknown as typeof config;
    const second = versions[1]!.submittedConfig as unknown as typeof config;
    expect(first.companyProfile.employeeRange).toEqual({ min: 200, max: 5000 });
    expect(second.companyProfile.employeeRange).toEqual({ min: 1000, max: 20000 });
    expect(versions[1]!.changeReason).toBe('Widened the size band');
  });

  it('rejects a duplicate name with a conflict and stores nothing extra', async () => {
    await create('Unique icp');

    const response = await app.inject({
      method: 'POST',
      url: '/api/icps',
      payload: createBody('Unique icp'),
    });

    expect(response.statusCode).toBe(409);
    expect(detailPaths(parseBody(response.payload))).toContain('config.basicProfile.name');
    expect(await prisma.iCPProfile.count()).toBe(1);
  });

  it('rejects an invalid payload before touching the database', async () => {
    const config = exampleConfig('Invalid icp');
    config.targetBuyer.seniorities = [];

    const response = await app.inject({ method: 'POST', url: '/api/icps', payload: { config } });

    expect(response.statusCode).toBe(400);
    expect(await prisma.iCPProfile.count()).toBe(0);
  });

  it('archives on delete and keeps the version history recoverable', async () => {
    const created = await create('Archivable icp');

    const response = await app.inject({ method: 'DELETE', url: `/api/icps/${created.id}` });
    expect(response.statusCode).toBe(200);

    const row = await prisma.iCPProfile.findUniqueOrThrow({
      where: { id: created.id },
      include: { versions: true },
    });
    expect(row.status).toBe('ARCHIVED');
    expect(row.deletedAt).not.toBeNull();
    expect(row.versions).toHaveLength(1);

    // Archived profiles disappear from reads but the row is still there.
    expect((await app.inject({ method: 'GET', url: `/api/icps/${created.id}` })).statusCode).toBe(404);
    expect(parseBody<IcpProfileListDto>((await app.inject({ method: 'GET', url: '/api/icps' })).payload).data?.total).toBe(0);
  });
});
