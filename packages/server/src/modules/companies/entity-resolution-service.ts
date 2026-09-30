import {
  companyIdentityKeys,
  identityBasisForKey,
  normalizeCandidateDomain,
  normalizeCandidateName,
  type CanonicalCompany,
  type PersonCandidate,
  type ProviderRef,
} from '@pursuit/shared';

/**
 * `EntityResolutionService` - the companies behind the people.
 *
 * Discovery returns people, each carrying whatever their employer's record said
 * at the moment they were retrieved. Twelve leads at one firm are twelve copies
 * of that firm, spelled twelve slightly different ways. This collapses them
 * into one canonical company each, merges the provenance, and leaves everything
 * else alone.
 *
 * Its boundaries are the plan's (section 4): resolve duplicates, merge source
 * references, never delete duplicate history. Concretely:
 *
 *  - **It only merges on exact identity.** A normalized domain, or the
 *    provider's own organization id. Nothing fuzzy, no name similarity, no
 *    library. Two records that cannot be shown to be the same company stay two
 *    companies - see `companyIdentityKeys` for why that asymmetry is the right
 *    one.
 *  - **It invents nothing.** A merged company holds the union of what sources
 *    reported, never a value derived from another field. No domain from a name,
 *    no country from a TLD, no headcount from a band.
 *  - **It decides nothing.** There is no fit, no score and no rejection here.
 *    Suppression and filtering come after, and read this output.
 *
 * ## Why field merging is first-non-empty rather than newest or best
 *
 * Within one run every record is equally fresh and comes from one provider, so
 * "newest" is meaningless and "best" would be a judgement this service has no
 * business making. First-seen wins per field and later sources only fill gaps,
 * which has the property that matters: the result is deterministic, and every
 * value in it is one some source actually reported.
 */

/** One provider's account of a company, as seen through one person. */
interface CompanyObservation {
  readonly provider: string;
  readonly externalId?: string;
  readonly name?: string;
  readonly domain?: string;
  readonly website?: string;
  readonly country?: string;
  readonly location?: string;
  readonly industry?: string;
  readonly industryCodes?: readonly string[];
  readonly employeeCount?: number;
  readonly linkedinUrl?: string;
  readonly sourceRef: string;
}

export interface ResolvedCandidateCompany {
  /** `PersonCandidate.rawSourceRef` of the person this company was seen through. */
  readonly personRef: string;
  /** Absent when the provider reported no employer at all. */
  readonly companyId?: string;
}

export interface EntityResolution {
  readonly companies: readonly CanonicalCompany[];
  /** Person -> canonical company, in the order the people were given. */
  readonly assignments: readonly ResolvedCandidateCompany[];
  /** Companies by id, for the stages that read one at a time. */
  readonly byId: ReadonlyMap<string, CanonicalCompany>;
}

/**
 * Disjoint-set over identity keys.
 *
 * A plain "first key that already maps to a bucket wins" loop is not enough
 * here, and the case it gets wrong is common rather than exotic: person A is
 * seen with a domain and an organization id, person B with only that
 * organization id, person C with only that domain. A and B group, A and C
 * group, and without union the three end up in two companies that both contain
 * A. Union-find makes the grouping order-independent, which is also what makes
 * it testable.
 */
class KeyGroups {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    const seen: string[] = [];
    let current = key;
    for (;;) {
      const next = this.parent.get(current);
      if (next === undefined || next === current) break;
      seen.push(current);
      current = next;
    }
    if (!this.parent.has(current)) this.parent.set(current, current);
    // Path compression: a run can carry hundreds of keys and each is walked
    // more than once.
    for (const node of seen) this.parent.set(node, current);
    return current;
  }

  union(a: string, b: string): string {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return rootA;
    this.parent.set(rootB, rootA);
    return rootA;
  }
}

/**
 * The key that names the group.
 *
 * Domain first, then provider id, matching the plan's resolution order and the
 * strength ordering of `companyIdentityKeys`. Chosen from the group's keys
 * rather than from the first observation, so the id does not depend on which
 * person happened to be returned first: the same company resolved from a
 * different page of the same search gets the same id.
 */
function preferredKey(keys: readonly string[]): string | undefined {
  const sorted = [...keys].sort();
  return (
    sorted.find((key) => key.startsWith('domain:')) ?? sorted.find((key) => key.startsWith('ref:'))
  );
}

function observationFor(person: PersonCandidate): CompanyObservation | undefined {
  const company = person.company;
  if (!company) return undefined;

  const provider = person.providerRefs[0]?.provider;
  if (provider === undefined) return undefined;

  const domain = normalizeCandidateDomain(company.domain);

  return {
    provider,
    ...(company.externalId !== undefined ? { externalId: company.externalId } : {}),
    ...(company.name !== undefined ? { name: company.name } : {}),
    ...(domain !== undefined ? { domain } : {}),
    ...(company.website !== undefined ? { website: company.website } : {}),
    ...(company.country !== undefined ? { country: company.country } : {}),
    ...(company.location !== undefined ? { location: company.location } : {}),
    ...(company.industry !== undefined ? { industry: company.industry } : {}),
    ...(company.industryCodes !== undefined ? { industryCodes: company.industryCodes } : {}),
    ...(company.employeeCount !== undefined ? { employeeCount: company.employeeCount } : {}),
    ...(company.linkedinUrl !== undefined ? { linkedinUrl: company.linkedinUrl } : {}),
    sourceRef: person.rawSourceRef,
  };
}

