import { describe, expect, it } from 'vitest';
import { apolloPersonSchema } from '../src/modules/apollo/apollo-people-dto.js';
import {
  normalizeApolloPeople,
  normalizeApolloPerson,
  normalizePersonCompany,
  normalizePersonName,
} from '../src/modules/apollo/apollo-people-normalizer.js';
import {
  apolloPerson,
  sparseApolloPerson,
  type ApolloPersonFixture,
} from './apollo-people-fixtures.js';

/**
 * The Apollo -> domain crossing for people.
 *
 * Every fixture goes through the DTO schema first, because that is the only
 * path a payload takes in production: normalizing a hand-built object would
 * test a shape the validator would never have let through.
 */
function parse(fixture: ApolloPersonFixture) {
  return apolloPersonSchema.parse(fixture);
}

function normalize(fixture: ApolloPersonFixture) {
  return normalizeApolloPerson(parse(fixture));
}

describe('apollo people normalizer - a fully populated person', () => {
  it('maps every reported field onto the neutral contract', () => {
    const person = normalize(apolloPerson());

    expect(person).toMatchObject({
      providerRefs: [{ provider: 'apollo', externalId: '6a1b2c3d4e5f60718293a4b5' }],
      name: 'Sanne de Vries',
      firstName: 'Sanne',
      lastName: 'de Vries',
      title: 'Chief Technology Officer',
      seniority: 'c_suite',
      department: 'information_technology',
      location: 'Utrecht, Utrecht, Netherlands',
      linkedinUrl: 'https://www.linkedin.com/in/sanne-de-vries',
      emailStatus: 'verified',
      rawSourceRef: 'apollo:person:6a1b2c3d4e5f60718293a4b5',
    });
  });

  it('carries the employer as company context, with the domain normalized', () => {
    const person = normalize(apolloPerson());

    expect(person.company).toEqual({
      externalId: '5f2a1b3c4d5e6f7a8b9c0d1e',
      name: 'Voorbeeld Software B.V.',
      // `http://www.voorbeeld-software.nl` and `voorbeeld-software.nl` have to
      // collapse to one key, or the same company reached two ways is two.
      domain: 'voorbeeld-software.nl',
      industry: 'information technology & services',
      // The catalog reading of that label, beside it rather than instead of it:
      // one is what Apollo said, the other is what a hard filter can compare.
      industryCodes: ['IT_SERVICES'],
      employeeCount: 240,
      website: 'http://www.voorbeeld-software.nl/',
      linkedinUrl: 'https://www.linkedin.com/company/voorbeeld-software',
      location: 'Amsterdam, North Holland, Netherlands',
      // The joined location line is for a reader; a geography filter needs a
      // code, and gets one only when Apollo's place name maps to a known one.
      country: 'NL',
    });
  });

  it('never carries an email address, only its status', () => {
    // The DTO does not declare `email`, so an address in the payload cannot
    // reach the domain even when Apollo sends one.
    const person = normalize(
      apolloPerson({ email: 'sanne@voorbeeld-software.nl' } as Partial<ApolloPersonFixture>),
    );

    expect(JSON.stringify(person)).not.toContain('@voorbeeld-software.nl');
    expect(person.emailStatus).toBe('verified');
  });
});

describe('apollo people normalizer - missing stays missing', () => {
  it('normalizes a person carrying nothing but an id', () => {
    const person = normalize(sparseApolloPerson());

    expect(person.providerRefs).toEqual([{ provider: 'apollo', externalId: 'sparse-person-1' }]);
    expect(person.rawSourceRef).toBe('apollo:person:sparse-person-1');
    // Absent, not null and not an empty string: a consumer must be able to tell
    // "Apollo reported nothing" from "Apollo reported an empty value".
    expect(person).not.toHaveProperty('title');
    expect(person).not.toHaveProperty('seniority');
    expect(person).not.toHaveProperty('location');
    expect(person).not.toHaveProperty('company');
  });

  it('treats an explicit null exactly as an omitted field', () => {
    const person = normalize(
      apolloPerson({ title: null, seniority: null, linkedin_url: null, organization: null }),
    );

    expect(person).not.toHaveProperty('title');
    expect(person).not.toHaveProperty('seniority');
    expect(person).not.toHaveProperty('linkedinUrl');
    expect(person).not.toHaveProperty('company');
  });

  it('drops a whitespace-only value rather than storing it', () => {
    const person = normalize(apolloPerson({ title: '   ' }));
    expect(person).not.toHaveProperty('title');
  });

  it('keeps a partial location as the most specific line the data supports', () => {
    const person = normalize(apolloPerson({ city: null, state: null, country: 'Netherlands' }));
    expect(person.location).toBe('Netherlands');
  });

  it('does not reject a person for being thinly populated', () => {
    // Discovery is recall-first. Deciding a lead is too thin is a later stage's
    // job, and dropping the row here would make that decision invisibly.
    const people = normalizeApolloPeople([parse(apolloPerson()), parse(sparseApolloPerson())]);
    expect(people).toHaveLength(2);
  });
});

describe('apollo people normalizer - the name', () => {
  it("prefers Apollo's own rendering", () => {
    const person = normalize(apolloPerson({ name: 'S. de Vries' }));
    expect(person.name).toBe('S. de Vries');
  });

  it('joins the parts when there is no full name', () => {
    expect(normalizePersonName(parse(apolloPerson({ name: null })))).toBe('Sanne de Vries');
  });

  it('falls back to the provenance rather than to an empty string', () => {
    const person = parse(sparseApolloPerson('abc123'));
    expect(normalizePersonName(person)).toBe('apollo:abc123');
  });
});

describe('apollo people normalizer - the company', () => {
  it('uses the denormalized copies when there is no nested organization', () => {
    // The shape a CRM `contacts[]` row arrives in.
    const company = normalizePersonCompany(
      parse(
        apolloPerson({
          organization: null,
          organization_id: 'org-9',
          organization_name: 'Voorbeeld Holding',
        }),
      ),
    );

    expect(company).toEqual({ externalId: 'org-9', name: 'Voorbeeld Holding' });
  });

  it('falls back to the website when there is no primary domain', () => {
    const company = normalizePersonCompany(
      parse(
        apolloPerson({
          organization: { primary_domain: null, website_url: 'https://WWW.Example.com/careers' },
        }),
      ),
    );

    expect(company?.domain).toBe('example.com');
  });

  it('leaves the company unknown when Apollo reported nothing about one', () => {
    const company = normalizePersonCompany(parse(sparseApolloPerson()));
    expect(company).toBeUndefined();
  });

  it('rejects a negative headcount as unknown instead of clamping it', () => {
    const company = normalizePersonCompany(
      parse(
        apolloPerson({
          organization: { name: 'Voorbeeld Software B.V.', estimated_num_employees: -5 },
        }),
      ),
    );

    // The rest of the company survives; only the impossible number is dropped,
    // and dropped rather than clamped to 0 - which would invent a headcount
    // Apollo never reported.
    expect(company).toEqual({ name: 'Voorbeeld Software B.V.' });
  });
});
