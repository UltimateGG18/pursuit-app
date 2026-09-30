import { describe, expect, it } from 'vitest';
import { EntityResolutionService } from '../src/modules/companies/entity-resolution-service.js';
import { company, person } from './candidate-fixtures.js';

/**
 * `EntityResolutionService`.
 *
 * The two halves of the contract are tested with equal weight, because getting
 * one right at the other's expense is the failure that matters: it has to merge
 * what is provably the same company, and it has to *refuse* to merge what is
 * merely similar. A missed merge leaves a visible duplicate; a wrong merge
 * silently deletes a real company from the result.
 */

const resolve = (people: Parameters<EntityResolutionService['resolve']>[0]) =>
  new EntityResolutionService().resolve(people);

describe('entity resolution - merging on exact identity', () => {
  it('merges two people at the same provider organization id', () => {
    const result = resolve([
      person('p1', { company: company({ domain: undefined, externalId: 'org-a' }) }),
      person('p2', { company: company({ domain: undefined, externalId: 'org-a' }) }),
    ]);

    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]?.identityBasis).toBe('PROVIDER_ID');
    expect(result.assignments.map((entry) => entry.companyId)).toEqual([
      'ref:apollo:org-a',
      'ref:apollo:org-a',
    ]);
  });

  it('merges on normalized domain even when the provider ids differ', () => {
    // Two Apollo records for one firm - a real shape, and the reason domain
    // ranks above the provider's own key.
    const result = resolve([
      person('p1', { company: company({ externalId: 'org-a', domain: 'voorbeeld.nl' }) }),
      person('p2', {
        company: company({ externalId: 'org-b', domain: 'https://WWW.Voorbeeld.nl/careers' }),
      }),
    ]);

    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]?.id).toBe('domain:voorbeeld.nl');
    expect(result.companies[0]?.identityBasis).toBe('DOMAIN');
  });

  it('merges transitively: a domain and an id seen apart still form one company', () => {
    // The case a first-match-wins loop gets wrong. p1 ties the two keys
    // together; p2 and p3 each know only one of them.
    const result = resolve([
      person('p1', { company: company({ externalId: 'org-a', domain: 'voorbeeld.nl' }) }),
      person('p2', { company: company({ externalId: 'org-a', domain: undefined }) }),
      person('p3', { company: company({ externalId: undefined, domain: 'voorbeeld.nl' }) }),
    ]);

    expect(result.companies).toHaveLength(1);
    expect(new Set(result.assignments.map((entry) => entry.companyId)).size).toBe(1);
  });

  it('gives the same company the same id whichever person was returned first', () => {
    const forwards = resolve([
      person('p1', { company: company({ externalId: 'org-a', domain: undefined }) }),
      person('p2', { company: company({ externalId: 'org-a', domain: 'voorbeeld.nl' }) }),
    ]);
    const backwards = resolve([
      person('p2', { company: company({ externalId: 'org-a', domain: 'voorbeeld.nl' }) }),
      person('p1', { company: company({ externalId: 'org-a', domain: undefined }) }),
    ]);

    expect(forwards.companies[0]?.id).toBe('domain:voorbeeld.nl');
    expect(backwards.companies[0]?.id).toBe('domain:voorbeeld.nl');
  });
});

describe('entity resolution - refusing to merge', () => {
  it('keeps two different companies apart', () => {
    const result = resolve([
      person('p1', { company: company({ externalId: 'org-a', domain: 'voorbeeld.nl' }) }),
      person('p2', {
        company: company({ externalId: 'org-b', domain: 'ander-voorbeeld.nl', name: 'Ander B.V.' }),
      }),
    ]);

    expect(result.companies).toHaveLength(2);
    expect(result.assignments[0]?.companyId).not.toBe(result.assignments[1]?.companyId);
  });

  it('does not merge on name alone, however alike the names are', () => {
    // The merge that would be wrong. Two firms called "Voorbeeld" with no
    // domain and no shared id are two firms until something exact says
    // otherwise - name similarity is entity resolution's job to resist, not to
    // act on.
    const result = resolve([
      person('p1', { company: { name: 'Voorbeeld B.V.', country: 'NL' } }),
      person('p2', { company: { name: 'Voorbeeld Holding B.V.', country: 'NL' } }),
    ]);

    expect(result.companies).toHaveLength(2);
    expect(result.companies.every((entry) => entry.identityBasis === 'UNRESOLVED')).toBe(true);
  });

  it('keeps a company with a missing domain separate from one with a different domain', () => {
    const result = resolve([
      person('p1', { company: company({ externalId: 'org-a', domain: undefined }) }),
      person('p2', { company: company({ externalId: 'org-b', domain: 'voorbeeld.nl' }) }),
    ]);

    expect(result.companies).toHaveLength(2);
  });
});

describe('entity resolution - what a canonical company carries', () => {
  it('preserves every provider reference and every source reference', () => {
    const result = resolve([
      person('p1', { company: company({ externalId: 'org-a', domain: 'voorbeeld.nl' }) }),
      person('p2', { company: company({ externalId: 'org-b', domain: 'voorbeeld.nl' }) }),
    ]);

    const merged = result.companies[0];
    expect(merged?.providerRefs).toEqual([
      { provider: 'apollo', externalId: 'org-a' },
      { provider: 'apollo', externalId: 'org-b' },
    ]);
    expect(merged?.sourceRefs).toEqual(['apollo:person:p1', 'apollo:person:p2']);
  });

  it('fills gaps from later sources but never overwrites a reported value', () => {
    const result = resolve([
      person('p1', {
        company: {
          externalId: 'org-a',
          domain: 'voorbeeld.nl',
          name: 'Voorbeeld B.V.',
          employeeCount: 240,
        },
      }),
      person('p2', {
        company: {
          externalId: 'org-a',
          domain: 'voorbeeld.nl',
          name: 'Voorbeeld Software B.V.',
          employeeCount: 900,
          country: 'NL',
        },
      }),
    ]);

    const merged = result.companies[0];
    // First-seen wins for a field both sources reported...
    expect(merged?.name).toBe('Voorbeeld B.V.');
    expect(merged?.employeeCount).toBe(240);
    // ...and a field only the second reported is filled rather than dropped.
    expect(merged?.country).toBe('NL');
  });

  it('invents nothing for a company nobody named', () => {
    const result = resolve([person('p1', { company: { domain: 'voorbeeld.nl' } })]);

    const merged = result.companies[0];
    // Labelled by what is actually known, and nothing beyond it: no country
    // guessed from the TLD, no industry, no headcount.
    expect(merged?.name).toBe('voorbeeld.nl');
    expect(merged?.country).toBeUndefined();
    expect(merged?.industry).toBeUndefined();
    expect(merged?.employeeCount).toBeUndefined();
  });

  it('assigns no company to a person whose employer was not reported', () => {
    const result = resolve([person('p1', { company: null })]);

    expect(result.companies).toHaveLength(0);
    expect(result.assignments[0]).toEqual({ personRef: 'apollo:person:p1' });
  });

  it('keeps two people at one company as two people', () => {
    const result = resolve([
      person('p1', { company: company({ domain: 'voorbeeld.nl' }) }),
      person('p2', { company: company({ domain: 'voorbeeld.nl' }) }),
    ]);

    expect(result.companies).toHaveLength(1);
    expect(result.assignments).toHaveLength(2);
  });
});
