import { describe, expect, it } from 'vitest';
import { apolloOrganizationSchema } from '../src/modules/apollo/apollo-dto.js';
import {
  normalizeApolloOrganization,
  normalizeApolloOrganizations,
  normalizeEmployeeCount,
  normalizeLocations,
  normalizeTechnologies,
  normalizeWebsite,
  toProviderRef,
  toRawSourceRef,
} from '../src/modules/apollo/apollo-normalizer.js';
import {
  apolloOrganization,
  sparseApolloOrganization,
  type ApolloOrganizationFixture,
} from './apollo-fixtures.js';

/**
 * Normalization runs on a *validated* DTO, never on raw JSON, so the fixture
 * goes through the schema first. That is the real call path, and it keeps a
 * test from asserting behaviour on a shape the client would have rejected.
 */
function dto(fixture: ApolloOrganizationFixture) {
  return apolloOrganizationSchema.parse(fixture);
}

function normalize(fixture: ApolloOrganizationFixture) {
  return normalizeApolloOrganization(dto(fixture));
}

describe('ApolloNormalizer - a fully populated company', () => {
  it('maps every documented firmographic field onto the neutral contract', () => {
    const candidate = normalize(apolloOrganization());

    expect(candidate).toEqual({
      providerRefs: [{ provider: 'apollo', externalId: '5f2a1b3c4d5e6f7a8b9c0d1e' }],
      name: 'Voorbeeld Software B.V.',
      domain: 'voorbeeld-software.nl',
      country: 'NL',
      industry: 'information technology & services',
      employeeCount: 240,
      website: 'http://www.voorbeeld-software.nl/',
      technologies: ['Microsoft Azure', 'Kubernetes', 'Salesforce'],
      locations: ['Amsterdam, North Holland, Netherlands'],
      rawSourceRef: 'apollo:organization:5f2a1b3c4d5e6f7a8b9c0d1e',
    });
  });

  it('leaks no Apollo field name into the candidate', () => {
    const candidate = normalize(apolloOrganization());
    const keys = Object.keys(candidate);

    // The contract's keys, and nothing snake_cased or Apollo-specific.
    expect(keys).not.toContain('estimated_num_employees');
    expect(keys).not.toContain('primary_domain');
    expect(keys).not.toContain('website_url');
    expect(keys).not.toContain('technology_names');
    expect(keys.some((key) => key.includes('_'))).toBe(false);
    expect(keys.some((key) => key.toLowerCase().includes('apollo'))).toBe(false);
  });
});

describe('ApolloNormalizer - missing optional fields', () => {
  it('normalizes an organization carrying only an id', () => {
    const candidate = normalize(sparseApolloOrganization('only-an-id'));

    // Every unknown field is absent rather than null or zero, so a later stage
    // can tell "not reported" from "reported as empty".
    expect(candidate).toEqual({
      providerRefs: [{ provider: 'apollo', externalId: 'only-an-id' }],
      name: 'apollo:only-an-id',
      rawSourceRef: 'apollo:organization:only-an-id',
    });
    expect('domain' in candidate).toBe(false);
    expect('employeeCount' in candidate).toBe(false);
    expect('country' in candidate).toBe(false);
  });

  it('does not discard a company for being thinly populated', () => {
    // Discovery is recall-first: a sparse company is a candidate, and judging
    // it is a later stage's job.
    const candidates = normalizeApolloOrganizations([
      dto(apolloOrganization()),
      dto(sparseApolloOrganization('sparse')),
    ]);
    expect(candidates).toHaveLength(2);
  });

  it('falls back to the domain, then the id, for a company with no name', () => {
    expect(normalize({ id: 'x1', primary_domain: 'example.com' }).name).toBe('example.com');
    expect(normalize({ id: 'x2', name: '   ' }).name).toBe('apollo:x2');
  });

  it('treats null and whitespace-only values as not reported', () => {
    const candidate = normalize({
      id: 'blank',
      name: 'Blank B.V.',
      industry: '   ',
      country: null,
      primary_domain: '',
      technology_names: [],
    });

    expect('industry' in candidate).toBe(false);
    expect('country' in candidate).toBe(false);
    expect('domain' in candidate).toBe(false);
    expect('technologies' in candidate).toBe(false);
  });
});

describe('ApolloNormalizer - domain normalization', () => {
  it('prefers primary_domain over website_url', () => {
    expect(
      normalize({
        id: 'd1',
        primary_domain: 'canonical.example',
        website_url: 'https://other.example',
      }).domain,
    ).toBe('canonical.example');
  });

  it('derives a domain from website_url when primary_domain is absent', () => {
    expect(normalize({ id: 'd2', website_url: 'https://WWW.Example.COM/careers' }).domain).toBe(
      'example.com',
    );
  });

  it('strips scheme, www, port, path and case', () => {
    const cases: [string, string | undefined][] = [
      ['example.com', 'example.com'],
      ['WWW.Example.com', 'example.com'],
      ['https://www.example.com/', 'example.com'],
      ['http://example.com:8080/path?q=1', 'example.com'],
      ['https://sub.example.co.uk/x', 'sub.example.co.uk'],
      ['example.com.', 'example.com'],
    ];
    for (const [input, expected] of cases) {
      expect(normalize({ id: 'd', primary_domain: input }).domain).toBe(expected);
    }
  });

  it('leaves an unusable domain unknown rather than storing a bad key', () => {
    // No dot, or not host-shaped: a wrong dedupe key is worse than none.
    for (const input of ['localhost', 'not a domain', 'http://', '::::']) {
      expect('domain' in normalize({ id: 'd', primary_domain: input })).toBe(false);
    }
  });
});

