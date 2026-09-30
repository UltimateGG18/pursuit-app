/**
 * The provider-neutral candidate contract (plan section 6).
 *
 * This is the *only* company shape that leaves a discovery provider. Apollo's
 * DTOs - `estimated_num_employees`, `primary_domain`, `organization.id` - stay
 * behind the adapter; nothing above it may name a provider field, so adding a
 * second provider later changes no domain code.
 *
 * Two rules the whole slice depends on:
 *
 *  - **Normalization is not qualification.** A candidate answers "what company
 *    did the provider return?", never "is this company a good fit?". There is
 *    no score, no band, no rejection reason here, by design.
 *  - **Missing data stays unknown.** Every field the provider did not supply is
 *    absent rather than defaulted, so a later stage can tell "no employees
 *    reported" from "reported as zero".
 */

/** Where a candidate came from; kept so entity resolution can merge later. */
export interface ProviderRef {
  /** Stable provider id, e.g. `apollo`. */
  readonly provider: string;
  /** The provider's own primary key for this company. */
  readonly externalId: string;
}

/**
 * A person attached to a candidate.
 *
 * Present in the contract because the plan's `CompanyCandidate` carries it, and
 * deliberately never populated by the Apollo firmographic slice: contacts come
 * from a different Apollo endpoint and belong to a later vertical slice.
 */
export interface ContactCandidate {
  readonly providerRefs: readonly ProviderRef[];
  readonly name: string;
  readonly title?: string;
  readonly seniority?: string;
  readonly department?: string;
  readonly linkedinUrl?: string;
}

export interface CompanyCandidate {
  /** Never empty: a candidate without a provenance cannot be resolved later. */
  readonly providerRefs: readonly ProviderRef[];
  readonly name: string;
  /** Lowercased registrable domain, e.g. `example.com`. */
  readonly domain?: string;
  /** ISO 3166-1 alpha-2 where the provider's value could be mapped to one. */
  readonly country?: string;
  /** The provider's own industry label, kept verbatim; not an internal enum. */
  readonly industry?: string;
  readonly employeeCount?: number;
  readonly website?: string;
  readonly technologies?: readonly string[];
  /** Human-readable locations, e.g. `Amsterdam, North Holland, Netherlands`. */
  readonly locations?: readonly string[];
  readonly contacts?: readonly ContactCandidate[];
  /**
   * Pointer back to the exact provider response this candidate was built from,
   * e.g. `apollo:organization:5f2a...`. The plan requires a raw source
   * reference; this slice stores no payloads, so it is a reference and not a
   * copy of one.
   */
  readonly rawSourceRef: string;
}

/**
 * Strips a company domain down to something comparable.
 *
 * Provider-neutral on purpose: two providers spelling the same company
 * `https://WWW.Example.com/careers` and `example.com` have to collapse to one
 * key, and that rule belongs to the candidate contract rather than to whichever
 * adapter happened to see the company first.
 *
 * Returns undefined rather than a guess for anything that is not host-shaped,
 * so an unusable value stays unknown instead of becoming a bad dedupe key.
 */
export function normalizeCandidateDomain(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;

  // Tolerate a bare host, a scheme-qualified URL, and a URL with a path.
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const host = withoutScheme.split(/[/?#]/, 1)[0] ?? '';
  const withoutCredentials = host.split('@').pop() ?? '';
  // Drop a port and a fully-qualified trailing dot, then the `www.` prefix.
  const bare = withoutCredentials.split(':', 1)[0]?.replace(/\.$/, '') ?? '';
  const domain = bare.startsWith('www.') ? bare.slice(4) : bare;

  // A domain has at least one dot and no whitespace; anything else is not one.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return undefined;
  return domain;
}

/**
 * Comparison form of a company name: case, punctuation and legal suffixes
 * removed. Used only as a last-resort dedupe key, never shown to anyone - the
 * candidate keeps the provider's own spelling in `name`.
 */
const LEGAL_SUFFIXES = new Set([
  'bv',
  'nv',
  'gmbh',
  'ag',
  'ltd',
  'limited',
  'llc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'plc',
  'sa',
  'sas',
  'srl',
  'spa',
  'ab',
  'as',
  'oy',
  'aps',
  'kft',
  'sp',
  'zoo',
  'pte',
  'pty',
  'co',
  'company',
  'holding',
  'holdings',
  'group',
]);

export function normalizeCandidateName(value: string): string {
  const words = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Periods go first, so a dotted abbreviation collapses into one token:
    // `B.V.` -> `bv`, which is a suffix, where splitting on punctuation first
    // would give `b` and `v` and match nothing.
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);

  // Suffixes are only dropped from the tail, so "Group Nine" keeps its name
  // while "Nine Group B.V." collapses to "nine".
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (last === undefined || !LEGAL_SUFFIXES.has(last)) break;
    words.pop();
  }
  return words.join(' ');
}

