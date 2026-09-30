/**
 * Mocked Apollo people payloads.
 *
 * Shaped to the documented people search contract:
 * <https://docs.apollo.io/reference/people-search>. No field here is invented,
 * no fixture contains a real API key, and - deliberately - no fixture contains
 * an email address: the adapter never reads one, so a fixture carrying one
 * would test a field that does not exist.
 *
 * The people are fictional. `Voorbeeld` is Dutch for "example".
 */

export interface ApolloPersonOrganizationFixture {
  id?: string | null;
  name?: string | null;
  website_url?: string | null;
  primary_domain?: string | null;
  linkedin_url?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface ApolloPersonFixture {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  title?: string | null;
  seniority?: string | null;
  departments?: string[] | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  email_status?: string | null;
  organization?: ApolloPersonOrganizationFixture | null;
  organization_name?: string | null;
  organization_id?: string | null;
}

/** A fully populated person, as Apollo returns one for a well-known contact. */
export function apolloPerson(overrides: Partial<ApolloPersonFixture> = {}): ApolloPersonFixture {
  return {
    id: '6a1b2c3d4e5f60718293a4b5',
    first_name: 'Sanne',
    last_name: 'de Vries',
    name: 'Sanne de Vries',
    title: 'Chief Technology Officer',
    seniority: 'c_suite',
    departments: ['information_technology'],
    linkedin_url: 'https://www.linkedin.com/in/sanne-de-vries',
    city: 'Utrecht',
    state: 'Utrecht',
    country: 'Netherlands',
    email_status: 'verified',
    organization: {
      id: '5f2a1b3c4d5e6f7a8b9c0d1e',
      name: 'Voorbeeld Software B.V.',
      website_url: 'http://www.voorbeeld-software.nl',
      primary_domain: 'voorbeeld-software.nl',
      linkedin_url: 'https://www.linkedin.com/company/voorbeeld-software',
      industry: 'information technology & services',
      estimated_num_employees: 240,
      city: 'Amsterdam',
      state: 'North Holland',
      country: 'Netherlands',
    },
    ...overrides,
  };
}

/**
 * The minimum Apollo can return: an id and nothing else. Exercised because it
 * is the shape most likely to break a normalizer that assumes fields exist.
 */
export function sparseApolloPerson(id = 'sparse-person-1'): ApolloPersonFixture {
  return { id };
}

export interface ApolloPeopleSearchResponseFixture {
  people: ApolloPersonFixture[];
  contacts: ApolloPersonFixture[];
  pagination: { page: number; per_page: number; total_entries: number; total_pages: number };
}

export function apolloPeopleResponse(
  people: ApolloPersonFixture[],
  options: {
    contacts?: ApolloPersonFixture[];
    pagination?: Partial<ApolloPeopleSearchResponseFixture['pagination']>;
  } = {},
): ApolloPeopleSearchResponseFixture {
  const contacts = options.contacts ?? [];
  return {
    people,
    contacts,
    pagination: {
      page: 1,
      per_page: 25,
      total_entries: people.length + contacts.length,
      total_pages: 1,
      ...options.pagination,
    },
  };
}