describe('ApolloNormalizer - website normalization', () => {
  it('makes a bare host into an absolute https URL', () => {
    expect(normalizeWebsite('example.com')).toBe('https://example.com/');
  });

  it('preserves an already absolute URL', () => {
    expect(normalizeWebsite('https://example.com/products')).toBe('https://example.com/products');
  });

  it('drops a value that cannot be a website', () => {
    expect(normalizeWebsite(undefined)).toBeUndefined();
    expect(normalizeWebsite('   ')).toBeUndefined();
    expect(normalizeWebsite('localhost')).toBeUndefined();
    expect(normalizeWebsite('ftp://example.com')).toBeUndefined();
  });
});

describe('ApolloNormalizer - employee count normalization', () => {
  it('keeps a reported count, including zero', () => {
    expect(normalizeEmployeeCount(240)).toBe(240);
    // Zero is a reported fact, not a missing one.
    expect(normalizeEmployeeCount(0)).toBe(0);
  });

  it('treats an impossible count as unknown rather than clamping it', () => {
    expect(normalizeEmployeeCount(undefined)).toBeUndefined();
    expect(normalizeEmployeeCount(-5)).toBeUndefined();
    expect(normalizeEmployeeCount(Number.NaN)).toBeUndefined();
  });
});

describe('ApolloNormalizer - technology normalization', () => {
  it('keeps Apollo\'s own labels instead of mapping to the internal catalog', () => {
    // Mapping here would silently drop everything the catalog has no entry for.
    expect(normalizeTechnologies(['Microsoft Azure', 'Kubernetes'])).toEqual([
      'Microsoft Azure',
      'Kubernetes',
    ]);
  });

  it('trims, de-duplicates and drops empties, preserving first-seen order', () => {
    expect(normalizeTechnologies([' Kubernetes ', 'Kubernetes', '', '  ', 'Docker'])).toEqual([
      'Kubernetes',
      'Docker',
    ]);
  });

  it('reports an empty list as unknown', () => {
    expect(normalizeTechnologies(undefined)).toBeUndefined();
    expect(normalizeTechnologies([])).toBeUndefined();
    expect(normalizeTechnologies(['  '])).toBeUndefined();
  });
});

describe('ApolloNormalizer - locations and country', () => {
  it('joins the most specific location the data supports', () => {
    expect(normalizeLocations(dto(apolloOrganization()))).toEqual([
      'Amsterdam, North Holland, Netherlands',
    ]);
    expect(normalizeLocations(dto({ id: 'l1', country: 'Germany' }))).toEqual(['Germany']);
    expect(normalizeLocations(dto({ id: 'l2', city: 'Berlin', country: 'Germany' }))).toEqual([
      'Berlin, Germany',
    ]);
  });

  it('reports no location at all rather than an empty string', () => {
    expect(normalizeLocations(dto({ id: 'l3' }))).toBeUndefined();
  });

  it('maps an Apollo country name to an ISO-2 code', () => {
    expect(normalize({ id: 'c1', country: 'Netherlands' }).country).toBe('NL');
    expect(normalize({ id: 'c2', country: 'United States' }).country).toBe('US');
    expect(normalize({ id: 'c3', country: 'united kingdom' }).country).toBe('GB');
  });

  it('resolves the alternative spellings Apollo actually returns', () => {
    expect(normalize({ id: 'c4', country: 'The Netherlands' }).country).toBe('NL');
    expect(normalize({ id: 'c5', country: 'USA' }).country).toBe('US');
    expect(normalize({ id: 'c6', country: 'England' }).country).toBe('GB');
  });

  it('leaves an unmappable country unknown instead of guessing', () => {
    // A wrong country code is worse than a missing one: a later geography
    // filter would act on it. `KR` is not in the catalog, so it has no code.
    expect('country' in normalize({ id: 'c7', country: 'South Korea' })).toBe(false);
    expect('country' in normalize({ id: 'c8', country: 'Atlantis' })).toBe(false);
    // The location line still keeps what Apollo said.
    expect(normalize({ id: 'c9', country: 'South Korea' }).locations).toEqual(['South Korea']);
  });
});

describe('ApolloNormalizer - provider reference and source reference', () => {
  it('builds the provider reference entity resolution will merge on', () => {
    expect(toProviderRef(dto(apolloOrganization()))).toEqual({
      provider: 'apollo',
      externalId: '5f2a1b3c4d5e6f7a8b9c0d1e',
    });
  });

  it('always attaches exactly one provider reference', () => {
    const candidate = normalize(sparseApolloOrganization('ref-1'));
    expect(candidate.providerRefs).toEqual([{ provider: 'apollo', externalId: 'ref-1' }]);
  });

  it('preserves a pointer back to the provider record', () => {
    expect(toRawSourceRef(dto(sparseApolloOrganization('src-1')))).toBe(
      'apollo:organization:src-1',
    );
  });
});

describe('ApolloNormalizer - what it deliberately does not do', () => {
  it('attaches no score, band, confidence or rejection reason', () => {
    const candidate = normalize(apolloOrganization()) as unknown as Record<string, unknown>;
    for (const forbidden of [
      'score',
      'finalScore',
      'band',
      'confidence',
      'rejectionReason',
      'state',
      'qualified',
      'icpFit',
    ]) {
      expect(forbidden in candidate).toBe(false);
    }
  });

  it('populates no contacts: they come from a different endpoint and a later slice', () => {
    expect('contacts' in normalize(apolloOrganization())).toBe(false);
  });
});
