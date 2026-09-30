import { describe, expect, it } from 'vitest';
import { canonicalLinkedinUrl, enrichmentIdentityFor, reachabilityFor } from '@pursuit/shared';
import type { PersonCandidate } from '@pursuit/shared';
import { apolloEnrichedPersonSchema } from '../src/modules/apollo/apollo-enrichment-dto.js';
import {
  normalizeApolloEnrichedPerson,
  normalizePhoneNumbers,
  normalizeWorkEmail,
  phoneStateFor,
  readMatchConfidence,
  unenrichedProspect,
} from '../src/modules/apollo/apollo-enrichment-normalizer.js';
import {
  apolloEnrichedPerson,
  sparseEnrichedPerson,
  type ApolloEnrichedPersonFixture,
} from './apollo-enrichment-fixtures.js';

/**
 * The enrichment crossing point.
 *
 * Every assertion here is a variation on one rule: what the provider returned
 * survives, and what it did not return stays absent. A normalizer that fills a
 * gap - with a patterned address, a constructed profile URL, a reformatted
 * number - produces contact details for a person nobody can actually reach, and
 * nothing downstream can tell that it happened.
 */

const ENRICHED_AT = '2026-09-16T10:00:00.000Z';

function normalize(fixture: ApolloEnrichedPersonFixture, revealPhoneNumbers = true) {
  // Parsed through the real schema rather than cast, so a fixture that would
  // not survive validation cannot pass a normalizer test.
  const parsed = apolloEnrichedPersonSchema.parse(fixture);
  return normalizeApolloEnrichedPerson(parsed, {
    personRef: 'apollo:person:6a1b2c3d4e5f60718293a4b5',
    revealPhoneNumbers,
    enrichedAt: ENRICHED_AT,
  });
}

describe('normalizeApolloEnrichedPerson - identifiers', () => {
  it('preserves the Apollo person id', () => {
    expect(normalize(apolloEnrichedPerson()).externalPersonId).toBe('6a1b2c3d4e5f60718293a4b5');
  });

  it('preserves the Apollo organization id', () => {
    expect(normalize(apolloEnrichedPerson()).externalOrganizationId).toBe(
      '5f2a1b3c4d5e6f7a8b9c0d1e',
    );
  });

  it('falls back to the denormalized organization id when there is no nested block', () => {
    const prospect = normalize(
      apolloEnrichedPerson({ organization: null, organization_id: 'denormalized-org' }),
    );
    expect(prospect.externalOrganizationId).toBe('denormalized-org');
  });

  it('keeps the person ref it was given, so the join back is exact', () => {
    expect(normalize(apolloEnrichedPerson()).personRef).toBe(
      'apollo:person:6a1b2c3d4e5f60718293a4b5',
    );
  });

  it('names the provider that produced the record', () => {
    expect(normalize(apolloEnrichedPerson()).provider).toBe('apollo');
  });
});

describe('normalizeApolloEnrichedPerson - LinkedIn', () => {
  it('preserves the profile URL Apollo returned', () => {
    expect(normalize(apolloEnrichedPerson()).person.linkedinUrl).toBe(
      'https://www.linkedin.com/in/sanne-de-vries',
    );
  });

  it('strips tracking parameters and a trailing slash', () => {
    const prospect = normalize(
      apolloEnrichedPerson({
        linkedin_url: 'https://nl.linkedin.com/in/sanne-de-vries/?trk=public_profile',
      }),
    );
    // A locale subdomain, a query string and a trailing slash identify nothing
    // about the profile, and the tracking parameter records where the link was
    // found rather than who it points at.
    expect(prospect.person.linkedinUrl).toBe('https://www.linkedin.com/in/sanne-de-vries');
  });

  it('leaves LinkedIn absent when Apollo returned none', () => {
    const prospect = normalize(apolloEnrichedPerson({ linkedin_url: null }));
    expect(prospect.person.linkedinUrl).toBeUndefined();
    expect(prospect.reachability.hasLinkedIn).toBe(false);
  });

  it('never builds a profile URL from the person\'s name', () => {
    const prospect = normalize(sparseEnrichedPerson());
    expect(prospect.person.linkedinUrl).toBeUndefined();
    expect(JSON.stringify(prospect)).not.toContain('linkedin.com');
  });

  it('rejects a URL that is not a LinkedIn profile path', () => {
    // A broken profile link is worse than an absent one: a reader clicks it
    // before discovering it is wrong.
    const prospect = normalize(
      apolloEnrichedPerson({ linkedin_url: 'https://www.linkedin.com/company/voorbeeld' }),
    );
    expect(prospect.person.linkedinUrl).toBeUndefined();
  });
});

