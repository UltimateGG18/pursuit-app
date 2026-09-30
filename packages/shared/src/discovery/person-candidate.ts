import type { ProviderRef } from './candidate.js';

/**
 * The provider-neutral *person* contract, the counterpart to
 * `CompanyCandidate`.
 *
 * It exists for the same reason and under the same two rules:
 *
 *  - **Provider fields stay behind the adapter.** Apollo's `first_name`,
 *    `linkedin_url` and `organization.estimated_num_employees` never leave
 *    `modules/apollo`; nothing above the port may name a provider field, so a
 *    second people provider later changes no domain code and no UI.
 *  - **Normalization is not qualification.** A person candidate answers "who
 *    did the provider return?", never "is this a good lead?". There is no
 *    score, no fit band and no rejection reason here, by design - scoring is
 *    deterministic and lives downstream.
 *
 * And, as everywhere in this contract, **missing data stays unknown**: a field
 * the provider did not supply is absent rather than defaulted, so a later stage
 * can tell "no seniority reported" from "reported as an IC".
 *
 * This is deliberately *not* `ContactCandidate` from `candidate.ts`. That type
 * is a person attached to a company candidate - a field on a firmographic
 * result. This one is the top-level result of a people search, carries the
 * company as context rather than the reverse, and has its own provenance.
 */

/**
 * The employing company, as much of it as the people search reported.
 *
 * Every field is optional including the name: Apollo returns people whose
 * organization block is partially populated, and a person with a title and a
 * LinkedIn profile is still a usable lead without their employer's headcount.
 * Nothing here is inferred from the person.
 */
export interface PersonCompany {
  /** The provider's own key for the company, kept for later resolution. */
  readonly externalId?: string;
  readonly name?: string;
  /** Lowercased registrable domain, e.g. `example.com`. */
  readonly domain?: string;
  /** The provider's own industry label, kept verbatim; not an internal enum. */
  readonly industry?: string;
  /**
   * The internal `INDUSTRIES` values the provider's label could be mapped to.
   *
   * A *list*, and absent rather than empty when nothing mapped, for one reason:
   * a provider label is not guaranteed to name exactly one of our categories,
   * and a filter that picked one arbitrarily would reject companies the ICP
   * actually targets. Absent means "the label mapped to nothing the catalog
   * knows", which a later stage must read as unknown - never as a mismatch.
   *
   * The mapping itself stays behind the adapter, the only place that knows the
   * provider's vocabulary. This is the catalog-side result of it, so filtering
   * can compare catalog values without naming a provider.
   */
  readonly industryCodes?: readonly string[];
  readonly employeeCount?: number;
  readonly website?: string;
  readonly linkedinUrl?: string;
  /** Human-readable, e.g. `Amsterdam, North Holland, Netherlands`. */
  readonly location?: string;
  /**
   * ISO 3166-1 alpha-2, where the provider's country could be mapped to one.
   *
   * The field `CompanyCandidate` already carries, here for the same reason:
   * `location` is a human-readable line that no filter can compare against the
   * criteria's country catalog. Unmappable stays absent rather than guessed - a
   * wrong country code is worse than a missing one, because a geography filter
   * would act on it.
   */
  readonly country?: string;
}

export interface PersonCandidate {
  /** Never empty: a candidate without a provenance cannot be resolved later. */
  readonly providerRefs: readonly ProviderRef[];
  /** Always present; the provider's own spelling, or the name parts joined. */
  readonly name: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly title?: string;
  /**
   * The provider's own seniority label, e.g. `c_suite`. Kept verbatim and
   * deliberately not mapped onto the internal `SENIORITIES` catalog: mapping
   * here would silently discard every value the catalog has no entry for, and
   * matching a reported seniority against the ICP's target seniorities is a
   * filtering decision that belongs to a later stage.
   */
  readonly seniority?: string;
  /**
   * The internal `SENIORITIES` values the provider's seniority label maps to.
   *
   * A list for the reason `industryCodes` is one: a provider tier can cover
   * more than one of ours - Apollo's `manager` is our MANAGER *and* our LEAD -
   * and a filter that guessed between them would reject real buyers. Absent
   * means the label mapped to nothing in the catalog: unknown, never a
   * mismatch. The verbatim `seniority` above stays what a UI shows.
   */
  readonly seniorityCodes?: readonly string[];
  /** The provider's own department label, kept verbatim for the same reason. */
  readonly department?: string;
  /** Internal `DEPARTMENTS` values the provider's label maps to; see above. */
  readonly departmentCodes?: readonly string[];
  /** Human-readable, e.g. `Utrecht, Utrecht, Netherlands`. */
  readonly location?: string;
  readonly linkedinUrl?: string;
  /**
   * What the provider says about the email it holds, e.g. `verified`.
   *
   * The *status* only. No email address is carried by this contract: an address
   * is personal data with a retention question attached, this slice persists
   * nothing, and the status is what a prospecting UI actually needs in order to
   * say whether a lead is reachable.
   */
  readonly emailStatus?: string;
  readonly company?: PersonCompany;
  /**
   * Pointer back to the exact provider record this was built from, e.g.
   * `apollo:person:5f2a...`. A reference, not a copy: this slice stores no
   * provider payloads.
   */
  readonly rawSourceRef: string;
}

