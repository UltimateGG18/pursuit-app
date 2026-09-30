/**
 * Mocked Apollo people *enrichment* payloads.
 *
 * Shaped to the documented contracts at
 * <https://docs.apollo.io/reference/people-enrichment> and
 * <https://docs.apollo.io/reference/bulk-people-enrichment>. No field here is
 * invented and no fixture contains a real API key.
 *
 * Unlike the search fixtures, these *do* carry email addresses and phone
 * numbers - that is the whole point of the endpoint, and a fixture without them
 * would test a normalizer against data it will never see. Every value is
 * fictional: the addresses are on `example.com`, which RFC 2606 reserves
 * precisely so it can never reach a real mailbox, and the numbers are in the
 * `555-01xx` range reserved for fiction.
 *
 * The people are fictional too. `Voorbeeld` is Dutch for "example".
 */

export interface ApolloPhoneFixture {
  raw_number?: string | null;
  sanitized_number?: string | null;
  type?: string | null;
  status?: string | null;
}

export interface ApolloEnrichedOrganizationFixture {
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

export interface ApolloEnrichedPersonFixture {
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
  email?: string | null;
  email_status?: string | null;
  phone_numbers?: ApolloPhoneFixture[] | null;
  organization?: ApolloEnrichedOrganizationFixture | null;
  organization_id?: string | null;
  organization_name?: string | null;
  /** Apollo's identification confidence, where it reports one. */
  match_confidence?: string | null;
}

/** A fully enriched person: LinkedIn, work email and a mobile number. */
export function apolloEnrichedPerson(
  overrides: Partial<ApolloEnrichedPersonFixture> = {},
): ApolloEnrichedPersonFixture {
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
    email: 'sanne.de.vries@example.com',
    email_status: 'verified',
    phone_numbers: [
      { raw_number: '+31 20 555 0142', sanitized_number: '+31205550142', type: 'mobile', status: 'valid_number' },
    ],
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
    match_confidence: 'high',
    ...overrides,
  };
}

/** The minimum Apollo can return: an id and nothing else. */
export function sparseEnrichedPerson(id = 'sparse-enriched-1'): ApolloEnrichedPersonFixture {
  return { id };
}

export interface ApolloBulkMatchResponseFixture {
  matches: (ApolloEnrichedPersonFixture | null)[];
  status?: string;
  total_requested_enrichments?: number;
  unique_enriched_records?: number;
  missing_records?: number;
  credits_consumed?: number;
}

/**
 * A bulk response, with the counts Apollo derives from `matches`.
 *
 * Derived rather than passed in so a fixture can never claim two enriched
 * records while carrying one - a self-inconsistent fixture tests nothing.
 */
export function apolloBulkMatchResponse(
  matches: (ApolloEnrichedPersonFixture | null)[],
  overrides: Partial<ApolloBulkMatchResponseFixture> = {},
): ApolloBulkMatchResponseFixture {
  const found = matches.filter((match) => match !== null).length;
  return {
    matches,
    status: 'success',
    total_requested_enrichments: matches.length,
    unique_enriched_records: found,
    missing_records: matches.length - found,
    credits_consumed: found,
    ...overrides,
  };
}
