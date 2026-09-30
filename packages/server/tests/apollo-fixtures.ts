/**
 * Mocked Apollo payloads.
 *
 * Shaped to the documented organization search contract:
 * <https://docs.apollo.io/reference/organization-search>. No field here is
 * invented, and - deliberately - no fixture contains a real API key. The tests
 * use the string `test-apollo-key`, which is not a credential.
 */

export interface ApolloOrganizationFixture {
  id: string;
  name?: string | null;
  website_url?: string | null;
  primary_domain?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  technology_names?: string[] | null;
  keywords?: string[] | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  linkedin_url?: string | null;
  founded_year?: number | null;
  short_description?: string | null;
  postal_code?: string | null;
  street_address?: string | null;
}

/** A fully populated organization, as Apollo returns one for a known company. */
export function apolloOrganization(
  overrides: Partial<ApolloOrganizationFixture> = {},
): ApolloOrganizationFixture {
  return {
    id: '5f2a1b3c4d5e6f7a8b9c0d1e',
    name: 'Voorbeeld Software B.V.',
    website_url: 'http://www.voorbeeld-software.nl',
    primary_domain: 'voorbeeld-software.nl',
    industry: 'information technology & services',
    estimated_num_employees: 240,
    technology_names: ['Microsoft Azure', 'Kubernetes', 'Salesforce'],
    keywords: ['software', 'managed services'],
    city: 'Amsterdam',
    state: 'North Holland',
    country: 'Netherlands',
    linkedin_url: 'https://www.linkedin.com/company/voorbeeld-software',
    founded_year: 2009,
    short_description: 'Custom software and managed services.',
    postal_code: '1011 AB',
    street_address: 'Damrak 1',
    ...overrides,
  };
}

/**
 * The minimum Apollo can return: an id and nothing else. Exercised because it
 * is the shape most likely to break a normalizer that assumes fields exist.
 */
export function sparseApolloOrganization(id = 'sparse-1'): ApolloOrganizationFixture {
  return { id };
}

export interface ApolloSearchResponseFixture {
  organizations: ApolloOrganizationFixture[];
  accounts: unknown[];
  pagination: { page: number; per_page: number; total_entries: number; total_pages: number };
}

export function apolloSearchResponse(
  organizations: ApolloOrganizationFixture[],
  pagination: Partial<ApolloSearchResponseFixture['pagination']> = {},
): ApolloSearchResponseFixture {
  return {
    organizations,
    accounts: [],
    pagination: {
      page: 1,
      per_page: 25,
      total_entries: organizations.length,
      total_pages: 1,
      ...pagination,
    },
  };
}

/** An HTTP 200 carrying an organization search response. */
export function apolloJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A failure shaped the way Apollo sends one: `{ error, error_code }`. */
export function apolloErrorResponse(
  status: number,
  error: string,
  errorCode?: string,
  headers: Record<string, string> = {},
): Response {
  return apolloJsonResponse(
    { error, ...(errorCode !== undefined ? { error_code: errorCode } : {}) },
    status,
    headers,
  );
}
