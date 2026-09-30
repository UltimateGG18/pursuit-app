import type {
  CompanyDiscoveryProvider,
  DiscoveryQuery,
  DiscoverySearchResult,
  DiscoveryStrategy,
  IcpConfig,
} from '@pursuit/shared';

/**
 * A discovery strategy: one way of turning criteria into candidates.
 *
 * The seam exists so the plan's six strategies can arrive one at a time
 * without `DiscoveryService` changing:
 *
 *   FirmographicStrategy  (P0, implemented here)
 *   SignalFirstStrategy   (P1)
 *   SemanticDiscoveryStrategy (P1)
 *   LookalikeStrategy     (P2)
 *   RelationshipStrategy  (P2)
 *   InboundStrategy       (P2)
 *
 * A strategy owns exactly two decisions: *what to ask for* - building an
 * internal `DiscoveryQuery` from the ICP - and *which provider to ask*. It owns
 * neither transport nor judgement: no HTTP, no scoring, no filtering, and no
 * rejecting a candidate the provider returned.
 */
export interface DiscoveryStrategyContext {
  readonly config: IcpConfig;
  /** Upper bound on candidates the caller wants back. */
  readonly limit: number;
  /** Opaque provider continuation token from a previous run. */
  readonly cursor?: string;
}

export interface DiscoveryStrategyRun {
  readonly strategy: DiscoveryStrategy;
  /** The internal query that was executed; reported for audit. */
  readonly query: DiscoveryQuery;
  readonly result: DiscoverySearchResult;
}

export interface CompanyDiscoveryStrategy {
  readonly strategy: DiscoveryStrategy;

  /**
   * Derives the internal query this strategy would run. Separate from
   * `discover` so the translation can be asserted without a provider.
   */
  buildQuery(context: DiscoveryStrategyContext): DiscoveryQuery;

  discover(context: DiscoveryStrategyContext): Promise<DiscoveryStrategyRun>;
}

/**
 * P0: firmographic discovery.
 *
 * The recall-first pass of the plan's two-stage search: ask the provider for
 * companies matching the ICP's *structural* facts - where they are, what
 * industry they are in, how big they are - and leave every judgement to the
 * stages after it.
 *
 * ## Why only part of the ICP is used
 *
 * The ICP carries far more than this: must-have rules, triggers, buyer
 * seniorities, evidence thresholds, scoring weights. None of it belongs in a
 * discovery query. A must-have rule is a *filter*, applied after normalization
 * and entity resolution so that a company with unknown data can be handled
 * deliberately rather than never being retrieved. A trigger is a signal,
 * gathered in the qualification stage. Pushing either into the provider query
 * would trade recall for a filter the pipeline is going to apply anyway - and
 * would do it invisibly, against whatever subset the provider happens to
 * support.
 *
 * So this strategy reads exactly three ICP sections, and the query it builds is
 * the honest recall envelope: geography, company profile, and the technology
 * preferences the contract carries (which the Apollo adapter currently reports
 * as unsupported rather than guessing at).
 */
export class FirmographicDiscoveryStrategy implements CompanyDiscoveryStrategy {
  readonly strategy: DiscoveryStrategy = 'FIRMOGRAPHIC';

  constructor(private readonly provider: CompanyDiscoveryProvider) {}

  buildQuery(context: DiscoveryStrategyContext): DiscoveryQuery {
    const { config, limit, cursor } = context;
    const { geography, companyProfile, technology } = config;

    /**
     * `employeeRange` is optional in the criteria contract and both bounds are
     * independently optional, so each is only carried when it was actually set.
     * An absent bound is left absent rather than filled with 0 or a ceiling:
     * the adapter decides what an open bound means to its provider, and a
     * fabricated bound here would look like the user's own choice.
     */
    const { min: employeeMin, max: employeeMax } = companyProfile.employeeRange;

    return {
      geography: {
        countries: [...geography.includedCountries],
        ...(geography.excludedCountries.length > 0
          ? { excludedCountries: [...geography.excludedCountries] }
          : {}),
        ...(geography.regions.length > 0 ? { regions: [...geography.regions] } : {}),
      },
      companyProfile: {
        industries: [...companyProfile.industries],
        ...(companyProfile.excludedIndustries.length > 0
          ? { excludedIndustries: [...companyProfile.excludedIndustries] }
          : {}),
        ...(employeeMin !== undefined ? { employeeMin } : {}),
        ...(employeeMax !== undefined ? { employeeMax } : {}),
        ...(companyProfile.companyTypes.length > 0
          ? { companyTypes: [...companyProfile.companyTypes] }
          : {}),
        ...(companyProfile.maturityStages.length > 0
          ? { maturity: [...companyProfile.maturityStages] }
          : {}),
      },
      ...(technology.requiredTechnologies.length > 0 ||
      technology.preferredTechnologies.length > 0
        ? {
            technology: {
              ...(technology.requiredTechnologies.length > 0
                ? { requiredTechnologies: [...technology.requiredTechnologies] }
                : {}),
              ...(technology.preferredTechnologies.length > 0
                ? { preferredTechnologies: [...technology.preferredTechnologies] }
                : {}),
            },
          }
        : {}),
      limit,
      ...(cursor !== undefined ? { cursor } : {}),
    };
  }

  async discover(context: DiscoveryStrategyContext): Promise<DiscoveryStrategyRun> {
    const query = this.buildQuery(context);
    // The provider is behind the port; this call cannot see Apollo.
    const result = await this.provider.search(query);
    return { strategy: this.strategy, query, result };
  }
}