describe('normalizeWorkEmail', () => {
  it('preserves the address Apollo returned', () => {
    expect(normalizeWorkEmail('sanne.de.vries@example.com')).toBe('sanne.de.vries@example.com');
  });

  it('drops Apollo\'s masked placeholder, because a refusal is not an address', () => {
    // Showing `email_not_unlocked@...` to a user - or mailing it - would be
    // acting on a refusal as though it were data.
    expect(normalizeWorkEmail('email_not_unlocked@domain.com')).toBeUndefined();
  });

  it('drops a value that is not an address at all', () => {
    expect(normalizeWorkEmail('not-an-address')).toBeUndefined();
    expect(normalizeWorkEmail('@example.com')).toBeUndefined();
    expect(normalizeWorkEmail('sanne@')).toBeUndefined();
  });

  it('treats an empty or whitespace-only value as absent', () => {
    expect(normalizeWorkEmail('')).toBeUndefined();
    expect(normalizeWorkEmail('   ')).toBeUndefined();
    expect(normalizeWorkEmail(undefined)).toBeUndefined();
  });
});

describe('normalizeApolloEnrichedPerson - email', () => {
  it('preserves the work email and its status', () => {
    const prospect = normalize(apolloEnrichedPerson());
    expect(prospect.contact.workEmail).toBe('sanne.de.vries@example.com');
    expect(prospect.contact.emailStatus).toBe('verified');
  });

  it('keeps the status even when the address itself was not revealed', () => {
    const prospect = normalize(
      apolloEnrichedPerson({ email: null, email_status: 'unavailable' }),
    );
    expect(prospect.contact.workEmail).toBeUndefined();
    // The status is still a fact, and it is a different fact from "Apollo said
    // nothing about this person's email at all".
    expect(prospect.contact.emailStatus).toBe('unavailable');
  });

  it('never invents an address from the name and the company domain', () => {
    const prospect = normalize(apolloEnrichedPerson({ email: null }));
    expect(prospect.contact.workEmail).toBeUndefined();
    expect(JSON.stringify(prospect)).not.toContain('@voorbeeld-software.nl');
  });

  it('does not invent a status Apollo did not send', () => {
    const prospect = normalize(apolloEnrichedPerson({ email_status: null }));
    expect(prospect.contact.emailStatus).toBeUndefined();
  });
});

describe('normalizePhoneNumbers', () => {
  it('prefers the sanitized number over the raw one', () => {
    const { phoneNumbers } = normalizePhoneNumbers([
      { raw_number: '+31 20 555 0142', sanitized_number: '+31205550142', type: 'mobile' },
    ]);
    // Apollo's own normalized rendering. Reformatting it here would invent a
    // format the provider did not use.
    expect(phoneNumbers[0]?.number).toBe('+31205550142');
  });

  it('falls back to the raw number when there is no sanitized one', () => {
    const { phoneNumbers } = normalizePhoneNumbers([{ raw_number: '+31 20 555 0142' }]);
    expect(phoneNumbers[0]?.number).toBe('+31 20 555 0142');
  });

  it('preserves the provider\'s own type and status labels verbatim', () => {
    const { phoneNumbers } = normalizePhoneNumbers([
      { sanitized_number: '+31205550142', type: 'work_hq', status: 'valid_number' },
    ]);
    expect(phoneNumbers[0]).toEqual({
      number: '+31205550142',
      type: 'work_hq',
      status: 'valid_number',
    });
  });

  it('reports a still-running reveal as pending rather than as a number', () => {
    const { phoneNumbers, pending } = normalizePhoneNumbers([
      { sanitized_number: 'pending', status: 'pending' },
    ]);
    // A placeholder record is not a number. Treating it as one would show a
    // user something nobody can dial.
    expect(phoneNumbers).toHaveLength(0);
    expect(pending).toBe(true);
  });

  it('returns an empty list for no phone data, never a placeholder', () => {
    expect(normalizePhoneNumbers(undefined).phoneNumbers).toEqual([]);
    expect(normalizePhoneNumbers([]).phoneNumbers).toEqual([]);
  });
});

describe('phoneStateFor', () => {
  it('distinguishes all four states', () => {
    expect(phoneStateFor({ requested: false, found: 0, pending: false })).toBe('NOT_REQUESTED');
    expect(phoneStateFor({ requested: true, found: 1, pending: false })).toBe('AVAILABLE');
    expect(phoneStateFor({ requested: true, found: 0, pending: true })).toBe('PENDING');
    expect(phoneStateFor({ requested: true, found: 0, pending: false })).toBe('NONE');
  });

  it('does not claim a reveal is pending when none was requested', () => {
    expect(phoneStateFor({ requested: false, found: 0, pending: true })).toBe('NOT_REQUESTED');
  });
});

