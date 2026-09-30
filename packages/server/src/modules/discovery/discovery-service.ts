import {
  DISCOVERY_QUERY_VERSION,
  DiscoveryStrategyUnsupportedError,
  dedupeCandidates,
  uniqueStrings,
  type CompanyCandidate,
  type CompanyDiscoveryProvider,
  type DiscoveryHealthDto,
  type DiscoveryRunDto,
  type DiscoveryStrategy,
  type IcpConfig,
} from '@pursuit/shared';
import { AppError } from '../../shared/errors.js';
import type { IcpRepository } from '../icp/icp-repository.js';
import type {
  CompanyDiscoveryStrategy,
  DiscoveryStrategyRun,
} from './discovery-strategy.js';

/**
 * Domain-level discovery orchestration.
 *
 * Its whole job is the first step of the plan's Stage 1: load the criteria, run
 * the configured strategies, merge what they return, and hand back normalized
 * candidates. That is the entire responsibility, and the boundaries are as
 * important as the behaviour:
 *
 *  - **no provider HTTP.** There is no fetch, no URL, no API key and no
 *    provider DTO anywhere in this file. Strategies talk to providers through
 *    `CompanyDiscoveryProvider`, and this service talks only to strategies.
 *  - **no scoring, ranking or confidence.** Steps 5-10 of Stage 1 - entity
 *    resolution, suppression, hard must-have filtering, the cold pool - and all
 *    of Stage 2 are later slices. Nothing here decides whether a company is
 *    worth pursuing.
 *  - **no silent narrowing.** A candidate the provider returned is returned.
 *    The only rows this service drops are exact duplicates of other rows.
 */

export interface DiscoveryServiceOptions {
  readonly icpRepository: IcpRepository;
  /** Only for `describe()`/health; strategies hold their own provider handle. */
  readonly provider: CompanyDiscoveryProvider;
  /** Keyed by strategy so a configured-but-unimplemented one is detectable. */
  readonly strategies: readonly CompanyDiscoveryStrategy[];
}

export interface DiscoverOptions {
  readonly limit: number;
  readonly cursor?: string;
  /**
   * Overrides the ICP's own `evidenceDiscovery.discoveryStrategies`. Used by
   * the API so a caller can run one strategy without editing the ICP.
   */
  readonly strategies?: readonly DiscoveryStrategy[];
}

export class DiscoveryService {
  constructor(private readonly options: DiscoveryServiceOptions) {}

  health(): Promise<DiscoveryHealthDto> {
    return this.options.provider.healthCheck();
  }

