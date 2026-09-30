import { describe, expect, it, vi } from 'vitest';
import type { EnrichPersonInput } from '@pursuit/shared';
import { APOLLO_BULK_MATCH_MAX, ApolloClient } from '../src/modules/apollo/apollo-client.js';
import { ApolloPeopleEnrichmentService } from '../src/modules/apollo/apollo-people-enrichment-service.js';
import { apolloErrorResponse, apolloJsonResponse } from './apollo-fixtures.js';
import {
  apolloBulkMatchResponse,
  apolloEnrichedPerson,
} from './apollo-enrichment-fixtures.js';

/**
 * The Apollo enrichment adapter.
 *
 * Where the client suite asserts one request, this one asserts the behaviour
 * that only exists across several: how a set of people becomes batches, how the
 * results are joined back, and - the part that matters most - that one batch's
 * failure never becomes the whole run's.
 */

function service(fetchImpl: typeof fetch, apiKey = 'test-apollo-key') {
  return new ApolloPeopleEnrichmentService({
    client: new ApolloClient({
      apiKey,
      baseUrl: 'https://api.apollo.io',
      timeoutMs: 5000,
      maxAttempts: 1,
      retryBaseDelayMs: 0,
      fetchImpl,
      sleepImpl: () => Promise.resolve(),
    }),
  });
}

/** `n` people, each identified by their Apollo person id. */
function people(count: number): EnrichPersonInput[] {
  return Array.from({ length: count }, (_, index) => ({
    personRef: `apollo:person:p${String(index)}`,
    identity: {
      basis: 'PROVIDER_ID' as const,
      provider: 'apollo',
      externalPersonId: `p${String(index)}`,
    },
  }));
}

/** Answers each call from a queue, so batches can be given different outcomes. */
function sequence(responses: (() => Response)[]) {
  let call = 0;
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) => {
    const respond = responses[call] ?? responses[responses.length - 1];
    call += 1;
    return Promise.resolve(respond?.() ?? apolloJsonResponse({}));
  });
}

function matchesFor(count: number) {
  return apolloBulkMatchResponse(
    Array.from({ length: count }, (_, index) =>
      apolloEnrichedPerson({ id: `p${String(index)}` }),
    ),
  );
}

const OPTIONS = { revealPhoneNumbers: false };

