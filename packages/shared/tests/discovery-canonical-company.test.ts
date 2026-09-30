import { describe, expect, it } from 'vitest';
import { companyIdentityKeys, identityBasisForKey } from '../src/discovery/canonical-company.js';

/**
 * The company identity keys entity resolution merges on.
 *
 * Small surface, high stakes: these two functions decide what counts as "the
 * same company", and the contract they encode is that only exact evidence does.
 */

describe('companyIdentityKeys', () => {
  it('ranks domain above the provider key', () => {
    // The resolution order the plan states, and the reason for it: a domain is
    // durable across providers where an external id is meaningful only inside
    // the one that issued it.
    expect(companyIdentityKeys({ provider: 'apollo', externalId: 'org-a', domain: 'example.com' })).toEqual([
      'domain:example.com',
      'ref:apollo:org-a',
    ]);
  });

  it('namespaces the provider key, so two providers cannot collide on one id', () => {
    const apollo = companyIdentityKeys({ provider: 'apollo', externalId: '123' });
    const other = companyIdentityKeys({ provider: 'clearbit', externalId: '123' });

    expect(apollo).not.toEqual(other);
  });

  it('produces no keys at all for a company with neither', () => {
    // Which is what makes such a company resolvable to nothing but itself - the
    // honest outcome, rather than merging every unidentifiable company into one.
    expect(companyIdentityKeys({ provider: 'apollo' })).toEqual([]);
    expect(companyIdentityKeys({ provider: 'apollo', externalId: '', domain: '' })).toEqual([]);
  });

  it('offers no name-based key', () => {
    // Deliberately absent, unlike `candidateIdentityKeys`. Merging two firms on
    // a name collision silently deletes one of them from the result.
    const keys = companyIdentityKeys({ provider: 'apollo', externalId: 'org-a' });
    expect(keys.some((key) => key.startsWith('name:'))).toBe(false);
  });
});

describe('identityBasisForKey', () => {
  it('reports how confidently a company was identified', () => {
    expect(identityBasisForKey('domain:example.com')).toBe('DOMAIN');
    expect(identityBasisForKey('ref:apollo:org-a')).toBe('PROVIDER_ID');
    expect(identityBasisForKey('source:apollo:person:p1')).toBe('UNRESOLVED');
  });
});
