import { describe, expect, it, vi } from 'vitest';
import {
  NullPeopleEnrichmentProvider,
  reachabilityFor,
  type EnrichPeopleOptions,
  type EnrichPersonInput,
  type EnrichedProspect,
  type IcpConfig,
  type PeopleEnrichmentProvider,
  type ProspectEnrichmentStatus,
} from '@pursuit/shared';
import { CandidateProcessingService } from '../src/modules/discovery/candidate-processing-service.js';
import { InMemoryCandidateRepository } from '../src/modules/discovery/in-memory-candidate-repository.js';
import { ProspectEnrichmentService } from '../src/modules/discovery/prospect-enrichment-service.js';
import { exampleConfig } from './helpers.js';
import { company, person } from './candidate-fixtures.js';

/**
 * Contact enrichment inside the pipeline.
 *
 * Three things only exist once the stages are composed, and they are what this
 * suite is for:
 *
 *  1. **Order.** Enrichment runs *before* the reachability check, so nobody is
 *     rejected for lacking contact data that a people search was never going to
 *     return in the first place.
 *  2. **Partial success.** A run where some people enrich, some do not match
 *     and some are refused by the plan is a *usable* run, not a failed one.
 *  3. **Traceability.** Every candidate that entered the stage comes back with
 *     a status, and every stored contact detail hangs off the candidate row it
 *     belongs to.
 */

const RUN = {
  icpId: '11111111-1111-4111-8111-111111111111',
  icpVersion: 1,
  provider: 'apollo',
  queryVersion: 'people-query.v1',
  startedAt: new Date('2026-01-01T10:00:00.000Z'),
};

function config(mutate: (config: IcpConfig) => void = () => undefined): IcpConfig {
  const value = exampleConfig();
  value.companyProfile.industries = ['IT_SERVICES', 'FINANCIAL_SERVICES'];
  mutate(value);
  return value;
}

/** A prospect carrying exactly the channels named. */
function prospect(
  personRef: string,
  channels: { linkedin?: boolean; email?: boolean; phone?: boolean } = {},
): EnrichedProspect {
  const linkedinUrl = channels.linkedin === true ? 'https://www.linkedin.com/in/x' : undefined;
  const workEmail = channels.email === true ? 'x@example.com' : undefined;
  const phoneNumbers = channels.phone === true ? [{ number: '+31205550142', type: 'mobile' }] : [];

  return {
    personRef,
    provider: 'apollo',
    externalPersonId: personRef.split(':').pop() ?? personRef,
    person: { ...(linkedinUrl !== undefined ? { linkedinUrl } : {}) },
    company: {},
    contact: {
      ...(workEmail !== undefined ? { workEmail } : {}),
      phoneNumbers,
      phoneState: phoneNumbers.length > 0 ? 'AVAILABLE' : 'NONE',
    },
    enrichment: { status: 'ENRICHED', matchConfidence: 'high', provider: 'apollo' },
    reachability: reachabilityFor({
      ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
      ...(workEmail !== undefined ? { workEmail } : {}),
      phoneNumbers,
    }),
  };
}

/** A prospect with no contact data, under the status given. */
function empty(personRef: string, status: ProspectEnrichmentStatus): EnrichedProspect {
  return {
    personRef,
    provider: 'apollo',
    person: {},
    company: {},
    contact: { phoneNumbers: [], phoneState: 'NOT_REQUESTED' },
    enrichment: { status, provider: 'apollo', detail: 'nothing came back' },
    reachability: { hasLinkedIn: false, hasWorkEmail: false, hasPhone: false, channels: [] },
  };
}

/** A provider that answers from a lookup, or rejects outright. */
function stubProvider(
  answer: ((people: readonly EnrichPersonInput[]) => EnrichedProspect[]) | Error,
): PeopleEnrichmentProvider & { calls: EnrichPersonInput[][] } {
  const calls: EnrichPersonInput[][] = [];
  return {
    calls,
    describeEnrichment: () => ({
      id: 'apollo',
      displayName: 'Apollo people enrichment (API v1)',
      version: 'v1',
      maxPageSize: 10,
      available: true,
    }),
    enrichPeople: (people: readonly EnrichPersonInput[], _options: EnrichPeopleOptions) => {
      calls.push([...people]);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer(people));
    },
  };
}

function enrichment(
  provider: PeopleEnrichmentProvider,
  overrides: { revealPhoneNumbers?: boolean; maxCandidatesPerRun?: number } = {},
) {
  return new ProspectEnrichmentService({
    provider,
    revealPhoneNumbers: overrides.revealPhoneNumbers ?? false,
    maxCandidatesPerRun: overrides.maxCandidatesPerRun ?? 25,
  });
}