describe('normalizeApolloEnrichedPerson - phone', () => {
  it('preserves the numbers Apollo returned', () => {
    const prospect = normalize(apolloEnrichedPerson());
    expect(prospect.contact.phoneNumbers).toEqual([
      { number: '+31205550142', type: 'mobile', status: 'valid_number' },
    ]);
    expect(prospect.contact.phoneState).toBe('AVAILABLE');
  });

  it('leaves the list empty when Apollo returned none, and says why', () => {
    const prospect = normalize(apolloEnrichedPerson({ phone_numbers: null }));
    expect(prospect.contact.phoneNumbers).toEqual([]);
    expect(prospect.contact.phoneState).toBe('NONE');
  });

  it('reports NOT_REQUESTED when phone reveal was switched off', () => {
    const prospect = normalize(apolloEnrichedPerson({ phone_numbers: null }), false);
    // "Nobody has a number" and "we did not ask for numbers" are identical
    // result sets with opposite meanings.
    expect(prospect.contact.phoneState).toBe('NOT_REQUESTED');
  });

  it('never manufactures a number from the company data', () => {
    const prospect = normalize(apolloEnrichedPerson({ phone_numbers: [] }));
    expect(prospect.contact.phoneNumbers).toEqual([]);
  });
});

describe('readMatchConfidence', () => {
  it('reads the confidence Apollo reported', () => {
    expect(readMatchConfidence({ match_confidence: 'high' })).toBe('high');
    expect(readMatchConfidence({ match_confidence: 'Medium' })).toBe('medium');
    expect(readMatchConfidence({ confidence: 'low' })).toBe('low');
    expect(readMatchConfidence({ match_confidence: 'none' })).toBe('none');
  });

  it('stays unknown rather than defaulting when Apollo reported none', () => {
    // A fabricated `high` would be a claim about identity that nobody made.
    expect(readMatchConfidence({})).toBeUndefined();
    expect(readMatchConfidence({ match_confidence: 'extremely-sure' })).toBeUndefined();
  });
});

describe('normalizeApolloEnrichedPerson - status', () => {
  it('is ENRICHED when at least one contact channel came back', () => {
    expect(normalize(apolloEnrichedPerson()).enrichment.status).toBe('ENRICHED');
  });

  it('is ENRICHED on LinkedIn alone, because that is a real channel', () => {
    const prospect = normalize(
      apolloEnrichedPerson({ email: null, phone_numbers: null }),
    );
    expect(prospect.enrichment.status).toBe('ENRICHED');
    expect(prospect.reachability.channels).toEqual(['LINKEDIN']);
  });

  it('is PARTIAL when the person was identified but carries no channel at all', () => {
    const prospect = normalize(
      apolloEnrichedPerson({
        linkedin_url: null,
        email: null,
        email_status: null,
        phone_numbers: null,
      }),
    );
    // Apollo told us who they are and nothing about how to talk to them, which
    // is a different answer from "Apollo does not know them".
    expect(prospect.enrichment.status).toBe('PARTIAL');
    expect(prospect.reachability.channels).toEqual([]);
  });

  it('preserves the match confidence rather than converting it to a score', () => {
    expect(normalize(apolloEnrichedPerson()).enrichment.matchConfidence).toBe('high');
  });

  it('records when the provider answered', () => {
    expect(normalize(apolloEnrichedPerson()).enrichment.enrichedAt).toBe(ENRICHED_AT);
  });

  it('normalizes the sparsest possible record without inventing anything', () => {
    const prospect = normalize(sparseEnrichedPerson());
    expect(prospect.externalPersonId).toBe('sparse-enriched-1');
    expect(prospect.person).toEqual({});
    expect(prospect.company).toEqual({});
    expect(prospect.contact.workEmail).toBeUndefined();
    expect(prospect.enrichment.status).toBe('PARTIAL');
  });
});

describe('unenrichedProspect', () => {
  it('reports a no-match as a confidence of none', () => {
    const prospect = unenrichedProspect({
      personRef: 'apollo:person:abc',
      status: 'NO_MATCH',
      detail: 'not identified',
    });
    // Apollo was asked and said it could not identify the person, which *is* a
    // confidence of none - not a fabricated one.
    expect(prospect.enrichment.matchConfidence).toBe('none');
  });

  it('reports no confidence for a failure, because the provider never judged', () => {
    const prospect = unenrichedProspect({
      personRef: 'apollo:person:abc',
      status: 'UNAVAILABLE',
      detail: 'plan does not include enrichment',
    });
    expect(prospect.enrichment.matchConfidence).toBeUndefined();
  });

  it('is reachable on nothing, and carries no contact data', () => {
    const prospect = unenrichedProspect({
      personRef: 'apollo:person:abc',
      status: 'FAILED',
      detail: 'provider error',
    });
    expect(prospect.reachability.channels).toEqual([]);
    expect(prospect.contact.phoneNumbers).toEqual([]);
    expect(prospect.contact.workEmail).toBeUndefined();
  });
});

