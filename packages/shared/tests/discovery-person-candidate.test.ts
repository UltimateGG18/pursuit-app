import { describe, expect, it } from 'vitest';
import {
  dedupePersonCandidates,
  normalizeLinkedinUrl,
  personIdentityKeys,
  type PersonCandidate,
} from '../src/index.js';

function person(overrides: Partial<PersonCandidate> = {}): PersonCandidate {
  return {
    providerRefs: [{ provider: 'apollo', externalId: 'p1' }],
    name: 'Sanne de Vries',
    rawSourceRef: 'apollo:person:p1',
    ...overrides,
  };
}

describe('normalizeLinkedinUrl', () => {
  it.each([
    ['https://www.linkedin.com/in/sanne-de-vries', 'linkedin.com/in/sanne-de-vries'],
    ['http://nl.linkedin.com/in/sanne-de-vries/', 'linkedin.com/in/sanne-de-vries'],
    ['linkedin.com/in/sanne-de-vries?trk=public', 'linkedin.com/in/sanne-de-vries'],
    ['https://LinkedIn.com/IN/Sanne-De-Vries#about', 'linkedin.com/in/sanne-de-vries'],
    ['https://www.linkedin.com/pub/sanne-de-vries', 'linkedin.com/pub/sanne-de-vries'],
  ])('collapses %s to one comparable profile', (input, expected) => {
    expect(normalizeLinkedinUrl(input)).toBe(expected);
  });

  it.each([
    ['https://www.linkedin.com/company/voorbeeld'],
    ['https://example.com/in/sanne'],
    ['linkedin.com'],
    ['not a url'],
    [''],
    ['   '],
  ])('leaves %s unknown rather than guessing', (input) => {
    // An unusable value has to stay unknown: a bad dedupe key merges two real
    // people into one record that describes nobody.
    expect(normalizeLinkedinUrl(input)).toBeUndefined();
  });

  it('handles null and undefined', () => {
    expect(normalizeLinkedinUrl(null)).toBeUndefined();
    expect(normalizeLinkedinUrl(undefined)).toBeUndefined();
  });
});

describe('personIdentityKeys', () => {
  it('keys on the provider reference', () => {
    expect(personIdentityKeys(person())).toEqual(['ref:apollo:p1']);
  });

  it('adds the normalized LinkedIn profile when there is one', () => {
    const keys = personIdentityKeys(
      person({ linkedinUrl: 'https://www.linkedin.com/in/sanne-de-vries/' }),
    );
    expect(keys).toEqual(['ref:apollo:p1', 'linkedin:linkedin.com/in/sanne-de-vries']);
  });

  it('never keys on a name', () => {
    // Two people called "Jan de Vries" are not one person. Unlike a company,
    // where a normalized name plus a country is a reasonable last resort, a
    // name collision between humans is common and merging on it is silent and
    // wrong.
    const keys = personIdentityKeys(person({ name: 'Jan de Vries' }));
    expect(keys.some((key) => key.includes('jan'))).toBe(false);
  });
});

describe('dedupePersonCandidates', () => {
  it('keeps one row for a person returned twice under the same reference', () => {
    const result = dedupePersonCandidates([person(), person()]);
    expect(result).toHaveLength(1);
  });

  it('merges the provenance of a duplicate rather than discarding it', () => {
    const result = dedupePersonCandidates([
      person({
        providerRefs: [{ provider: 'apollo', externalId: 'p1' }],
        linkedinUrl: 'https://www.linkedin.com/in/sanne-de-vries',
      }),
      person({
        providerRefs: [{ provider: 'apollo', externalId: 'p2' }],
        linkedinUrl: 'http://nl.linkedin.com/in/sanne-de-vries/',
      }),
    ]);

    expect(result).toHaveLength(1);
    // Nothing a provider said about provenance is lost, so the later canonical
    // resolution stage still sees every external id.
    expect(result[0]?.providerRefs).toEqual([
      { provider: 'apollo', externalId: 'p1' },
      { provider: 'apollo', externalId: 'p2' },
    ]);
  });

  it('keeps the first-seen row and does not merge field values', () => {
    const result = dedupePersonCandidates([
      person({ title: 'CTO' }),
      person({ title: 'Chief Technology Officer' }),
    ]);

    // Choosing between two disagreeing titles is a resolution decision, and
    // dedupe makes no business decisions.
    expect(result[0]?.title).toBe('CTO');
  });

  it('keeps two people who share a name but nothing else', () => {
    const result = dedupePersonCandidates([
      person({ providerRefs: [{ provider: 'apollo', externalId: 'p1' }] }),
      person({ providerRefs: [{ provider: 'apollo', externalId: 'p2' }] }),
    ]);
    expect(result).toHaveLength(2);
  });

  it('returns an empty list unchanged', () => {
    expect(dedupePersonCandidates([])).toEqual([]);
  });
});