function service(options: {
  provider?: PeopleEnrichmentProvider;
  repository?: InMemoryCandidateRepository;
  maxCandidatesPerRun?: number;
  revealPhoneNumbers?: boolean;
}) {
  return new CandidateProcessingService({
    ...(options.repository ? { repository: options.repository } : {}),
    ...(options.provider
      ? {
          enrichment: enrichment(options.provider, {
            ...(options.maxCandidatesPerRun !== undefined
              ? { maxCandidatesPerRun: options.maxCandidatesPerRun }
              : {}),
            ...(options.revealPhoneNumbers !== undefined
              ? { revealPhoneNumbers: options.revealPhoneNumbers }
              : {}),
          }),
        }
      : {}),
  });
}

describe('enrichment in the pipeline - ordering', () => {
  it('enriches the candidates that cleared the hard filters, and only those', async () => {
    const provider = stubProvider((people) => people.map((entry) => prospect(entry.personRef)));
    // One survivor and one candidate the geography filter rejects.
    const rejected = person('p2', {
      company: company({ externalId: 'org-b', domain: 'ander.de', country: 'DE' }),
    });

    await service({ provider }).process(config(), [person('p1'), rejected], RUN);

    // Enrichment is the one stage that costs money per person, so it must never
    // be spent on somebody the free checks already excluded.
    expect(provider.calls[0]?.map((entry) => entry.personRef)).toEqual(['apollo:person:p1']);
  });

  it('keeps a candidate whose only channel enrichment found is a work email', async () => {
    const provider = stubProvider((people) =>
      people.map((entry) => prospect(entry.personRef, { email: true })),
    );
    // No LinkedIn, no email status, no company domain: on search data alone
    // this person is "unreachable" and would have been rejected.
    const thin = person('p1', {
      linkedinUrl: undefined,
      emailStatus: undefined,
      company: company({ domain: undefined }),
    });

    const result = await service({ provider }).process(config(), [thin], RUN);

    // This is the whole reason enrichment runs before reachability: the search
    // endpoint returns no email addresses, so rejecting on their absence would
    // record the pipeline's blind spot as a fact about the prospect.
    expect(result.survivors).toHaveLength(1);
    expect(result.counts.unreachable).toBe(0);
  });

  it('still rejects a candidate that enrichment found no channel for', async () => {
    const provider = stubProvider((people) =>
      people.map((entry) => empty(entry.personRef, 'NO_MATCH')),
    );
    const thin = person('p1', {
      linkedinUrl: undefined,
      emailStatus: undefined,
      company: company({ domain: undefined }),
    });

    const result = await service({ provider }).process(config(), [thin], RUN);

    expect(result.survivors).toHaveLength(0);
    expect(result.rejected[0]?.rejections[0]?.reason).toBe('UNREACHABLE');
    expect(result.rejected[0]?.rejections[0]?.detail).toContain('Contact enrichment returned no');
  });

  it('skips enrichment entirely when the ICP does not require reachability', async () => {
    const provider = stubProvider((people) => people.map((entry) => prospect(entry.personRef)));
    const criteria = config((value) => {
      value.targetBuyer.reachabilityRequirement = 'NOT_REQUIRED';
    });

    const result = await service({ provider }).process(criteria, [person('p1')], RUN);

    // The author said contact channels are not part of what they are looking
    // for. Spending a credit per person to answer that anyway is the wrong
    // default.
    expect(provider.calls).toHaveLength(0);
    expect(result.enrichment).toBeUndefined();
    expect(result.survivors).toHaveLength(1);
  });

  it('runs the pipeline unchanged when no enrichment provider is configured', async () => {
    const result = await service({}).process(config(), [person('p1')], RUN);

    expect(result.enrichment).toBeUndefined();
    expect(result.survivors).toHaveLength(1);
  });
});

