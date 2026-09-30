import { describe, expect, it } from 'vitest';
import {
  candidateIdentityKeys,
  dedupeCandidates,
  discoverIcpRequestSchema,
  discoveryQuerySchema,
  normalizeCandidateDomain,
  normalizeCandidateName,
  type CompanyCandidate,
} from '../src/index.js';

function candidate(overrides: Partial<CompanyCandidate> & { name: string }): CompanyCandidate {
  return {
    providerRefs: [{ provider: 'apollo', externalId: 'default' }],
    rawSourceRef: 'apollo:organization:default',
    ...overrides,
  };
}

describe('normalizeCandidateDomain', () => {
  it('reduces the spellings of one host to a single key', () => {
    for (const input of [
      'example.com',
      'Example.COM',
      'www.example.com',
      'https://example.com',
      'https://www.example.com/',
      'http://www.example.com:8080/careers?ref=1',
      'https://user:pass@example.com/x',
      'example.com.',
    ]) {
      expect(normalizeCandidateDomain(input)).toBe('example.com');
    }
  });

  it('keeps a subdomain, which is a different host', () => {
    expect(normalizeCandidateDomain('shop.example.com')).toBe('shop.example.com');
    expect(normalizeCandidateDomain('example.co.uk')).toBe('example.co.uk');
  });

  it('returns undefined for anything that is not host-shaped', () => {
    // A bad dedupe key is worse than none: it merges unrelated companies.
    for (const input of [undefined, null, '', '   ', 'localhost', 'not a domain', 'http://', '@']) {
      expect(normalizeCandidateDomain(input)).toBeUndefined();
    }
  });
});

describe('normalizeCandidateName', () => {
  it('strips case, punctuation and a trailing legal suffix', () => {
    expect(normalizeCandidateName('Voorbeeld Software B.V.')).toBe('voorbeeld software');
    expect(normalizeCandidateName('ACME GmbH')).toBe('acme');
    expect(normalizeCandidateName('Nine Group B.V.')).toBe('nine');
  });

  it('only strips suffixes from the tail, so a leading word survives', () => {
    expect(normalizeCandidateName('Group Nine')).toBe('group nine');
  });

  it('never strips a name down to nothing', () => {
    expect(normalizeCandidateName('Holding')).toBe('holding');
  });

  it('folds accents so two spellings of one name agree', () => {
    expect(normalizeCandidateName('Café Zürich')).toBe(normalizeCandidateName('Cafe Zurich'));
  });
});

describe('candidateIdentityKeys', () => {
  it('keys on the domain and every provider reference', () => {
    const keys = candidateIdentityKeys(
      candidate({
        name: 'Voorbeeld',
        domain: 'WWW.Voorbeeld.nl',
        providerRefs: [
          { provider: 'apollo', externalId: 'a' },
          { provider: 'other', externalId: 'b' },
        ],
      }),
    );

    expect(keys).toEqual(['domain:voorbeeld.nl', 'ref:apollo:a', 'ref:other:b']);
  });

  it('adds a name key only when there is no domain to contradict it', () => {
    const withDomain = candidateIdentityKeys(
      candidate({ name: 'Nexus', domain: 'nexus.nl', country: 'NL' }),
    );
    expect(withDomain.some((key) => key.startsWith('name:'))).toBe(false);

    const withoutDomain = candidateIdentityKeys(candidate({ name: 'Nexus', country: 'NL' }));
    expect(withoutDomain).toContain('name:nexus:nl');
  });

  it('does not key on an unqualified name', () => {
    // Two unrelated companies called "Nexus" in different markets are not one.
    const keys = candidateIdentityKeys(candidate({ name: 'Nexus' }));
    expect(keys.some((key) => key.startsWith('name:'))).toBe(false);
  });
});

