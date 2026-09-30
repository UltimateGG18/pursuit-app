import { describe, expect, it } from 'vitest';
import type { IcpConfig } from '@pursuit/shared';
import { CandidateProcessingService } from '../src/modules/discovery/candidate-processing-service.js';
import { InMemoryCandidateRepository } from '../src/modules/discovery/in-memory-candidate-repository.js';
import { exampleConfig } from './helpers.js';
import { company, person } from './candidate-fixtures.js';

/**
 * The pipeline end to end, in memory:
 *
 *   candidates -> dedupe -> entity resolution -> suppression -> hard filters
 *     -> reachability -> survivors + cold pool
 *
 * The individual stages have their own suites. What this one is for is the
 * behaviour that only exists once they are composed: that the stages run in the
 * stated order, that a candidate is recorded against the *most fundamental*
 * thing wrong with it rather than the first thing checked, and that nothing is
 * silently dropped on the way through.
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
  // The example ICP targets financial services; the fixture company is an IT
  // services firm. Aligned here so a test about suppression is not accidentally
  // also a test about industry.
  value.companyProfile.industries = ['IT_SERVICES', 'FINANCIAL_SERVICES'];
  mutate(value);
  return value;
}

const service = (repository?: InMemoryCandidateRepository) =>
  new CandidateProcessingService(repository ? { repository } : {});

describe('candidate processing - the happy path', () => {
  it('passes a matching candidate through every stage', async () => {
    const result = await service().process(config(), [person('p1')], RUN);

    expect(result.version).toBe('candidate-processing.v1');
    expect(result.survivors).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.survivors[0]?.state).toBe('SURVIVOR');
    expect(result.survivors[0]?.rejections).toEqual([]);
  });

  it('gives every survivor a canonical company and keeps it traceable to the provider', async () => {
    const result = await service().process(config(), [person('p1')], RUN);

    const survivor = result.survivors[0];
    expect(survivor?.personRef).toBe('apollo:person:p1');
    expect(survivor?.providerRefs).toEqual([{ provider: 'apollo', externalId: 'p1' }]);

    const resolved = result.companies.find((entry) => entry.id === survivor?.companyId);
    expect(resolved?.domain).toBe('voorbeeld-software.nl');
    expect(resolved?.providerRefs).toEqual([{ provider: 'apollo', externalId: 'org-voorbeeld' }]);
    expect(resolved?.sourceRefs).toEqual(['apollo:person:p1']);
  });

  it('resolves two people at one company to one company and two candidates', async () => {
    const result = await service().process(config(), [person('p1'), person('p2')], RUN);

    expect(result.counts.companiesResolved).toBe(1);
    expect(result.survivors).toHaveLength(2);
  });
});

describe('candidate processing - the cold pool', () => {
  it('records a suppressed candidate as SUPPRESSED, not as a poor match', async () => {
    const icp = config((value) => {
      value.evidenceDiscovery.suppressedAccounts = [
        { id: 'acc-1', name: 'Existing Customer BV', domain: 'voorbeeld-software.nl' },
      ];
      // Also a hard mismatch. Suppression runs first, so this candidate must be
      // reported as suppressed rather than as an industry failure that happens
      // to also be suppressed - otherwise the cold pool misstates why the list
      // is short.
      value.companyProfile.industries = ['MANUFACTURING'];
    });
    const result = await service().process(icp, [person('p1')], RUN);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.state).toBe('SUPPRESSED');
    expect(result.rejected[0]?.rejections.map((entry) => entry.reason)).toEqual(['SUPPRESSED']);
  });

  it('records a hard-filter rejection with every reason that applied', async () => {
    const result = await service().process(
      config(),
      [person('p1', { company: company({ country: 'DE', employeeCount: 4 }) })],
      RUN,
    );

    const reasons = result.rejected[0]?.rejections.map((entry) => entry.reason) ?? [];
    expect(result.rejected[0]?.state).toBe('COLD');
    expect(reasons).toContain('HARD_LOCATION_MISMATCH');
    expect(reasons).toContain('HARD_EMPLOYEE_RANGE_MISMATCH');
  });

  it('records an unreachable candidate, and only after the filters passed', async () => {
    const result = await service().process(
      config(),
      [
        person('p1', {
          linkedinUrl: undefined,
          emailStatus: undefined,
          company: company({ domain: undefined, website: undefined }),
        }),
      ],
      RUN,
    );

    expect(result.rejected[0]?.rejections.map((entry) => entry.reason)).toEqual(['UNREACHABLE']);
  });

  it('skips the reachability check when the ICP does not require reachability', async () => {
    const icp = config((value) => {
      value.targetBuyer.reachabilityRequirement = 'NOT_REQUIRED';
      value.targetBuyer.buyerRoles = [];
    });
    const result = await service().process(
      icp,
      [
        person('p1', {
          linkedinUrl: undefined,
          emailStatus: undefined,
          company: company({ domain: undefined, website: undefined }),
        }),
      ],
      RUN,
    );

    expect(result.survivors).toHaveLength(1);
  });

  it('records a merged-away record in the cold pool under its own reference', async () => {
    // Two provider records for one human, matched on their LinkedIn profile.
    // The removed record is a distinct row, so it is kept and explained.
    const result = await service().process(
      config(),
      [
        person('p1', { linkedinUrl: 'https://www.linkedin.com/in/sanne-de-vries' }),
        person('p2', { linkedinUrl: 'https://NL.linkedin.com/in/sanne-de-vries/?trk=x' }),
      ],
      RUN,
    );

    expect(result.counts.received).toBe(2);
    expect(result.counts.duplicatesRemoved).toBe(1);
    expect(result.survivors).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.personRef).toBe('apollo:person:p2');
    expect(result.rejected[0]?.rejections.map((entry) => entry.reason)).toEqual(['DUPLICATE']);
  });

  it('counts an identical record twice without emitting it twice', async () => {
    // The shape a provider's own `people` and `contacts` lists produce when a
    // person is in both. One record, counted twice - there is no second record
    // to keep, and a cold-pool copy of the survivor would say nothing.
    const result = await service().process(config(), [person('p1'), person('p1')], RUN);

    expect(result.counts.received).toBe(2);
    expect(result.counts.duplicatesRemoved).toBe(1);
    expect(result.survivors).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('accounts for every candidate it was given', async () => {
    const icp = config((value) => {
      value.evidenceDiscovery.suppressedAccounts = [{ id: 'acc-1', name: 'X', domain: 'ander.nl' }];
    });
    const people = [
      person('p1'),
      person('p2', { company: company({ externalId: 'org-b', domain: 'ander.nl' }) }),
      person('p3', { company: company({ externalId: 'org-c', domain: 'derde.nl', country: 'DE' }) }),
    ];
    const result = await service().process(icp, people, RUN);

    expect(result.counts.received).toBe(3);
    expect(result.survivors.length + result.rejected.length).toBe(3);
    expect(result.counts.survivors).toBe(1);
    expect(result.counts.suppressed).toBe(1);
    expect(result.counts.hardFilterRejected).toBe(1);
    expect(result.counts.cold).toBe(2);
  });
});

describe('candidate processing - honesty about what it did not do', () => {
  it('names the hard criteria it could not evaluate', async () => {
    const result = await service().process(config(), [person('p1')], RUN);

    // The example ICP requires .NET and SQL Server, which no source reports.
    expect(result.unsupportedHardCriteria?.join(' ')).toContain('technology.requiredTechnologies');
  });

  it('assigns no score, band or rank to anything it returns', async () => {
    const result = await service().process(config(), [person('p1')], RUN);

    const serialized = JSON.stringify(result);
    for (const forbidden of ['score', 'rank', 'band', 'confidence', 'probability']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('candidate processing - persistence', () => {
  it('stores the run, its companies and its whole cold pool', async () => {
    const repository = new InMemoryCandidateRepository();
    const icp = config((value) => {
      value.evidenceDiscovery.suppressedAccounts = [
        { id: 'acc-1', name: 'Existing Customer BV', domain: 'voorbeeld-software.nl' },
      ];
    });
    const result = await service(repository).process(
      icp,
      [person('p1'), person('p2', { company: company({ externalId: 'org-b', domain: 'ander.nl' }) })],
      { ...RUN, analysisId: '22222222-2222-4222-8222-222222222222' },
    );

    expect(result.persistence.persisted).toBe(true);
    expect(result.persistence.searchRunId).toBe(repository.lastRun?.searchRunId);

    const stored = repository.lastRun;
    expect(stored?.icpProfileId).toBe(RUN.icpId);
    expect(stored?.analysisId).toBe('22222222-2222-4222-8222-222222222222');
    expect(stored?.processingVersion).toBe('candidate-processing.v1');
    expect(stored?.companies).toHaveLength(2);
    // Survivors *and* the cold pool: a rejected candidate that is not stored is
    // not recoverable, which is the one thing the pool exists for.
    expect(stored?.candidates).toHaveLength(2);
    expect(stored?.candidates.filter((entry) => entry.state === 'SUPPRESSED')).toHaveLength(1);
  });

  it('reports that nothing was stored when no store is configured', async () => {
    const result = await service().process(config(), [person('p1')], RUN);

    expect(result.persistence.persisted).toBe(false);
    expect(result.persistence.searchRunId).toBeUndefined();
    expect(result.persistence.detail).toContain('not recorded');
  });

  it('still returns the results when the write fails, and says it did not store them', async () => {
    // The provider credit is already spent and the results are correct.
    // Discarding them because an audit table is unavailable is the worse of the
    // two failures - but pretending they were stored would be worse still.
    const repository = new InMemoryCandidateRepository();
    repository.failWith = new Error('connect ECONNREFUSED 127.0.0.1:5432');

    const result = await service(repository).process(config(), [person('p1')], RUN);

    expect(result.survivors).toHaveLength(1);
    expect(result.persistence.persisted).toBe(false);
    // Our own copy. A driver message can carry a connection string.
    expect(result.persistence.detail).not.toContain('5432');
  });
});
