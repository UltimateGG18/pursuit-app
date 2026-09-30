import type { ProviderRef } from './candidate.js';

/**
 * The canonical company - one resolved entity, however many provider records
 * pointed at it (plan section 5, `companies` + `company_sources`).
 *
 * Where `CompanyCandidate` and `PersonCompany` are *what a provider said*, this
 * is *who the company is* after entity resolution has merged those accounts.
 * It is still provider-neutral, and it is still not a judgement: there is no
 * score, no band and no fit here. A canonical company answers "which company is
 * this, and where did we learn it?" and nothing else.
 *
 * Two rules it inherits from the candidate contract, and one of its own:
 *
 *  - **Missing stays unknown.** A field no source reported is absent, never
 *    defaulted. `employeeCount: 0` would be a claim; absence is the truth.
 *  - **Provenance is never lost.** Every provider reference and every source
 *    reference that contributed is kept, so a merge can always be explained and
 *    - if it turns out to be wrong - unpicked.
 *  - **Nothing is invented.** A merge takes the union of what sources reported.
 *    It never derives a domain from a name, a country from a domain suffix, or
 *    a headcount from anything at all.
 */

/** How confidently this entity was identified. Never a probability. */
export const COMPANY_IDENTITY_BASES = ['DOMAIN', 'PROVIDER_ID', 'UNRESOLVED'] as const;
export type CompanyIdentityBasis = (typeof COMPANY_IDENTITY_BASES)[number];

export interface CanonicalCompany {
  /**
   * Stable, deterministic identity - the winning identity key itself, e.g.
   * `domain:example.com` or `ref:apollo:5f2a...`.
   *
   * Deliberately not a random id: the same company resolved in tomorrow's run
   * gets the same string, so a persisted row can be matched without a lookup
   * table, and a response can be read without one.
   */
  readonly id: string;
  readonly identityBasis: CompanyIdentityBasis;
  /** The provider's own spelling, from the first source that named the company. */
  readonly name: string;
  /** Comparison form of the name. Never displayed; used for audit and lookup. */
  readonly normalizedName: string;
  /** Lowercased registrable domain, e.g. `example.com`. */
  readonly domain?: string;
  readonly website?: string;
  /** ISO 3166-1 alpha-2, where a source's value could be mapped to one. */
  readonly country?: string;
  /** Human-readable, e.g. `Amsterdam, North Holland, Netherlands`. */
  readonly location?: string;
  /** A provider's own industry label, kept verbatim. */
  readonly industry?: string;
  /** Internal `INDUSTRIES` values the provider label mapped to, if any. */
  readonly industryCodes?: readonly string[];
  readonly employeeCount?: number;
  readonly linkedinUrl?: string;
  /** Every provider account that resolved to this company. Never empty-by-merge. */
  readonly providerRefs: readonly ProviderRef[];
  /** Pointers back to the provider records this was built from. */
  readonly sourceRefs: readonly string[];
}

/**
 * Deterministic identity keys for a company as one provider reported it,
 * strongest first.
 *
 * Exactly two kinds, both exact, and that is the whole point of this stage
 * being conservative:
 *
 *  - `domain:<normalized domain>` - the durable, cross-provider identity, and
 *    the reason it ranks first (plan section 7: "resolve by domain first").
 *  - `ref:<provider>:<external id>` - the provider's own primary key, exact
 *    within that provider and meaningless across providers.
 *
 * There is deliberately **no name key here**, unlike `candidateIdentityKeys`.
 * That function is provider-level dedupe over firmographic results, where a
 * normalized name plus a country is a defensible last resort. This is entity
 * *resolution* over companies seen through their employees, where the country
 * is frequently unknown and a name collision would merge two real companies
 * into one canonical record and silently delete one of them. An unmerged
 * duplicate is a visible, harmless flaw; a wrong merge is a silent, wrong one.
 */
export function companyIdentityKeys(source: {
  readonly provider: string;
  readonly externalId?: string;
  readonly domain?: string;
}): string[] {
  const keys: string[] = [];
  if (source.domain !== undefined && source.domain.length > 0) keys.push(`domain:${source.domain}`);
  if (source.externalId !== undefined && source.externalId.length > 0) {
    keys.push(`ref:${source.provider}:${source.externalId}`);
  }
  return keys;
}

/** Which key shape an identity key is, so the basis can be reported honestly. */
export function identityBasisForKey(key: string): CompanyIdentityBasis {
  if (key.startsWith('domain:')) return 'DOMAIN';
  if (key.startsWith('ref:')) return 'PROVIDER_ID';
  return 'UNRESOLVED';
}
