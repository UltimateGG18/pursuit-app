import {
  normalizeCandidateDomain,
  type PersonCandidate,
  type PersonCompany,
  type ProviderRef,
} from '@pursuit/shared';
import type { ApolloPersonDto, ApolloPersonOrganizationDto } from './apollo-people-dto.js';
import { APOLLO_PROVIDER_ID } from './apollo-errors.js';
import { normalizeEmployeeCount, normalizeWebsite } from './apollo-normalizer.js';
import { toCountryCode, toIndustryCodes } from './apollo-vocabulary.js';
import { toDepartmentCodes, toSeniorityCodes } from './apollo-people-vocabulary.js';

/**
 * Apollo person -> `PersonCandidate`.
 *
 * The people counterpart to `apollo-normalizer.ts`, and the single crossing
 * point for the people path: everything upstream speaks Apollo, everything
 * downstream speaks the domain.
 *
 * The same two rules apply. Normalization answers *who did the provider
 * return?* and refuses the adjacent question - there is no scoring here, no
 * qualification, and a person with no title and no LinkedIn profile still
 * normalizes into a candidate, because "Apollo knows little about this person"
 * is a fact for a later stage to weigh rather than grounds for dropping a row.
 * And **missing stays missing**: no field is defaulted, inferred or back-filled
 * from another.
 *
 * Website and employee-count normalization are shared with the organization
 * normalizer rather than reimplemented, so a company reached through a person
 * is spelled exactly as the same company reached through firmographic search.
 */