/** Accumulates one group's observations; frozen into a `CanonicalCompany` at the end. */
class CompanyBuilder {
  readonly keys = new Set<string>();
  readonly providerRefs: ProviderRef[] = [];
  readonly sourceRefs: string[] = [];
  name: string | undefined;
  domain: string | undefined;
  website: string | undefined;
  country: string | undefined;
  location: string | undefined;
  industry: string | undefined;
  industryCodes: readonly string[] | undefined;
  employeeCount: number | undefined;
  linkedinUrl: string | undefined;

  add(observation: CompanyObservation): void {
    // First non-empty wins; later observations only fill what is still absent.
    this.name ??= observation.name;
    this.domain ??= observation.domain;
    this.website ??= observation.website;
    this.country ??= observation.country;
    this.location ??= observation.location;
    this.industry ??= observation.industry;
    this.industryCodes ??= observation.industryCodes;
    this.employeeCount ??= observation.employeeCount;
    this.linkedinUrl ??= observation.linkedinUrl;

    if (observation.externalId !== undefined) {
      const known = this.providerRefs.some(
        (ref) => ref.provider === observation.provider && ref.externalId === observation.externalId,
      );
      if (!known) {
        this.providerRefs.push({
          provider: observation.provider,
          externalId: observation.externalId,
        });
      }
    }
    if (!this.sourceRefs.includes(observation.sourceRef)) {
      this.sourceRefs.push(observation.sourceRef);
    }
  }

  /**
   * The company as one record.
   *
   * A group with no reported name is named by its own identity - its domain, or
   * its provider reference - rather than by an empty string or an invented
   * placeholder. That is a *label* for something genuinely known, not a
   * fabricated company name, and it keeps `name` non-empty for every canonical
   * company so nothing downstream has to special-case it.
   */
  build(id: string): CanonicalCompany {
    const name = this.name ?? this.domain ?? id;
    return {
      id,
      identityBasis: identityBasisForKey(id),
      name,
      normalizedName: normalizeCandidateName(name),
      ...(this.domain !== undefined ? { domain: this.domain } : {}),
      ...(this.website !== undefined ? { website: this.website } : {}),
      ...(this.country !== undefined ? { country: this.country } : {}),
      ...(this.location !== undefined ? { location: this.location } : {}),
      ...(this.industry !== undefined ? { industry: this.industry } : {}),
      ...(this.industryCodes !== undefined && this.industryCodes.length > 0
        ? { industryCodes: [...this.industryCodes] }
        : {}),
      ...(this.employeeCount !== undefined ? { employeeCount: this.employeeCount } : {}),
      ...(this.linkedinUrl !== undefined ? { linkedinUrl: this.linkedinUrl } : {}),
      providerRefs: [...this.providerRefs],
      sourceRefs: [...this.sourceRefs],
    };
  }
}

export class EntityResolutionService {
  /**
   * Resolves the companies behind one page of people.
   *
   * People with no reported employer get no company and are *not* dropped: an
   * employer-less record is still a person the provider returned, and deciding
   * what to do about a missing company is a filtering question, not a
   * resolution one.
   *
   * A company with neither a domain nor a provider id cannot be matched to
   * anything - not even to itself on a later page - so it becomes its own
   * company keyed by the person it was seen through, and reports its identity
   * basis as UNRESOLVED. Honest, and it keeps the record rather than silently
   * merging every unidentifiable company into one bucket.
   */
  resolve(people: readonly PersonCandidate[]): EntityResolution {
    const groups = new KeyGroups();
    const observations: { observation: CompanyObservation; keys: string[]; root: string }[] = [];
    const assignments: ResolvedCandidateCompany[] = [];

    for (const person of people) {
      const observation = observationFor(person);
      if (!observation) {
        assignments.push({ personRef: person.rawSourceRef });
        continue;
      }

      const keys = companyIdentityKeys({
        provider: observation.provider,
        ...(observation.externalId !== undefined ? { externalId: observation.externalId } : {}),
        ...(observation.domain !== undefined ? { domain: observation.domain } : {}),
      });

      // Nothing exact to match on: its own group, named after the source record.
      const effective = keys.length > 0 ? keys : [`source:${observation.sourceRef}`];
      const first = effective[0] as string;
      let root = groups.find(first);
      for (const key of effective.slice(1)) root = groups.union(root, key);

      observations.push({ observation, keys: effective, root });
      assignments.push({ personRef: person.rawSourceRef, companyId: root });
    }

    // Second pass: a root is only final once every union has happened.
    const builders = new Map<string, CompanyBuilder>();
    for (const entry of observations) {
      const root = groups.find(entry.root);
      const builder = builders.get(root) ?? new CompanyBuilder();
      for (const key of entry.keys) builder.keys.add(key);
      builder.add(entry.observation);
      builders.set(root, builder);
    }

    const idByRoot = new Map<string, string>();
    const companies: CanonicalCompany[] = [];
    for (const [root, builder] of builders) {
      const id = preferredKey([...builder.keys]) ?? root;
      idByRoot.set(root, id);
      companies.push(builder.build(id));
    }

    const byId = new Map(companies.map((company) => [company.id, company]));
    const resolvedAssignments: ResolvedCandidateCompany[] = assignments.map((assignment) => {
      if (assignment.companyId === undefined) return assignment;
      const root = groups.find(assignment.companyId);
      return { personRef: assignment.personRef, companyId: idByRoot.get(root) ?? assignment.companyId };
    });

    return { companies, assignments: resolvedAssignments, byId };
  }
}