describe('reachabilityFor', () => {
  const cases: {
    name: string;
    input: Parameters<typeof reachabilityFor>[0];
    channels: string[];
  }[] = [
    {
      name: 'LinkedIn only',
      input: { linkedinUrl: 'https://www.linkedin.com/in/a', phoneNumbers: [] },
      channels: ['LINKEDIN'],
    },
    {
      name: 'email only',
      input: { workEmail: 'a@example.com', phoneNumbers: [] },
      channels: ['EMAIL'],
    },
    {
      name: 'phone only',
      input: { phoneNumbers: [{ number: '+31205550142' }] },
      channels: ['PHONE'],
    },
    {
      name: 'LinkedIn and email',
      input: {
        linkedinUrl: 'https://www.linkedin.com/in/a',
        workEmail: 'a@example.com',
        phoneNumbers: [],
      },
      channels: ['LINKEDIN', 'EMAIL'],
    },
    {
      name: 'all three',
      input: {
        linkedinUrl: 'https://www.linkedin.com/in/a',
        workEmail: 'a@example.com',
        phoneNumbers: [{ number: '+31205550142' }],
      },
      channels: ['LINKEDIN', 'EMAIL', 'PHONE'],
    },
    { name: 'no channels', input: { phoneNumbers: [] }, channels: [] },
  ];

  for (const testCase of cases) {
    it(`reports ${testCase.name}`, () => {
      // Independent booleans, never a score: a prospect with LinkedIn only is
      // fully reachable through LinkedIn.
      expect(reachabilityFor(testCase.input).channels).toEqual(testCase.channels);
    });
  }
});

describe('canonicalLinkedinUrl', () => {
  it('keeps the profile slug\'s case, because LinkedIn slugs are case-sensitive', () => {
    expect(canonicalLinkedinUrl('https://www.linkedin.com/in/Sanne-De-Vries')).toBe(
      'https://www.linkedin.com/in/Sanne-De-Vries',
    );
  });

  it('returns undefined for anything that is not a profile URL', () => {
    expect(canonicalLinkedinUrl('https://example.com/in/a')).toBeUndefined();
    expect(canonicalLinkedinUrl('linkedin.com')).toBeUndefined();
    expect(canonicalLinkedinUrl('')).toBeUndefined();
    expect(canonicalLinkedinUrl(null)).toBeUndefined();
  });
});

describe('enrichmentIdentityFor', () => {
  function candidate(overrides: Partial<PersonCandidate> = {}): PersonCandidate {
    return {
      providerRefs: [{ provider: 'apollo', externalId: '6a1b2c3d4e5f60718293a4b5' }],
      name: 'Sanne de Vries',
      rawSourceRef: 'apollo:person:6a1b2c3d4e5f60718293a4b5',
      ...overrides,
    };
  }

  it('prefers the provider\'s own person id', () => {
    expect(enrichmentIdentityFor(candidate(), 'apollo')).toMatchObject({
      basis: 'PROVIDER_ID',
      externalPersonId: '6a1b2c3d4e5f60718293a4b5',
    });
  });

  it('falls back to a LinkedIn profile URL', () => {
    const identity = enrichmentIdentityFor(
      candidate({
        providerRefs: [{ provider: 'other', externalId: 'x' }],
        linkedinUrl: 'https://nl.linkedin.com/in/sanne-de-vries/',
      }),
      'apollo',
    );
    expect(identity).toMatchObject({
      basis: 'LINKEDIN_URL',
      linkedinUrl: 'https://www.linkedin.com/in/sanne-de-vries',
    });
  });

  it('falls back to a name with a company domain, but only with both', () => {
    const identity = enrichmentIdentityFor(
      candidate({
        providerRefs: [{ provider: 'other', externalId: 'x' }],
        company: { domain: 'voorbeeld-software.nl' },
      }),
      'apollo',
    );
    expect(identity).toMatchObject({ basis: 'NAME_AND_DOMAIN', domain: 'voorbeeld-software.nl' });
  });

  it('refuses to identify a person by name alone', () => {
    // A name alone matches every namesake the provider holds, and a wrongly
    // matched person produces contact details for somebody else.
    const identity = enrichmentIdentityFor(
      candidate({ providerRefs: [{ provider: 'other', externalId: 'x' }] }),
      'apollo',
    );
    expect(identity).toBeUndefined();
  });
});
