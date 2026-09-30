import { describe, expect, it } from 'vitest';
import {
  reachabilityFor,
  type EnrichPersonInput,
  type EnrichedProspect,
  type PeopleDiscoveryProvider,
  type PeopleEnrichmentProvider,
  type PersonCandidate,
  type ProspectEnrichmentStatus,
  type ProspectRunDto,
} from '@pursuit/shared';
import { createBody, createTestApp, parseBody } from './helpers.js';

/**
 * `POST /api/icps/:id/prospects` with contact enrichment, end to end.
 *
 * Drives the real Fastify app - routes, validation, error handler and response
 * envelope - against stubbed providers, so the HTTP contract is tested without
 * an Apollo credential or a credit.
 *
 * The assertions split into two halves. One is that the contact data actually
 * reaches the client in the provider-neutral shape. The other is everything
 * that must *not* reach it: no credential, no provider payload, no endpoint
 * path, no header.
 */

const PERSON: PersonCandidate = {
  providerRefs: [{ provider: 'apollo', externalId: '6a1b2c3d4e5f60718293a4b5' }],
  name: 'Sanne de Vries',
  title: 'Chief Technology Officer',
  seniority: 'c_suite',
  seniorityCodes: ['C_LEVEL'],
  department: 'information_technology',
  location: 'Utrecht, Utrecht, Netherlands',
  linkedinUrl: 'https://www.linkedin.com/in/sanne-de-vries',
  emailStatus: 'verified',
  company: {
    externalId: '5f2a1b3c4d5e6f7a8b9c0d1e',
    name: 'Voorbeeld Software B.V.',
    domain: 'voorbeeld-software.nl',
    // Deliberately no `industryCodes` and no `country`: the example ICP this
    // suite runs against targets a different industry, and the point of these
    // tests is enrichment rather than filtering. A criterion with nothing to
    // compare abstains, which is exactly the "missing is unknown, not a
    // mismatch" rule the filtering stage already has its own suite for.
    industry: 'information technology & services',
    employeeCount: 240,
  },
  rawSourceRef: 'apollo:person:6a1b2c3d4e5f60718293a4b5',
};

function peopleProvider(people: PersonCandidate[] = [PERSON]): PeopleDiscoveryProvider {
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
    searchPeople: () =>
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

function enriched(personRef: string): EnrichedProspect {
  const linkedinUrl = 'https://www.linkedin.com/in/sanne-de-vries';
  const workEmail = 'sanne.de.vries@example.com';
  const phoneNumbers = [{ number: '+31205550142', type: 'mobile', status: 'valid_number' }];

  return {
    personRef,
    provider: 'apollo',
    externalPersonId: '6a1b2c3d4e5f60718293a4b5',
    externalOrganizationId: '5f2a1b3c4d5e6f7a8b9c0d1e',
    person: {
      firstName: 'Sanne',
      lastName: 'de Vries',
      fullName: 'Sanne de Vries',
      title: 'Chief Technology Officer',
      seniority: 'c_suite',
      linkedinUrl,
      location: 'Utrecht, Utrecht, Netherlands',
    },
    company: {
      name: 'Voorbeeld Software B.V.',
      domain: 'voorbeeld-software.nl',
      organizationId: '5f2a1b3c4d5e6f7a8b9c0d1e',
    },
    contact: {
      workEmail,
      emailStatus: 'verified',
      phoneNumbers,
      phoneState: 'AVAILABLE',
    },
    enrichment: {
      status: 'ENRICHED',
      matchConfidence: 'high',
      provider: 'apollo',
      enrichedAt: '2026-09-16T10:00:00.000Z',
    },
    reachability: reachabilityFor({ linkedinUrl, workEmail, phoneNumbers }),
  };
}

function refused(personRef: string, status: ProspectEnrichmentStatus): EnrichedProspect {
  return {
    personRef,
    provider: 'apollo',
    person: {},
    company: {},
    contact: { phoneNumbers: [], phoneState: 'NOT_REQUESTED' },
    enrichment: {
      status,
      provider: 'apollo',
      detail: 'Contact enrichment is not available for the current provider account.',
    },
    reachability: { hasLinkedIn: false, hasWorkEmail: false, hasPhone: false, channels: [] },
  };
}

function enrichmentProvider(
  answer: (people: readonly EnrichPersonInput[]) => EnrichedProspect[],
): PeopleEnrichmentProvider {
  return {
    describeEnrichment: () => ({
      id: 'apollo',
      displayName: 'Apollo people enrichment (API v1)',
      version: 'v1',
      maxPageSize: 10,
      available: true,
    }),
    enrichPeople: (people) => Promise.resolve(answer(people)),
  };
}

async function runSearch(provider: PeopleEnrichmentProvider, people: PersonCandidate[] = [PERSON]) {
  const context = await createTestApp({
    peopleProvider: peopleProvider(people),
    enrichmentProvider: provider,
  });

  const created = await context.app.inject({
    method: 'POST',
    url: '/api/icps',
    payload: createBody('Enrichment ICP'),
  });
  const icpId = parseBody<{ id: string }>(created.payload).data?.id ?? '';

  const response = await context.app.inject({
    method: 'POST',
    url: `/api/icps/${icpId}/prospects`,
    payload: {},
  });

  return { context, response, body: parseBody<ProspectRunDto>(response.payload) };
}

describe('prospect search with enrichment - the response', () => {
  it('returns the enrichment block inside the success envelope', async () => {
    const { response, body } = await runSearch(
      enrichmentProvider((people) => people.map((entry) => enriched(entry.personRef))),
    );

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data?.processing.enrichment?.version).toBe('prospect-enrichment.v1');
  });

  it('carries the LinkedIn URL, work email and phone numbers', async () => {
    const { body } = await runSearch(
      enrichmentProvider((people) => people.map((entry) => enriched(entry.personRef))),
    );

    const prospect = body.data?.processing.enrichment?.prospects[0];
    expect(prospect?.person.linkedinUrl).toBe('https://www.linkedin.com/in/sanne-de-vries');
    expect(prospect?.contact.workEmail).toBe('sanne.de.vries@example.com');
    expect(prospect?.contact.phoneNumbers).toEqual([
      { number: '+31205550142', type: 'mobile', status: 'valid_number' },
    ]);
  });

  it('preserves the provider person and organization ids', async () => {
    const { body } = await runSearch(
      enrichmentProvider((people) => people.map((entry) => enriched(entry.personRef))),
    );

    const prospect = body.data?.processing.enrichment?.prospects[0];
    expect(prospect?.externalPersonId).toBe('6a1b2c3d4e5f60718293a4b5');
    expect(prospect?.externalOrganizationId).toBe('5f2a1b3c4d5e6f7a8b9c0d1e');
  });

  it('joins the prospect to the person on the key the list already uses', async () => {
    const { body } = await runSearch(
      enrichmentProvider((people) => people.map((entry) => enriched(entry.personRef))),
    );

    const person = body.data?.people[0];
    const prospect = body.data?.processing.enrichment?.prospects[0];
    expect(prospect?.personRef).toBe(person?.rawSourceRef);
  });

  it('reports the reachability channels and the match confidence', async () => {
    const { body } = await runSearch(
      enrichmentProvider((people) => people.map((entry) => enriched(entry.personRef))),
    );

    const prospect = body.data?.processing.enrichment?.prospects[0];
    expect(prospect?.reachability.channels).toEqual(['LINKEDIN', 'EMAIL', 'PHONE']);
    expect(prospect?.enrichment.matchConfidence).toBe('high');
  });

  it('reports the funnel as counts', async () => {
    const { body } = await runSearch(
      enrichmentProvider((people) => people.map((entry) => enriched(entry.personRef))),
    );

    expect(body.data?.processing.enrichment?.counts).toMatchObject({
      requested: 1,
      enriched: 1,
      noMatch: 0,
      failed: 0,
    });
    expect(body.data?.processing.enrichment?.reachability).toEqual({
      linkedin: 1,
      email: 1,
      phone: 1,
    });
  });
});