/**
 * Comparison form of a LinkedIn profile URL: scheme, locale subdomain, query,
 * fragment and trailing slash removed.
 *
 * `https://NL.linkedin.com/in/jan-de-vries/?trk=x` and
 * `linkedin.com/in/jan-de-vries` are the same profile, and a dedupe key that
 * cannot see that is not doing anything. Anything that is not a LinkedIn
 * profile path returns undefined rather than a guess, so an unusable value
 * stays unknown instead of becoming a bad key.
 */
export function normalizeLinkedinUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;

  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const hostAndPath = withoutScheme.split(/[?#]/, 1)[0] ?? '';
  const slashIndex = hostAndPath.indexOf('/');
  if (slashIndex < 0) return undefined;

  const host = hostAndPath.slice(0, slashIndex);
  const path = hostAndPath.slice(slashIndex).replace(/\/+$/, '');
  // `linkedin.com`, `www.linkedin.com` and `nl.linkedin.com` are one host.
  if (!/(^|\.)linkedin\.com$/.test(host)) return undefined;
  if (!/^\/(in|pub)\/[^/]+/.test(path)) return undefined;
  return `linkedin.com${path}`;
}

/**
 * Identity keys for one person candidate, strongest first.
 *
 * Only two, and both are exact: the provider's own key, and a LinkedIn profile
 * URL. There is deliberately **no name-based key**. Two people called "Jan de
 * Vries" at companies with no reported domain are not one person, and unlike
 * companies - where a normalized name plus a country is a reasonable last
 * resort - merging two humans on a name collision produces a lead record that
 * describes nobody. An unmerged duplicate is a visible, harmless flaw; a
 * wrongly merged person is a silent, wrong one.
 */
export function personIdentityKeys(candidate: PersonCandidate): string[] {
  const keys: string[] = [];
  for (const ref of candidate.providerRefs) {
    keys.push(`ref:${ref.provider}:${ref.externalId}`);
  }
  const linkedin = normalizeLinkedinUrl(candidate.linkedinUrl);
  if (linkedin !== undefined) keys.push(`linkedin:${linkedin}`);
  return keys;
}

/**
 * Collapses duplicate people, keeping the first-seen one and merging the
 * provider references of the rest onto it.
 *
 * Identical in shape and intent to `dedupeCandidates`: provenance is merged so
 * nothing is lost before entity resolution, and field values are *not* merged -
 * choosing between two providers' disagreeing titles is a resolution decision,
 * and this function makes no business decisions.
 */
export function dedupePersonCandidates(
  candidates: readonly PersonCandidate[],
): PersonCandidate[] {
  const byKey = new Map<string, number>();
  const kept: PersonCandidate[] = [];
  /** Mutable refs per kept candidate, frozen back into the result at the end. */
  const refs: ProviderRef[][] = [];

  for (const candidate of candidates) {
    const keys = personIdentityKeys(candidate);
    const existing = keys.map((key) => byKey.get(key)).find((index) => index !== undefined);

    if (existing === undefined) {
      const index = kept.length;
      kept.push(candidate);
      refs.push([...candidate.providerRefs]);
      for (const key of keys) if (!byKey.has(key)) byKey.set(key, index);
      continue;
    }

    const bucket = refs[existing];
    if (bucket) {
      for (const ref of candidate.providerRefs) {
        const seen = bucket.some(
          (known) => known.provider === ref.provider && known.externalId === ref.externalId,
        );
        if (!seen) bucket.push(ref);
      }
    }
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, existing);
  }

  return kept.map((candidate, index) => {
    const merged = refs[index] ?? [...candidate.providerRefs];
    if (merged.length === candidate.providerRefs.length) return candidate;
    return { ...candidate, providerRefs: merged };
  });
}