describe('enrichment in the pipeline - partial success', () => {
  it('returns usable results when only some people enriched', async () => {
    const provider = stubProvider((people) =>
      people.map((entry, index) => {
        if (index === 0) return prospect(entry.personRef, { linkedin: true, email: true });
        if (index === 1) return empty(entry.personRef, 'NO_MATCH');
        if (index === 2) return empty(entry.personRef, 'UNAVAILABLE');
        return empty(entry.personRef, 'FAILED');
      }),
    );

    const result = await service({ provider }).process(
      config(),
      [person('p1'), person('p2'), person('p3'), person('p4')],
      RUN,
    );

    expect(result.enrichment?.counts).toMatchObject({
      requested: 4,
      enriched: 1,
      noMatch: 1,
      unavailable: 1,
      failed: 1,
      skipped: 0,
    });
    // The run is not failed. The people the provider could not enrich still
    // have LinkedIn from the search, so they remain survivors.
    expect(result.survivors).toHaveLength(4);
  });

  it('counts each contact channel independently, overlapping by design', async () => {
    const provider = stubProvider((people) => [
      prospect(people[0]?.personRef ?? '', { linkedin: true, email: true, phone: true }),
      prospect(people[1]?.personRef ?? '', { linkedin: true }),
      prospect(people[2]?.personRef ?? '', { email: true }),
    ]);

    const result = await service({ provider }).process(
      config(),
      [person('p1'), person('p2'), person('p3')],
      RUN,
    );

    expect(result.enrichment?.reachability).toEqual({ linkedin: 2, email: 2, phone: 1 });
  });

  it('holds candidates over the run budget as NOT_REQUESTED rather than dropping them', async () => {
    const provider = stubProvider((people) => people.map((entry) => prospect(entry.personRef)));

    const result = await service({ provider, maxCandidatesPerRun: 2 }).process(
      config(),
      [person('p1'), person('p2'), person('p3')],
      RUN,
    );

    expect(provider.calls[0]).toHaveLength(2);
    expect(result.enrichment?.counts).toMatchObject({ requested: 2, skipped: 1 });
    // Every candidate that entered the stage has an entry: a survivor with none
    // is indistinguishable from one the response forgot.
    expect(result.enrichment?.prospects).toHaveLength(3);
    const held = result.enrichment?.prospects.find(
      (entry) => entry.enrichment.status === 'NOT_REQUESTED',
    );
    expect(held?.enrichment.detail).toContain('limit of 2 contact lookups');
  });

  it('does not send a candidate whose identity is too weak to ask about', async () => {
    const provider = stubProvider((people) => people.map((entry) => prospect(entry.personRef)));
    // No usable provider id, no LinkedIn, no company domain: there is no honest
    // question to ask, so none is asked.
    const anonymous = person('p1', {
      providerRefs: [{ provider: 'other-vendor', externalId: 'x' }],
      linkedinUrl: undefined,
      company: company({ domain: undefined }),
    });

    const result = await service({ provider }).process(config(), [anonymous], RUN);

    expect(provider.calls[0]).toEqual([]);
    expect(result.enrichment?.counts.skipped).toBe(1);
    expect(result.enrichment?.prospects[0]?.enrichment.detail).toContain('without guessing');
  });

  it('survives an enrichment provider that rejects instead of reporting statuses', async () => {
    const provider = stubProvider(new Error('adapter contract broken'));

    const result = await service({ provider }).process(config(), [person('p1')], RUN);

    // A bug in an enrichment adapter must not destroy a search the user has
    // already paid for.
    expect(result.survivors).toHaveLength(1);
    expect(result.enrichment?.counts.failed).toBe(1);
    expect(result.enrichment?.detail).toContain('Contact enrichment failed');
  });

  it('raises a run-level note only when every lookup was refused', async () => {
    const allRefused = stubProvider((people) =>
      people.map((entry) => empty(entry.personRef, 'UNAVAILABLE')),
    );
    const mixed = stubProvider((people) =>
      people.map((entry, index) =>
        index === 0 ? prospect(entry.personRef, { email: true }) : empty(entry.personRef, 'UNAVAILABLE'),
      ),
    );

    const refused = await service({ provider: allRefused }).process(
      config(),
      [person('p1'), person('p2')],
      RUN,
    );
    const partial = await service({ provider: mixed }).process(
      config(),
      [person('p1'), person('p2')],
      RUN,
    );

    expect(refused.enrichment?.detail).toBeDefined();
    // A mixed result is a working integration with gaps; calling that
    // "enrichment is unavailable" would be wrong.
    expect(partial.enrichment?.detail).toBeUndefined();
  });

  it('reports whether phone reveal was requested at all', async () => {
    const provider = stubProvider((people) => people.map((entry) => prospect(entry.personRef)));

    const off = await service({ provider }).process(config(), [person('p1')], RUN);
    const on = await service({ provider, revealPhoneNumbers: true }).process(
      config(),
      [person('p1')],
      RUN,
    );

    // "Nobody has a number" and "we did not ask" are identical result sets with
    // opposite meanings.
    expect(off.enrichment?.phoneRevealRequested).toBe(false);
    expect(on.enrichment?.phoneRevealRequested).toBe(true);
  });
});