describe('prospect search with enrichment - partial and refused', () => {
  it('returns a usable run when the provider matched nobody', async () => {
    const { response, body } = await runSearch(
      enrichmentProvider((people) => people.map((entry) => refused(entry.personRef, 'NO_MATCH'))),
    );

    // The search credit is already spent and the people are real. A failed
    // enrichment must not turn a 200 into an error.
    expect(response.statusCode).toBe(200);
    expect(body.data?.people).toHaveLength(1);
    expect(body.data?.processing.enrichment?.counts.noMatch).toBe(1);
  });

  it('reports a plan restriction as an actionable, provider-neutral message', async () => {
    const { response, body } = await runSearch(
      enrichmentProvider((people) =>
        people.map((entry) => refused(entry.personRef, 'UNAVAILABLE')),
      ),
    );

    expect(response.statusCode).toBe(200);
    const detail = body.data?.processing.enrichment?.detail ?? '';
    expect(detail).toContain('not available for the current provider account');
    // Provider-neutral: the frontend holds no credential and must not be told
    // to go and configure a named vendor.
    expect(detail.toLowerCase()).not.toContain('apollo');
  });

  it('keeps the search results when enrichment is not configured at all', async () => {
    // No `enrichmentProvider`, so the app resolves the null one for
    // DISCOVERY_PROVIDER=none.
    const context = await createTestApp({ peopleProvider: peopleProvider() });
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/icps',
      payload: createBody('No enrichment ICP'),
    });
    const icpId = parseBody<{ id: string }>(created.payload).data?.id ?? '';

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/icps/${icpId}/prospects`,
      payload: {},
    });
    const body = parseBody<ProspectRunDto>(response.payload);

    expect(response.statusCode).toBe(200);
    expect(body.data?.people).toHaveLength(1);
    expect(body.data?.processing.enrichment?.counts.unavailable).toBe(1);
  });
});

describe('prospect search with enrichment - what must never reach the browser', () => {
  it('exposes no credential, provider endpoint or raw payload', async () => {
    const { response } = await runSearch(
      enrichmentProvider((people) => people.map((entry) => enriched(entry.personRef))),
    );

    const payload = response.payload;
    expect(payload).not.toContain('APOLLO_API_KEY');
    expect(payload).not.toContain('x-api-key');
    expect(payload).not.toContain('api.apollo.io');
    expect(payload).not.toContain('bulk_match');
    // Provider field names would mean an Apollo DTO leaked past the adapter.
    expect(payload).not.toContain('phone_numbers');
    expect(payload).not.toContain('email_status');
    expect(payload).not.toContain('sanitized_number');
  });

  it('describes the enrichment provider on /health without revealing a credential', async () => {
    const context = await createTestApp({
      enrichmentProvider: enrichmentProvider(() => []),
    });
    const response = await context.app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('enrichmentProvider');
    expect(response.payload).not.toContain('APOLLO_API_KEY');
  });
});