describe('dedupeCandidates', () => {
  it('collapses two spellings of the same domain and merges the references', () => {
    const result = dedupeCandidates([
      candidate({
        name: 'Example',
        domain: 'Example.COM',
        providerRefs: [{ provider: 'apollo', externalId: 'a' }],
      }),
      candidate({
        name: 'Example Ltd',
        domain: 'www.example.com',
        providerRefs: [{ provider: 'apollo', externalId: 'b' }],
      }),
    ]);

    expect(result).toHaveLength(1);
    // Nothing about provenance is lost, so entity resolution still sees both.
    expect(result[0]?.providerRefs).toEqual([
      { provider: 'apollo', externalId: 'a' },
      { provider: 'apollo', externalId: 'b' },
    ]);
  });

  it('keeps the first-seen candidate and does not merge disagreeing fields', () => {
    const result = dedupeCandidates([
      candidate({ name: 'First', domain: 'x.example', employeeCount: 100 }),
      candidate({ name: 'Second', domain: 'x.example', employeeCount: 900 }),
    ]);

    expect(result).toHaveLength(1);
    // Choosing between two disagreeing counts is a resolution decision, and
    // dedupe must not make business decisions.
    expect(result[0]?.name).toBe('First');
    expect(result[0]?.employeeCount).toBe(100);
  });

  it('collapses on the provider reference when neither copy has a domain', () => {
    const result = dedupeCandidates([
      candidate({ name: 'Anon', providerRefs: [{ provider: 'apollo', externalId: 'same' }] }),
      candidate({ name: 'Anon', providerRefs: [{ provider: 'apollo', externalId: 'same' }] }),
    ]);

    expect(result).toHaveLength(1);
  });

  it('collapses on name and country only when there is no domain', () => {
    const merged = dedupeCandidates([
      candidate({
        name: 'Acme B.V.',
        country: 'NL',
        providerRefs: [{ provider: 'apollo', externalId: 'a' }],
      }),
      candidate({
        name: 'ACME bv',
        country: 'NL',
        providerRefs: [{ provider: 'apollo', externalId: 'b' }],
      }),
    ]);
    expect(merged).toHaveLength(1);

    // Same name, same country, *different* domains: two real companies.
    const kept = dedupeCandidates([
      candidate({
        name: 'Nexus',
        country: 'NL',
        domain: 'nexus.nl',
        providerRefs: [{ provider: 'apollo', externalId: 'a' }],
      }),
      candidate({
        name: 'Nexus',
        country: 'NL',
        domain: 'nexus-group.nl',
        providerRefs: [{ provider: 'apollo', externalId: 'b' }],
      }),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('keeps companies with the same name in different countries apart', () => {
    expect(
      dedupeCandidates([
        candidate({ name: 'Nexus', country: 'NL' }),
        candidate({
          name: 'Nexus',
          country: 'DE',
          providerRefs: [{ provider: 'apollo', externalId: 'other' }],
        }),
      ]),
    ).toHaveLength(2);
  });

  it('collapses a chain of three copies onto one row', () => {
    const result = dedupeCandidates([
      candidate({
        name: 'Chain',
        domain: 'chain.example',
        providerRefs: [{ provider: 'apollo', externalId: 'a' }],
      }),
      candidate({
        name: 'Chain',
        domain: 'www.chain.example',
        providerRefs: [{ provider: 'apollo', externalId: 'b' }],
      }),
      candidate({
        name: 'Chain',
        domain: 'chain.example',
        providerRefs: [{ provider: 'apollo', externalId: 'c' }],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.providerRefs).toHaveLength(3);
  });

  it('leaves a list with no duplicates untouched', () => {
    const input = [
      candidate({ name: 'A', domain: 'a.example' }),
      candidate({
        name: 'B',
        domain: 'b.example',
        providerRefs: [{ provider: 'apollo', externalId: 'b' }],
      }),
    ];
    const result = dedupeCandidates(input);

    expect(result).toHaveLength(2);
    // Untouched means identical objects, not just equal ones.
    expect(result[0]).toBe(input[0]);
  });

  it('handles an empty list', () => {
    expect(dedupeCandidates([])).toEqual([]);
  });
});

describe('discoverIcpRequestSchema', () => {
  it('accepts an empty body and defaults the limit', () => {
    // The ICP already says what to look for.
    expect(discoverIcpRequestSchema.parse({})).toEqual({ limit: 25 });
  });

  it('bounds the limit', () => {
    expect(discoverIcpRequestSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(discoverIcpRequestSchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(discoverIcpRequestSchema.parse({ limit: 200 }).limit).toBe(200);
  });

  it('rejects an unknown field rather than ignoring it', () => {
    // A silently dropped `minimumScore` would look like scoring was applied.
    expect(discoverIcpRequestSchema.safeParse({ minimumScore: 80 }).success).toBe(false);
  });

  it('validates strategy names against the catalog', () => {
    expect(discoverIcpRequestSchema.parse({ strategies: ['FIRMOGRAPHIC'] }).strategies).toEqual([
      'FIRMOGRAPHIC',
    ]);
    expect(discoverIcpRequestSchema.safeParse({ strategies: ['TELEPATHY'] }).success).toBe(false);
    expect(discoverIcpRequestSchema.safeParse({ strategies: [] }).success).toBe(false);
  });
});

describe('discoveryQuerySchema', () => {
  it('accepts a query in the internal catalog vocabulary', () => {
    const parsed = discoveryQuerySchema.safeParse({
      geography: { countries: ['NL', 'DE'], excludedCountries: ['BE'], regions: ['BENELUX'] },
      companyProfile: {
        industries: ['SOFTWARE_SAAS'],
        employeeMin: 50,
        employeeMax: 500,
        companyTypes: ['PE_BACKED'],
        maturity: ['SCALE_UP'],
      },
      technology: { requiredTechnologies: ['KUBERNETES'] },
      limit: 50,
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects a country or industry the criteria contract does not know', () => {
    expect(discoveryQuerySchema.safeParse({ geography: { countries: ['XX'] } }).success).toBe(false);
    expect(
      discoveryQuerySchema.safeParse({ companyProfile: { industries: ['CROPS'] } }).success,
    ).toBe(false);
  });

  it('rejects a provider term leaking into the internal query', () => {
    // The internal query is provider-neutral by contract, so Apollo's own
    // vocabulary must not validate against it.
    expect(
      discoveryQuerySchema.safeParse({ geography: { countries: ['Netherlands'] } }).success,
    ).toBe(false);
    expect(
      discoveryQuerySchema.safeParse({
        organization_locations: ['Netherlands'],
      }).success,
    ).toBe(false);
  });
});
