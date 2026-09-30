import { describe, expect, it } from 'vitest';
import {
  DiscoveryRateLimitError,
  type PeopleDiscoveryProvider,
  type PeopleSearchResult,
  type PersonCandidate,
  type ProspectRunDto,
} from '@pursuit/shared';
import { InMemoryCandidateRepository } from '../src/modules/discovery/in-memory-candidate-repository.js';
import { createBody, createTestApp, parseBody, type TestAppOptions } from './helpers.js';
import { company, person } from './candidate-fixtures.js';

/**
 * `POST /api/icps/:id/prospects`, with the processing stage attached.
 *
 * The existing suite covers the search itself - the envelope, the pagination,
 * the provider failures. This one covers what the same endpoint now also
 * returns, and the two properties that make it safe to return it:
 *
 *  - the *discovered* list is never narrowed, so pagination keeps describing
 *    the result set the caller paid for;
 *  - nothing that reaches a client carries a provider message, a credential or
 *    a database error, however the run went.
 */

function provider(people: PersonCandidate[]): PeopleDiscoveryProvider {
  return {
    describePeople: () => ({
      id: 'apollo',
      displayName: 'Apollo people search (API v1)',
      version: 'v1',
      maxPageSize: 100,
      available: true,
    }),
    peopleHealthCheck: () =>
      Promise.resolve({
        available: true,
        provider: 'apollo',
        checkedAt: new Date().toISOString(),
        detail: 'Apollo API reachable.',
      }),
    searchPeople: (): Promise<PeopleSearchResult> =>
      Promise.resolve({
        people,
        pagination: {
          page: 1,
          perPage: 25,
          totalEntries: people.length,
          totalPages: 1,
          hasMore: false,
        },
        duplicatesRemoved: 0,
      }),
  };
}

async function run(
  people: PersonCandidate[],
  options: Omit<TestAppOptions, 'peopleProvider'> = {},
): Promise<{ context: Awaited<ReturnType<typeof createTestApp>>; body: ProspectRunDto }> {
  const context = await createTestApp({ ...options, peopleProvider: provider(people) });
  const created = await context.app.inject({
    method: 'POST',
    url: '/api/icps',
    payload: createBody('Processing Target ICP'),
  });
  const id = parseBody<{ id: string }>(created.payload).data?.id ?? '';

  const response = await context.app.inject({
    method: 'POST',
    url: `/api/icps/${id}/prospects`,
  });
  expect(response.statusCode).toBe(200);
  const body = parseBody<ProspectRunDto>(response.payload).data;
  if (!body) throw new Error('expected a prospect run');
  return { context, body };
}

/** The example ICP targets financial services, logistics and manufacturing. */
const financial = company({ industryCodes: ['FINANCIAL_SERVICES'], industry: 'financial services' });

describe('prospect processing - the response', () => {
  it('returns survivors and the cold pool alongside the discovered people', async () => {
    const { body } = await run([
      person('p1', { company: financial }),
      person('p2', { company: company({ externalId: 'org-b', domain: 'ander.nl', country: 'DE' }) }),
    ]);

    // Never narrowed: the pagination describes this list, and a filtered
    // `people` would make the page totals describe a set the caller cannot see.
    expect(body.people).toHaveLength(2);
    expect(body.processing.survivors).toHaveLength(1);
    expect(body.processing.rejected).toHaveLength(1);
    expect(body.processing.counts.received).toBe(2);
  });

  it('joins the two halves on the source reference the UI already keys rows by', async () => {
    const { body } = await run([person('p1', { company: financial })]);

    const refs = new Set(body.people.map((entry) => entry.rawSourceRef));
    for (const candidate of [...body.processing.survivors, ...body.processing.rejected]) {
      expect(refs.has(candidate.personRef)).toBe(true);
    }
  });

  it('includes a structured reason for every rejected candidate', async () => {
    const { body } = await run([
      person('p1', { company: company({ country: 'DE', employeeCount: 3 }) }),
    ]);

    const rejected = body.processing.rejected[0];
    expect(rejected?.state).toBe('COLD');
    expect(rejected?.rejections.length).toBeGreaterThan(0);
    for (const rejection of rejected?.rejections ?? []) {
      expect(rejection.reason).toMatch(/^[A-Z_]+$/);
      expect(rejection.detail.length).toBeGreaterThan(0);
    }
  });

  it('returns the canonical companies the candidates resolve to', async () => {
    const { body } = await run([
      person('p1', { company: financial }),
      person('p2', { company: financial }),
    ]);

    expect(body.processing.companies).toHaveLength(1);
    expect(body.processing.companies[0]?.domain).toBe('voorbeeld-software.nl');
    expect(body.processing.counts.companiesResolved).toBe(1);
  });

  it('names the hard criteria it could not evaluate', async () => {
    const { body } = await run([person('p1', { company: financial })]);

    expect(body.processing.unsupportedHardCriteria?.join(' ')).toContain('technology');
  });

  it('carries no score, band or ranking anywhere in the response', async () => {
    const { body } = await run([person('p1', { company: financial })]);

    const serialized = JSON.stringify(body.processing).toLowerCase();
    for (const forbidden of ['score', 'rank', 'band', 'confidence', 'probability']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('prospect processing - persistence', () => {
  it('records the run when a store is configured', async () => {
    const repository = new InMemoryCandidateRepository();
    const { body } = await run([person('p1', { company: financial })], {
      candidateRepository: repository,
    });

    expect(body.processing.persistence.persisted).toBe(true);
    expect(repository.lastRun?.candidates).toHaveLength(1);
    expect(repository.lastRun?.icpVersion).toBe(1);
  });

  it('serves the results and says they were not stored when the write fails', async () => {
    const repository = new InMemoryCandidateRepository();
    repository.failWith = new Error(
      'connect ECONNREFUSED postgresql://pursuit:hunter2@10.0.0.4:5432/pursuit',
    );
    const { body } = await run([person('p1', { company: financial })], {
      candidateRepository: repository,
    });

    // 200, with the results: the provider credit is spent and the answer is
    // correct. But the client is told plainly that nothing was recorded.
    expect(body.processing.survivors).toHaveLength(1);
    expect(body.processing.persistence.persisted).toBe(false);

    // And the driver's message - which carried a host, a port and a password -
    // stays in the log.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('10.0.0.4');
    expect(serialized).not.toContain('ECONNREFUSED');
  });

  it('reports no persistence when the process has no store at all', async () => {
    const { body } = await run([person('p1', { company: financial })]);

    expect(body.processing.persistence.persisted).toBe(false);
    expect(body.processing.persistence.searchRunId).toBeUndefined();
  });
});

describe('prospect processing - failures short-circuit it', () => {
  it('returns the provider failure, and no processing block, when the search fails', async () => {
    const context = await createTestApp({
      peopleProvider: {
        ...provider([]),
        searchPeople: () =>
          Promise.reject(new DiscoveryRateLimitError('apollo', 'sk-secret rate limited', 30)),
      },
    });
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/icps',
      payload: createBody('Failing ICP'),
    });
    const id = parseBody<{ id: string }>(created.payload).data?.id ?? '';

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/icps/${id}/prospects`,
    });

    expect(response.statusCode).toBe(429);
    expect(response.payload).not.toContain('sk-secret');
    expect(parseBody(response.payload).data).toBeNull();
  });

  it('rejects an unknown ICP before any processing happens', async () => {
    const context = await createTestApp({ peopleProvider: provider([person('p1')]) });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/icps/99999999-9999-4999-8999-999999999999/prospects',
    });

    expect(response.statusCode).toBe(404);
    expect(context.candidates.runs).toHaveLength(0);
  });
});
