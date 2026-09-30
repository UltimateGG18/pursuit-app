import {
  normalizeCandidateDomain,
  normalizeCandidateName,
  type CanonicalCompany,
  type IcpConfig,
} from '@pursuit/shared';

/**
 * `SuppressionService` - "should this candidate be excluded regardless of ICP
 * fit?"
 *
 * Deliberately a separate stage from filtering, and the separation is not
 * cosmetic. Suppression and qualification answer different questions, fail for
 * different reasons and are fixed in different places: a suppressed company is
 * a *policy* decision - already a customer, already in a sequence, explicitly
 * off-limits - and it stays suppressed no matter how perfectly it fits the ICP.
 * Folding it into the hard filters would put "we already sell to them" in the
 * same bucket as "wrong headcount", and the cold pool would stop being
 * diagnosable.
 *
 * It runs *before* the hard filters for the same reason: the cheapest and most
 * certain exclusion should be the one that is recorded, so a suppressed account
 * is never reported as an industry mismatch that happens to also be suppressed.
 *
 * ## What it can actually see today, and what it cannot
 *
 * The only suppression data the application currently holds is the ICP's own
 * `evidenceDiscovery.suppressedAccounts` - a list a person curated on the
 * criteria form. That is what this reads.
 *
 * The criteria contract also has rule fields for `account.isExistingCustomer`,
 * `account.hasOpenDeal`, `account.doNotContact` and `account.inActiveSequence`.
 * Those are real suppression inputs and they are deliberately **not** invented
 * here: there is no CRM integration, no customer table and no sequence state in
 * this system, so any value for them would be fabricated. `extraLists` is the
 * seam they arrive through when a source for them exists; until then the
 * limitation is reported rather than papered over.
 */

/** One account that must not be contacted, whatever the criteria say. */
export interface SuppressionEntry {
  /** A provider's own organization id, when the entry came from one. */
  readonly externalId?: string;
  readonly name?: string;
  readonly domain?: string;
  /** Where the entry came from, e.g. `icp.evidenceDiscovery.suppressedAccounts`. */
  readonly origin: string;
}

export interface SuppressionList {
  readonly entries: readonly SuppressionEntry[];
}

export interface SuppressionMatch {
  /** Why this company is suppressed, in terms a person can act on. */
  readonly detail: string;
}

/**
 * The ICP's own suppression list, in this service's vocabulary.
 *
 * `accountReferenceSchema` gives every entry an `id` and a `name` and an
 * optional `domain`. The `id` is read as a provider organization id because
 * that is what the schema's own comment says it will be ("the shape the
 * Apollo/CRM integration will produce"); an id that is not one simply never
 * matches, which costs nothing.
 */
export function suppressionListFromIcp(config: IcpConfig): SuppressionList {
  const entries: SuppressionEntry[] = config.evidenceDiscovery.suppressedAccounts.map((account) => {
    const domain = normalizeCandidateDomain(account.domain);
    return {
      externalId: account.id,
      name: account.name,
      ...(domain !== undefined ? { domain } : {}),
      origin: 'icp.evidenceDiscovery.suppressedAccounts',
    };
  });
  return { entries };
}

export class SuppressionService {
  private readonly byDomain = new Map<string, SuppressionEntry>();
  private readonly byExternalId = new Map<string, SuppressionEntry>();
  /** Only for entries with no domain of their own; see `check`. */
  private readonly byName = new Map<string, SuppressionEntry>();

  constructor(lists: readonly SuppressionList[]) {
    for (const list of lists) {
      for (const entry of list.entries) {
        if (entry.domain !== undefined) this.byDomain.set(entry.domain, entry);
        if (entry.externalId !== undefined) this.byExternalId.set(entry.externalId, entry);
        if (entry.domain === undefined && entry.name !== undefined) {
          const normalized = normalizeCandidateName(entry.name);
          if (normalized.length > 0) this.byName.set(normalized, entry);
        }
      }
    }
  }

  get size(): number {
    return this.byDomain.size + this.byExternalId.size + this.byName.size;
  }

  /**
   * Whether one canonical company is suppressed.
   *
   * Three matches, in decreasing strength, and the third is fenced for a
   * reason:
   *
   *  1. **Normalized domain.** Exact, and the strongest identity there is.
   *  2. **Provider organization id.** Exact within the provider that issued it.
   *  3. **Normalized company name** - but *only* when the suppression entry
   *     carries no domain of its own. An entry that names a domain has already
   *     said precisely which company it means, and letting its name match a
   *     different company at a different domain would suppress a real prospect
   *     on a name collision. With no domain on the entry there is nothing
   *     stronger available, and the entry would otherwise never match anything.
   *
   * Nothing fuzzy, in any of the three. A suppressed prospect is recoverable
   * from the cold pool, but only if someone notices it is there, so
   * over-suppression is a real cost rather than a safe default.
   */
  check(company: CanonicalCompany): SuppressionMatch | undefined {
    if (company.domain !== undefined) {
      const entry = this.byDomain.get(company.domain);
      if (entry) {
        return {
          detail: `Company domain ${company.domain} is on the suppression list (${entry.origin})`,
        };
      }
    }

    for (const ref of company.providerRefs) {
      const entry = this.byExternalId.get(ref.externalId);
      if (entry) {
        return {
          detail: `Company is on the suppression list by provider account reference (${entry.origin})`,
        };
      }
    }

    if (company.normalizedName.length > 0) {
      const entry = this.byName.get(company.normalizedName);
      if (entry) {
        return {
          detail: `Company name "${company.name}" matches a suppressed account with no domain (${entry.origin})`,
        };
      }
    }

    return undefined;
  }
}