describe('enrichment persistence', () => {
  it('stores one enrichment per candidate, against the run that produced it', async () => {
    const repository = new InMemoryCandidateRepository();
    const provider = stubProvider((people) =>
      people.map((entry) => prospect(entry.personRef, { linkedin: true, email: true, phone: true })),
    );

    await service({ provider, repository }).process(config(), [person('p1')], RUN);

    const stored = repository.lastRun?.enrichment;
    expect(stored?.prospects).toHaveLength(1);
    expect(stored?.prospects[0]?.personRef).toBe('apollo:person:p1');
    expect(repository.lastRun?.icpProfileId).toBe(RUN.icpId);
  });

  it('preserves the provider ids, LinkedIn, email and phone data it stored', async () => {
    const repository = new InMemoryCandidateRepository();
    const provider = stubProvider((people) =>
      people.map((entry) => prospect(entry.personRef, { linkedin: true, email: true, phone: true })),
    );

    await service({ provider, repository }).process(config(), [person('p1')], RUN);

    const stored = repository.lastRun?.enrichment?.prospects[0];
    expect(stored?.externalPersonId).toBe('p1');
    expect(stored?.person.linkedinUrl).toBe('https://www.linkedin.com/in/x');
    expect(stored?.contact.workEmail).toBe('x@example.com');
    expect(stored?.contact.phoneNumbers).toEqual([{ number: '+31205550142', type: 'mobile' }]);
    expect(stored?.enrichment.matchConfidence).toBe('high');
  });

  it('stores the no-match candidates too, so they stay traceable', async () => {
    const repository = new InMemoryCandidateRepository();
    const provider = stubProvider((people) =>
      people.map((entry) => empty(entry.personRef, 'NO_MATCH')),
    );

    await service({ provider, repository }).process(config(), [person('p1')], RUN);

    const stored = repository.lastRun?.enrichment?.prospects[0];
    expect(stored?.enrichment.status).toBe('NO_MATCH');
  });

  it('still returns the enriched results when the run could not be stored', async () => {
    const repository = new InMemoryCandidateRepository();
    repository.failWith = new Error('connection refused');
    const provider = stubProvider((people) =>
      people.map((entry) => prospect(entry.personRef, { email: true })),
    );

    const result = await service({ provider, repository }).process(config(), [person('p1')], RUN);

    // The provider credit is already spent. Throwing away paid-for, correct
    // results because an audit table is unavailable is the worse failure.
    expect(result.persistence.persisted).toBe(false);
    expect(result.enrichment?.counts.enriched).toBe(1);
    expect(result.survivors).toHaveLength(1);
  });
});

describe('ProspectEnrichmentService - the null provider', () => {
  it('reports every candidate as UNAVAILABLE rather than rejecting', async () => {
    const stage = enrichment(new NullPeopleEnrichmentProvider());

    const result = await stage.enrich({
      candidates: [
        { personRef: 'apollo:person:p1', providerRefs: [], state: 'SURVIVOR', rejections: [] },
      ],
      peopleByRef: new Map([['apollo:person:p1', person('p1')]]),
      icpId: RUN.icpId,
    });

    // A search with no provider has no result at all and must fail loudly.
    // Enrichment with no provider still leaves a usable list of people.
    expect(result.counts.unavailable).toBe(1);
    expect(result.detail).toContain('No contact enrichment provider is configured');
  });
});

describe('enrichment logging', () => {
  it('logs counts and ids, never a contact detail', async () => {
    const logged: Record<string, unknown>[] = [];
    const logger = {
      info: (payload: Record<string, unknown>) => logged.push(payload),
      warn: (payload: Record<string, unknown>) => logged.push(payload),
    };
    const provider = stubProvider((people) =>
      people.map((entry) => prospect(entry.personRef, { email: true, phone: true })),
    );
    const stage = new ProspectEnrichmentService({
      provider,
      revealPhoneNumbers: true,
      maxCandidatesPerRun: 25,
      logger,
    });

    await stage.enrich({
      candidates: [
        { personRef: 'apollo:person:p1', providerRefs: [], state: 'SURVIVOR', rejections: [] },
      ],
      peopleByRef: new Map([['apollo:person:p1', person('p1')]]),
      icpId: RUN.icpId,
    });

    const serialized = JSON.stringify(logged);
    // A lead list is personal data and does not belong in an application log.
    expect(serialized).not.toContain('x@example.com');
    expect(serialized).not.toContain('+31205550142');
    expect(serialized).not.toContain('Sanne');
    expect(serialized).toContain('"enriched":1');
  });

  it('does not log a provider failure with its raw message in the result', async () => {
    const warned = vi.fn();
    const provider = stubProvider(new Error('ECONNREFUSED 10.0.0.1:443'));
    const stage = new ProspectEnrichmentService({
      provider,
      revealPhoneNumbers: false,
      maxCandidatesPerRun: 25,
      logger: { info: () => undefined, warn: warned },
    });

    const result = await stage.enrich({
      candidates: [
        { personRef: 'apollo:person:p1', providerRefs: [], state: 'SURVIVOR', rejections: [] },
      ],
      peopleByRef: new Map([['apollo:person:p1', person('p1')]]),
      icpId: RUN.icpId,
    });

    // The reason is logged server-side; the caller gets our own words.
    expect(warned).toHaveBeenCalled();
    expect(result.detail).not.toContain('ECONNREFUSED');
  });
});