describe('ApolloPeopleEnrichmentService - batching', () => {
  it('sends a batch of ten as one request', async () => {
    const fetchMock = sequence([() => apolloJsonResponse(matchesFor(APOLLO_BULK_MATCH_MAX))]);
    const result = await service(fetchMock).enrichPeople(people(APOLLO_BULK_MATCH_MAX), OPTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(APOLLO_BULK_MATCH_MAX);
  });

  it('splits eleven people into two requests', async () => {
    const fetchMock = sequence([
      () => apolloJsonResponse(matchesFor(APOLLO_BULK_MATCH_MAX)),
      () => apolloJsonResponse(matchesFor(1)),
    ]);
    const result = await service(fetchMock).enrichPeople(people(11), OPTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(11);
  });

  it('spends no request at all for an empty set', async () => {
    const fetchMock = sequence([() => apolloJsonResponse(matchesFor(1))]);
    const result = await service(fetchMock).enrichPeople([], OPTIONS);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('returns one prospect per input, joined on the person ref', async () => {
    const fetchMock = sequence([() => apolloJsonResponse(matchesFor(3))]);
    const result = await service(fetchMock).enrichPeople(people(3), OPTIONS);

    expect(result.map((prospect) => prospect.personRef)).toEqual([
      'apollo:person:p0',
      'apollo:person:p1',
      'apollo:person:p2',
    ]);
  });
});

describe('ApolloPeopleEnrichmentService - matching', () => {
  it('reports an unmatched slot as NO_MATCH without disturbing its neighbours', async () => {
    const fetchMock = sequence([
      () =>
        apolloJsonResponse(
          apolloBulkMatchResponse([
            apolloEnrichedPerson({ id: 'p0' }),
            null,
            apolloEnrichedPerson({ id: 'p2' }),
          ]),
        ),
    ]);
    const result = await service(fetchMock).enrichPeople(people(3), OPTIONS);

    // The positional join is what keeps the third person's contact details
    // attached to the third person.
    expect(result[0]?.enrichment.status).toBe('ENRICHED');
    expect(result[1]?.enrichment.status).toBe('NO_MATCH');
    expect(result[1]?.personRef).toBe('apollo:person:p1');
    expect(result[2]?.enrichment.status).toBe('ENRICHED');
    expect(result[2]?.externalPersonId).toBe('p2');
  });

  it('treats a short matches array as no-match for the missing tail', async () => {
    const fetchMock = sequence([
      () => apolloJsonResponse(apolloBulkMatchResponse([apolloEnrichedPerson({ id: 'p0' })])),
    ]);
    const result = await service(fetchMock).enrichPeople(people(3), OPTIONS);

    // Attributing one person's details to another is the worst thing this
    // stage could do; a missing no-match record costs only a retry.
    expect(result).toHaveLength(3);
    expect(result[1]?.enrichment.status).toBe('NO_MATCH');
    expect(result[2]?.enrichment.status).toBe('NO_MATCH');
  });

  it('keeps the person id on an unmatched record, so it stays traceable', async () => {
    const fetchMock = sequence([() => apolloJsonResponse(apolloBulkMatchResponse([null]))]);
    const result = await service(fetchMock).enrichPeople(people(1), OPTIONS);

    expect(result[0]?.externalPersonId).toBe('p0');
    expect(result[0]?.enrichment.matchConfidence).toBe('none');
  });
});

describe('ApolloPeopleEnrichmentService - failures', () => {
  it('never throws when the provider refuses the call', async () => {
    const fetchMock = sequence([() => apolloErrorResponse(500, 'Internal error')]);

    // A run that discovered real people and could not enrich them is still a
    // run with real people in it.
    await expect(service(fetchMock).enrichPeople(people(2), OPTIONS)).resolves.toHaveLength(2);
  });

  it('reports a plan or credential refusal as UNAVAILABLE, not FAILED', async () => {
    const fetchMock = sequence([
      () => apolloErrorResponse(403, 'This API key is not authorized', 'API_INACCESSIBLE'),
    ]);
    const result = await service(fetchMock).enrichPeople(people(1), OPTIONS);

    // The repair is in the Apollo console, not in a retry - a distinction that
    // is lost if both render as "failed".
    expect(result[0]?.enrichment.status).toBe('UNAVAILABLE');
    expect(result[0]?.enrichment.detail).toContain('not available for the current provider account');
  });

  it('reports a transport failure as FAILED, because retrying may work', async () => {
    const fetchMock = sequence([() => apolloErrorResponse(500, 'Internal error')]);
    const result = await service(fetchMock).enrichPeople(people(1), OPTIONS);

    expect(result[0]?.enrichment.status).toBe('FAILED');
  });

  it('reports a missing credential as UNAVAILABLE without spending a request', async () => {
    const fetchMock = sequence([() => apolloJsonResponse(matchesFor(1))]);
    const result = await service(fetchMock, '').enrichPeople(people(1), OPTIONS);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result[0]?.enrichment.status).toBe('UNAVAILABLE');
  });

  it('lets one batch fail without failing the others', async () => {
    const fetchMock = sequence([
      () => apolloJsonResponse(matchesFor(APOLLO_BULK_MATCH_MAX)),
      () => apolloErrorResponse(500, 'Internal error'),
      // 25 people become batches of 10, 10 and 5.
      () => apolloJsonResponse(matchesFor(5)),
    ]);
    const result = await service(fetchMock).enrichPeople(people(25), OPTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(25);
    // The batch that failed is the only one that failed - a 5xx on ten people
    // must not cost the other fifteen their contact details.
    expect(result.filter((prospect) => prospect.enrichment.status === 'ENRICHED')).toHaveLength(15);
    expect(result.filter((prospect) => prospect.enrichment.status === 'FAILED')).toHaveLength(10);
  });

  it('stops after a rate limit instead of hammering the exhausted window', async () => {
    const fetchMock = sequence([
      () => apolloJsonResponse(matchesFor(APOLLO_BULK_MATCH_MAX)),
      () => apolloErrorResponse(429, 'Too many requests'),
      () => apolloJsonResponse(matchesFor(APOLLO_BULK_MATCH_MAX)),
    ]);
    const result = await service(fetchMock).enrichPeople(people(25), OPTIONS);

    // Two calls, not three: asking again inside the window deepens the limit
    // while buying nothing.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(25);
    // The third batch is still accounted for, with the same reason.
    expect(result.filter((prospect) => prospect.enrichment.status === 'FAILED')).toHaveLength(15);
  });

  it('stops after a credential refusal, since every later batch would hit it too', async () => {
    const fetchMock = sequence([
      () => apolloErrorResponse(401, 'Unauthorized'),
      () => apolloJsonResponse(matchesFor(APOLLO_BULK_MATCH_MAX)),
    ]);
    const result = await service(fetchMock).enrichPeople(people(20), OPTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.every((prospect) => prospect.enrichment.status === 'UNAVAILABLE')).toBe(true);
  });

  it('reports a malformed response as FAILED rather than as empty enrichment', async () => {
    const fetchMock = sequence([() => apolloJsonResponse({ organizations: [] })]);
    const result = await service(fetchMock).enrichPeople(people(1), OPTIONS);

    expect(result[0]?.enrichment.status).toBe('FAILED');
  });

  it('never leaks a provider message into a frontend-facing detail', async () => {
    const fetchMock = sequence([
      () => apolloErrorResponse(500, 'connect ECONNREFUSED 10.0.0.1:5432 internal-apollo-host'),
    ]);
    const result = await service(fetchMock).enrichPeople(people(1), OPTIONS);

    expect(result[0]?.enrichment.detail).not.toContain('ECONNREFUSED');
    expect(result[0]?.enrichment.detail).not.toContain('internal-apollo-host');
  });
});

describe('ApolloPeopleEnrichmentService - descriptor', () => {
  it('reports the documented batch ceiling', async () => {
    const descriptor = service(sequence([() => apolloJsonResponse(matchesFor(1))]))
      .describeEnrichment();

    expect(descriptor.id).toBe('apollo');
    expect(descriptor.maxPageSize).toBe(APOLLO_BULK_MATCH_MAX);
    expect(descriptor.available).toBe(true);
    await Promise.resolve();
  });

  it('reports unavailable when no credential is configured', () => {
    const descriptor = service(
      sequence([() => apolloJsonResponse(matchesFor(1))]),
      '',
    ).describeEnrichment();

    expect(descriptor.available).toBe(false);
  });
});