/** Trims, and treats an empty or whitespace-only string as absent. */
function text(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A location as one human-readable line.
 *
 * Apollo reports `city`, `state` and `country` separately and populates them
 * unevenly, so they are joined into the most specific line the data supports -
 * a person known only by country still gets a location rather than an empty
 * string. Used for both the person and their employer, because Apollo shapes
 * the two the same way.
 */
export function normalizePersonLocation(parts: {
  city?: string;
  state?: string;
  country?: string;
}): string | undefined {
  const pieces = [text(parts.city), text(parts.state), text(parts.country)].filter(
    (part): part is string => part !== undefined,
  );
  return pieces.length > 0 ? pieces.join(', ') : undefined;
}

/**
 * The person's display name.
 *
 * Apollo sends `name` as well as the parts, but not always, and not always in
 * agreement. `name` wins when present because it is the provider's own
 * rendering; the parts joined are the fallback; and a person with neither is
 * named by their provenance rather than by an empty string, so `name` stays a
 * non-empty string for every candidate without anything being fabricated.
 */
export function normalizePersonName(person: ApolloPersonDto): string {
  const full = text(person.name);
  if (full !== undefined) return full;

  const parts = [text(person.first_name), text(person.last_name)].filter(
    (part): part is string => part !== undefined,
  );
  if (parts.length > 0) return parts.join(' ');
  return `${APOLLO_PROVIDER_ID}:${person.id}`;
}

/**
 * The employing company, as much of it as Apollo reported.
 *
 * Returns undefined when Apollo said nothing about an employer at all, rather
 * than an object of undefined fields - "no company reported" and "a company
 * with no known name" are different facts, and only one of them should render
 * as a company row in a UI.
 *
 * `organization_name`/`organization_id` are Apollo's denormalized copies and
 * are used only when the nested `organization` block is absent, which is the
 * shape a CRM `contacts[]` row arrives in.
 */
export function normalizePersonCompany(person: ApolloPersonDto): PersonCompany | undefined {
  const organization: ApolloPersonOrganizationDto | undefined = person.organization;

  const externalId = text(organization?.id) ?? text(person.organization_id);
  const name = text(organization?.name) ?? text(person.organization_name);
  const domain =
    normalizeCandidateDomain(organization?.primary_domain) ??
    normalizeCandidateDomain(organization?.website_url);
  const industry = text(organization?.industry);
  /**
   * The catalog reading of that label, alongside it rather than instead of it.
   *
   * Both are kept because they answer different questions: `industry` is what
   * Apollo said and is what a person reads, `industryCodes` is what a
   * deterministic filter can compare against the ICP. An unrecognised label
   * yields an empty list, which is omitted below - unknown, not a mismatch.
   */
  const industryCodes = toIndustryCodes(industry);
  const employeeCount = normalizeEmployeeCount(organization?.estimated_num_employees);
  const website = normalizeWebsite(organization?.website_url);
  const linkedinUrl = text(organization?.linkedin_url);
  const location = organization
    ? normalizePersonLocation({
        ...(organization.city !== undefined ? { city: organization.city } : {}),
        ...(organization.state !== undefined ? { state: organization.state } : {}),
        ...(organization.country !== undefined ? { country: organization.country } : {}),
      })
    : undefined;

  // The employer's own country, mapped where Apollo's place name is one the
  // catalog knows. Unmappable stays absent: a geography filter acts on this.
  const country = toCountryCode(text(organization?.country));

  const company: PersonCompany = {
    ...(externalId !== undefined ? { externalId } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(domain !== undefined ? { domain } : {}),
    ...(industry !== undefined ? { industry } : {}),
    ...(industryCodes.length > 0 ? { industryCodes } : {}),
    ...(employeeCount !== undefined ? { employeeCount } : {}),
    ...(website !== undefined ? { website } : {}),
    ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(country !== undefined ? { country } : {}),
  };

  return Object.keys(company).length > 0 ? company : undefined;
}

/**
 * The provider reference entity resolution will later merge on. Apollo's `id`
 * is the whole reference, and the DTO schema requires it, so a candidate can
 * never reach the domain without a provenance.
 */
export function toPersonProviderRef(person: ApolloPersonDto): ProviderRef {
  return { provider: APOLLO_PROVIDER_ID, externalId: person.id };
}

/**
 * Pointer back to the provider record. A reference rather than an embedded
 * payload: this slice persists nothing, and copying Apollo's JSON into the
 * domain object would put provider fields inside the neutral contract.
 */
export function toPersonRawSourceRef(person: ApolloPersonDto): string {
  return `${APOLLO_PROVIDER_ID}:person:${person.id}`;
}

/** One Apollo person as a provider-neutral candidate. */
export function normalizeApolloPerson(person: ApolloPersonDto): PersonCandidate {
  const firstName = text(person.first_name);
  const lastName = text(person.last_name);
  const title = text(person.title);
  const seniority = text(person.seniority);
  // Catalog readings of Apollo's own tiers, kept beside the verbatim values so
  // a hard filter has something to compare and a UI still shows what Apollo
  // said. Empty means the value is outside our catalog, which is unknown.
  const seniorityCodes = toSeniorityCodes(seniority);
  // Apollo sends a list; a person has one primary department, and the rest are
  // sub-departments of it. Taking the first keeps the contract single-valued
  // without inventing a precedence rule Apollo does not document.
  const department = text(person.departments?.[0]);
  const departmentCodes = toDepartmentCodes(department);
  const linkedinUrl = text(person.linkedin_url);
  const emailStatus = text(person.email_status);
  const location = normalizePersonLocation({
    ...(person.city !== undefined ? { city: person.city } : {}),
    ...(person.state !== undefined ? { state: person.state } : {}),
    ...(person.country !== undefined ? { country: person.country } : {}),
  });
  const company = normalizePersonCompany(person);

  // Optional keys are omitted rather than set to undefined, so a serialized
  // candidate carries no `"title": null` that a consumer might read as "Apollo
  // says this person has no title".
  return {
    providerRefs: [toPersonProviderRef(person)],
    name: normalizePersonName(person),
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(seniority !== undefined ? { seniority } : {}),
    ...(seniorityCodes.length > 0 ? { seniorityCodes } : {}),
    ...(department !== undefined ? { department } : {}),
    ...(departmentCodes.length > 0 ? { departmentCodes } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
    ...(emailStatus !== undefined ? { emailStatus } : {}),
    ...(company !== undefined ? { company } : {}),
    rawSourceRef: toPersonRawSourceRef(person),
  };
}

export function normalizeApolloPeople(people: readonly ApolloPersonDto[]): PersonCandidate[] {
  return people.map(normalizeApolloPerson);
}
