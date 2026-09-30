import type { PersonCandidate, PersonCompany } from '@pursuit/shared';

/**
 * Normalized candidates, as the Apollo adapter would hand them over.
 *
 * Deliberately built at the *domain* contract rather than from Apollo payloads:
 * candidate processing is provider-neutral, and a fixture that started as
 * Apollo JSON would quietly make these tests depend on the adapter. The Apollo
 * normalizer has its own suite for the crossing itself.
 *
 * The people and the companies are fictional; `Voorbeeld` is Dutch for
 * "example".
 */

export function company(overrides: Partial<PersonCompany> = {}): PersonCompany {
  return {
    externalId: 'org-voorbeeld',
    name: 'Voorbeeld Software B.V.',
    domain: 'voorbeeld-software.nl',
    industry: 'information technology & services',
    industryCodes: ['IT_SERVICES'],
    employeeCount: 240,
    website: 'https://www.voorbeeld-software.nl/',
    location: 'Amsterdam, North Holland, Netherlands',
    country: 'NL',
    ...overrides,
  };
}

export interface PersonOverrides extends Partial<Omit<PersonCandidate, 'company'>> {
  /** `null` means "the provider reported no employer", which is not the default. */
  company?: PersonCompany | null;
}

export function person(id: string, overrides: PersonOverrides = {}): PersonCandidate {
  const { company: employer, ...rest } = overrides;
  const resolved = employer === undefined ? company() : employer;

  return {
    providerRefs: [{ provider: 'apollo', externalId: id }],
    name: 'Sanne de Vries',
    title: 'Chief Technology Officer',
    seniority: 'c_suite',
    seniorityCodes: ['C_LEVEL'],
    department: 'information_technology',
    departmentCodes: ['ENGINEERING', 'IT'],
    location: 'Utrecht, Utrecht, Netherlands',
    linkedinUrl: `https://www.linkedin.com/in/${id}`,
    emailStatus: 'verified',
    ...(resolved === null ? {} : { company: resolved }),
    rawSourceRef: `apollo:person:${id}`,
    ...rest,
  };
}
