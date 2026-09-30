import {
  normalizeCandidateDomain,
  uniqueStrings,
  type CompanyCandidate,
  type ProviderRef,
} from '@pursuit/shared';
import type { ApolloOrganizationDto } from './apollo-dto.js';
import { APOLLO_PROVIDER_ID } from './apollo-errors.js';
import { toCountryCode } from './apollo-vocabulary.js';

/**
 * Apollo organization -> `CompanyCandidate`.
 *
 * The boundary the implementation plan draws: everything upstream of this
 * function speaks Apollo, everything downstream speaks the domain, and this is
 * the single crossing point.
 *
 * Normalization answers exactly one question - *what company did the provider
 * return?* - and refuses the adjacent one. There is no scoring here, no
 * qualification, no rejection: an organization with no domain, no industry and
 * no employee count still normalizes into a candidate, because "Apollo knows
 * little about this company" is a fact for a later stage to weigh, not grounds
 * for discarding a row during discovery.
 *
 * The corresponding rule is that **missing stays missing**. No field is
 * defaulted, inferred or back-filled from another. `employeeCount: 0` means
 * Apollo reported zero; absent means Apollo reported nothing.
 */

/** Trims, and treats an empty or whitespace-only string as absent. */
function text(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Apollo's website URL, normalized to an absolute `https://` URL.
 *
 * Apollo is inconsistent here - `example.com`, `www.example.com` and
 * `https://example.com/` all occur - and a bare host is not a website a client
 * can link to. Anything that cannot be parsed as an http(s) URL is dropped
 * rather than patched, because a broken link is worse than a missing one.
 */
export function normalizeWebsite(value: string | undefined): string | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.hostname.length === 0 || !url.hostname.includes('.')) return undefined;
  return url.toString();
}

/**
 * The candidate's domain.
 *
 * `primary_domain` is preferred because it is the field Apollo curates for this
 * purpose; `website_url` is the fallback for a record that has one and not the
 * other. Both go through the same neutral normalizer as any other provider's
 * domain, so `WWW.Example.com/` and `example.com` produce one dedupe key.
 */
export function normalizeDomain(organization: ApolloOrganizationDto): string | undefined {
  return (
    normalizeCandidateDomain(organization.primary_domain) ??
    normalizeCandidateDomain(organization.website_url)
  );
}

/**
 * Employee count.
 *
 * Apollo's `estimated_num_employees` is an integer, but a headcount cannot be
 * negative and a non-finite value is not a count. Both are rejected as unknown
 * instead of being clamped, because clamping would invent a number the provider
 * never gave.
 */
export function normalizeEmployeeCount(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.trunc(value);
}

/**
 * Detected technologies, from Apollo's `technology_names`.
 *
 * Kept as Apollo's own labels - "Amazon AWS", "Microsoft Office 365" - and
 * deliberately *not* mapped onto the internal `TECHNOLOGIES` catalog. Mapping
 * here would silently discard everything the catalog has no entry for, turning
 * "Apollo detected 40 technologies" into "the company uses 3". Matching a
 * detected stack against the ICP's required technologies is a filtering
 * decision, and filtering is a later slice.
 *
 * Only shape is normalized: trimmed, de-duplicated, empties dropped.
 */
export function normalizeTechnologies(
  values: readonly string[] | undefined,
): string[] | undefined {
  if (values === undefined) return undefined;
  const cleaned = uniqueStrings(
    values.map((value) => value.trim()).filter((value) => value.length > 0),
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * The company's location as one human-readable line.
 *
 * Apollo reports `city`, `state` and `country` separately and populates them
 * unevenly. They are joined into the most specific line the data supports, so a
 * company with only a country still gets a location instead of an empty string.
 *
 * A list, because the domain contract carries `locations` - Apollo's search
 * response describes one headquarters, so this slice produces at most one
 * entry. Additional offices would come from a different Apollo endpoint.
 */
export function normalizeLocations(
  organization: ApolloOrganizationDto,
): string[] | undefined {
  const parts = [
    text(organization.city),
    text(organization.state),
    text(organization.country),
  ].filter((part): part is string => part !== undefined);

  if (parts.length === 0) return undefined;
  return [parts.join(', ')];
}

/**
 * The provider reference entity resolution will later merge on.
 *
 * Apollo's `id` is the whole reference. It is required by the DTO schema, so a
 * candidate can never reach the domain without a provenance.
 */
export function toProviderRef(organization: ApolloOrganizationDto): ProviderRef {
  return { provider: APOLLO_PROVIDER_ID, externalId: organization.id };
}

/**
 * Pointer back to the provider record this candidate came from.
 *
 * A reference rather than an embedded payload: this slice persists nothing, so
 * copying Apollo's JSON into the domain object would put provider fields inside
 * the neutral contract - exactly what the separation forbids. When
 * `company_sources.raw_payload` arrives in the persistence slice, this is the
 * key it will be stored under.
 */
export function toRawSourceRef(organization: ApolloOrganizationDto): string {
  return `${APOLLO_PROVIDER_ID}:organization:${organization.id}`;
}

/**
 * The company name.
 *
 * Apollo's `name` is optional in the response, and a company without one still
 * has an id, a domain and a headcount - too much to throw away. The domain is
 * the fallback, and the id the last resort, so `name` stays a non-empty string
 * for every candidate without any of them being fabricated.
 */
function normalizeName(organization: ApolloOrganizationDto, domain: string | undefined): string {
  return text(organization.name) ?? domain ?? `${APOLLO_PROVIDER_ID}:${organization.id}`;
}

/** One Apollo organization as a provider-neutral candidate. */
export function normalizeApolloOrganization(
  organization: ApolloOrganizationDto,
): CompanyCandidate {
  const domain = normalizeDomain(organization);
  const country = toCountryCode(organization.country);
  const industry = text(organization.industry);
  const employeeCount = normalizeEmployeeCount(organization.estimated_num_employees);
  const website = normalizeWebsite(organization.website_url);
  const technologies = normalizeTechnologies(organization.technology_names);
  const locations = normalizeLocations(organization);

  // Optional keys are omitted rather than set to undefined, so a serialized
  // candidate carries no `"domain": null` that a consumer might read as "Apollo
  // says this company has no domain".
  return {
    providerRefs: [toProviderRef(organization)],
    name: normalizeName(organization, domain),
    ...(domain !== undefined ? { domain } : {}),
    ...(country !== undefined ? { country } : {}),
    ...(industry !== undefined ? { industry } : {}),
    ...(employeeCount !== undefined ? { employeeCount } : {}),
    ...(website !== undefined ? { website } : {}),
    ...(technologies !== undefined ? { technologies } : {}),
    ...(locations !== undefined ? { locations } : {}),
    rawSourceRef: toRawSourceRef(organization),
  };
}

export function normalizeApolloOrganizations(
  organizations: readonly ApolloOrganizationDto[],
): CompanyCandidate[] {
  return organizations.map(normalizeApolloOrganization);
}
