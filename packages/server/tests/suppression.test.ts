import { describe, expect, it } from 'vitest';
import type { CanonicalCompany, IcpConfig } from '@pursuit/shared';
import {
  SuppressionService,
  suppressionListFromIcp,
} from '../src/modules/filtering/suppression-service.js';
import { exampleConfig } from './helpers.js';

/**
 * `SuppressionService`.
 *
 * Suppression is the one exclusion that overrides fit entirely, so the tests
 * pull in both directions: it must catch the accounts a person put on the list,
 * and it must not catch anything else. An over-suppressed prospect is
 * recoverable from the cold pool only if somebody notices it is there.
 */

function canonical(overrides: Partial<CanonicalCompany> = {}): CanonicalCompany {
  return {
    id: 'domain:voorbeeld-software.nl',
    identityBasis: 'DOMAIN',
    name: 'Voorbeeld Software B.V.',
    normalizedName: 'voorbeeld software',
    domain: 'voorbeeld-software.nl',
    providerRefs: [{ provider: 'apollo', externalId: 'org-voorbeeld' }],
    sourceRefs: ['apollo:person:p1'],
    ...overrides,
  };
}

function withSuppressed(
  accounts: IcpConfig['evidenceDiscovery']['suppressedAccounts'],
): SuppressionService {
  const config = exampleConfig();
  config.evidenceDiscovery.suppressedAccounts = accounts;
  return new SuppressionService([suppressionListFromIcp(config)]);
}

describe('suppression - what it catches', () => {
  it('suppresses a company by domain', () => {
    const service = withSuppressed([
      { id: 'acc-1', name: 'Existing Customer BV', domain: 'voorbeeld-software.nl' },
    ]);

    const match = service.check(canonical());
    expect(match?.detail).toContain('voorbeeld-software.nl');
    expect(match?.detail).toContain('icp.evidenceDiscovery.suppressedAccounts');
  });

  it('normalizes the suppressed domain, so a URL on the list still matches', () => {
    const service = withSuppressed([
      { id: 'acc-1', name: 'Existing Customer BV', domain: 'https://WWW.Voorbeeld-Software.nl/' },
    ]);

    expect(service.check(canonical())).toBeDefined();
  });

  it('suppresses by provider account reference', () => {
    const service = withSuppressed([{ id: 'org-voorbeeld', name: 'Existing Customer BV' }]);

    expect(service.check(canonical({ domain: undefined }))?.detail).toContain(
      'provider account reference',
    );
  });

  it('suppresses by name only when the listed account has no domain of its own', () => {
    const byName = withSuppressed([{ id: 'acc-1', name: 'Voorbeeld Software B.V.' }]);
    expect(byName.check(canonical())).toBeDefined();

    // The same name, but the entry named a *different* domain - so it has
    // already said which company it means, and this is not that company.
    const withDomain = withSuppressed([
      { id: 'acc-1', name: 'Voorbeeld Software B.V.', domain: 'ander-voorbeeld.nl' },
    ]);
    expect(withDomain.check(canonical())).toBeUndefined();
  });
});

describe('suppression - what it leaves alone', () => {
  it('does not suppress a company that is on no list', () => {
    const service = withSuppressed([
      { id: 'acc-1', name: 'Existing Customer BV', domain: 'existing.nl' },
    ]);

    expect(service.check(canonical())).toBeUndefined();
  });

  it('does not suppress on a partial domain match', () => {
    const service = withSuppressed([{ id: 'acc-1', name: 'Other', domain: 'software.nl' }]);

    // `voorbeeld-software.nl` is not `software.nl`, and nothing here does
    // substring matching - a suffix match would suppress every subdomain-alike
    // company in the market.
    expect(service.check(canonical())).toBeUndefined();
  });

  it('suppresses nothing when the ICP has an empty list', () => {
    const service = withSuppressed([]);

    expect(service.size).toBe(0);
    expect(service.check(canonical())).toBeUndefined();
  });
});