/**
 * Identity keys for one candidate, strongest first (plan section 6 dedupe
 * order): normalized domain, then provider external id, then normalized name
 * plus country.
 *
 * ## Why name is the *weakest* key, and conditional
 *
 * Two rules keep the name key from over-merging:
 *
 *  - **It is skipped entirely when the candidate has a domain.** A domain is
 *    strong evidence of identity, so two candidates with *different* domains
 *    are different companies however alike their names are - `nexus.nl` and
 *    `nexus-group.nl` are not one company merely because both are called
 *    "Nexus" in the Netherlands. Letting a name outvote two distinct domains
 *    silently destroys a real company from the result.
 *  - **It requires a country.** Two unrelated companies called "Nexus" in
 *    different markets are not the same company either.
 *
 * So the name key only decides the case it is actually good for: the same
 * unidentified company returned twice with no domain on either copy. Merging
 * `Acme B.V.` with `Acme Holding` - the same firm under two spellings - is
 * genuinely harder, needs more than a string, and is `EntityResolutionService`'s
 * job in the next slice. This is provider-level dedupe, not entity resolution.
 */
export function candidateIdentityKeys(candidate: CompanyCandidate): string[] {
  const keys: string[] = [];

  const domain = normalizeCandidateDomain(candidate.domain);
  if (domain !== undefined) keys.push(`domain:${domain}`);

  for (const ref of candidate.providerRefs) {
    keys.push(`ref:${ref.provider}:${ref.externalId}`);
  }

  if (domain === undefined) {
    const name = normalizeCandidateName(candidate.name);
    if (name.length > 0 && candidate.country !== undefined) {
      keys.push(`name:${name}:${candidate.country.toLowerCase()}`);
    }
  }
  return keys;
}

/**
 * Collapses duplicate candidates, keeping the first-seen one and merging the
 * provider references of the rest onto it.
 *
 * Merging references rather than discarding them is what keeps this safe to run
 * before entity resolution: nothing a provider told us about provenance is
 * lost, so the later canonical-company stage still sees every external id.
 *
 * Field values are *not* merged. Choosing between two providers' disagreeing
 * employee counts is a resolution decision, and this function does not make
 * business decisions.
 */
export function dedupeCandidates(candidates: readonly CompanyCandidate[]): CompanyCandidate[] {
  const byKey = new Map<string, number>();
  const kept: CompanyCandidate[] = [];
  /** Mutable refs per kept candidate, frozen back into the result at the end. */
  const refs: ProviderRef[][] = [];

  for (const candidate of candidates) {
    const keys = candidateIdentityKeys(candidate);
    const existing = keys.map((key) => byKey.get(key)).find((index) => index !== undefined);

    if (existing === undefined) {
      const index = kept.length;
      kept.push(candidate);
      refs.push([...candidate.providerRefs]);
      for (const key of keys) if (!byKey.has(key)) byKey.set(key, index);
      continue;
    }

    // A duplicate contributes its provenance and nothing else.
    const bucket = refs[existing];
    if (bucket) {
      for (const ref of candidate.providerRefs) {
        const seen = bucket.some(
          (known) => known.provider === ref.provider && known.externalId === ref.externalId,
        );
        if (!seen) bucket.push(ref);
      }
    }
    // The duplicate's own keys now point at the surviving candidate, so a third
    // copy matching only on name still lands on the same row.
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, existing);
  }

  return kept.map((candidate, index) => {
    const merged = refs[index] ?? [...candidate.providerRefs];
    if (merged.length === candidate.providerRefs.length) return candidate;
    return { ...candidate, providerRefs: merged };
  });
}