  /**
   * Runs discovery for one stored ICP.
   *
   * The ICP is read through the repository rather than accepted as a payload,
   * so a run is always traceable to a stored criteria version - which is the
   * part of the plan's `search_runs` audit this slice can honestly provide
   * without inventing a table for it.
   */
  async discoverForIcp(icpId: string, options: DiscoverOptions): Promise<DiscoveryRunDto> {
    const icp = await this.options.icpRepository.findById(icpId);
    if (!icp) throw AppError.notFound(`No ICP found with id "${icpId}"`);

    const requested = this.resolveStrategies(icp.config, options.strategies);
    const startedAt = new Date();

    const runs = await this.runStrategies(requested, {
      config: icp.config,
      limit: options.limit,
      ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
    });

    const completedAt = new Date();
    const merged = this.merge(runs, options.limit);
    const provider = this.options.provider.describe();

    return {
      candidates: merged.candidates,
      meta: {
        icpId: icp.id,
        icpVersion: icp.version,
        strategies: runs.map((run) => run.strategy),
        provider: provider.id,
        providerVersion: provider.version,
        queryVersion: DISCOVERY_QUERY_VERSION,
        // The internal query of the first strategy that ran. One strategy is
        // implemented, so this is exact; a multi-strategy run will report per
        // strategy, which is a change to this DTO and not to the service.
        query: runs[0]?.query ?? {},
        requestedLimit: options.limit,
        returned: merged.candidates.length,
        duplicatesRemoved: merged.duplicatesRemoved,
        pagesFetched: merged.pagesFetched,
        ...(merged.totalAvailable !== undefined ? { totalAvailable: merged.totalAvailable } : {}),
        ...(merged.nextCursor !== undefined ? { nextCursor: merged.nextCursor } : {}),
        ...(merged.unsupportedFilters.length > 0
          ? { unsupportedFilters: merged.unsupportedFilters }
          : {}),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    };
  }

  /**
   * Decides which strategies to run, and refuses to pretend about the rest.
   *
   * An ICP configured for `SIGNAL_FIRST` and `SEMANTIC` that quietly ran only
   * firmographic discovery would look like a working search returning
   * disappointing results - the worst possible failure mode for a recall stage,
   * because nothing about the output says a strategy was skipped. So an
   * unimplemented strategy is an error naming exactly which ones are missing.
   *
   * The exception is an ICP that asks for firmographic discovery *and* other
   * strategies: that is a normal, valid configuration for a system being built
   * incrementally, and it still runs the strategies that exist.
   */
  private resolveStrategies(
    config: IcpConfig,
    override: readonly DiscoveryStrategy[] | undefined,
  ): CompanyDiscoveryStrategy[] {
    const wanted = uniqueStrings(override ?? config.evidenceDiscovery.discoveryStrategies);

    const available = new Map(
      this.options.strategies.map((strategy) => [strategy.strategy, strategy]),
    );
    const resolved = wanted
      .map((strategy) => available.get(strategy))
      .filter((strategy): strategy is CompanyDiscoveryStrategy => strategy !== undefined);

    if (resolved.length === 0) {
      throw new DiscoveryStrategyUnsupportedError(wanted);
    }
    return resolved;
  }

  /**
   * Executes strategies one after another.
   *
   * Sequential rather than concurrent, and deliberately not fault-tolerant: if
   * a strategy fails, the whole run fails. A partial result presented as a
   * complete one is how a recall stage silently loses companies, and the plan
   * is explicit that provider failures must not be hidden.
   */
  private async runStrategies(
    strategies: readonly CompanyDiscoveryStrategy[],
    context: { config: IcpConfig; limit: number; cursor?: string },
  ): Promise<DiscoveryStrategyRun[]> {
    const runs: DiscoveryStrategyRun[] = [];
    for (const strategy of strategies) {
      runs.push(await strategy.discover(context));
    }
    return runs;
  }

  /**
   * Merges every strategy's candidates into one list.
   *
   * De-duplication runs again here, across strategies: two strategies finding
   * the same company is the expected case, not an anomaly. It is still only
   * *provider-level* dedupe on identical identity keys - resolving "Acme B.V."
   * and "Acme Holding" to one company is entity resolution, and that is the
   * next slice.
   */
  private merge(
    runs: readonly DiscoveryStrategyRun[],
    limit: number,
  ): {
    candidates: CompanyCandidate[];
    duplicatesRemoved: number;
    pagesFetched: number;
    totalAvailable: number | undefined;
    nextCursor: string | undefined;
    unsupportedFilters: string[];
  } {
    const all = runs.flatMap((run) => [...run.result.candidates]);
    const deduped = dedupeCandidates(all);

    // Duplicates the providers reported, plus any this merge collapsed.
    const providerDuplicates = runs.reduce((sum, run) => sum + run.result.duplicatesRemoved, 0);
    const mergeDuplicates = all.length - deduped.length;

    return {
      candidates: deduped.slice(0, limit),
      duplicatesRemoved: providerDuplicates + mergeDuplicates,
      pagesFetched: runs.reduce((sum, run) => sum + run.result.pagesFetched, 0),
      // One strategy is implemented, so the first non-undefined total is the
      // total. Summing across strategies would double-count the same companies.
      totalAvailable: runs.find((run) => run.result.totalAvailable !== undefined)?.result
        .totalAvailable,
      nextCursor: runs.find((run) => run.result.nextCursor !== undefined)?.result.nextCursor,
      unsupportedFilters: uniqueStrings(
        runs.flatMap((run) => [...(run.result.unsupportedFilters ?? [])]),
      ),
    };
  }
}
