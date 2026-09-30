import {
  PEOPLE_QUERY_VERSION,
  readAnalysisOutput,
  type IcpAnalysisOutput,
  type PeopleDiscoveryProvider,
  type ProspectHealthDto,
  type ProspectRunDto,
} from '@pursuit/shared';
import { AppError } from '../../shared/errors.js';
import type { IcpRepository } from '../icp/icp-repository.js';
import type { IcpAnalysisRepository } from '../icp/icp-analysis-repository.js';
import { mapIcpToPeopleQuery } from './icp-to-people-query.js';
import type {
  CandidateProcessingLogger,
  CandidateProcessingService,
} from './candidate-processing-service.js';

/**
 * Domain-level prospect orchestration: the step after analysis.
 *
 * Its whole job is to load the criteria, optionally the analysis the user is
 * looking at, turn both into one provider-neutral people query, and hand back
 * normalized people. The boundaries matter as much as the behaviour, and they
 * are the same ones `DiscoveryService` keeps:
 *
 *  - **no provider HTTP.** There is no fetch, no URL, no API key and no
 *    provider DTO anywhere in this file. It talks to a
 *    `PeopleDiscoveryProvider` and nothing else.
 *  - **no scoring, ranking or confidence.** Nothing here decides whether a
 *    person is worth contacting.
 *  - **no silent narrowing.** A person the provider returned is returned. The
 *    only rows dropped are exact duplicates, and those are dropped in the
 *    adapter where the duplication happens. The deterministic stage that comes
 *    after - suppression and hard filters - does not narrow `people` either: it
 *    *labels* them, and reports both survivors and the cold pool.
 *
 * It is a separate service from `DiscoveryService` rather than a method on it
 * because the two have different shapes, not just different subjects:
 * firmographic discovery runs configured *strategies* and walks pages against a
 * server-side budget, while a prospect search is one page of one query that a
 * person is paging through. Merging them would mean a strategy registry and a
 * page-walk budget that the people path has no use for.
 */

export interface ProspectServiceOptions {
  readonly icpRepository: IcpRepository;
  readonly analysisRepository: IcpAnalysisRepository;
  readonly provider: PeopleDiscoveryProvider;
  /**
   * The deterministic stage after discovery.
   *
   * Injected rather than constructed here so the search and the processing of
   * its results stay separable: a test can drive one without the other, and the
   * pipeline's own dependencies - a candidate store, a logger - are wired once,
   * where the rest of the application is wired.
   */
  readonly processing: CandidateProcessingService;
  readonly logger?: CandidateProcessingLogger;
}

export interface SearchProspectsOptions {
  readonly page: number;
  readonly perPage: number;
  /** A stored analysis whose buyer strategy should widen the title filter. */
  readonly analysisId?: string;
}

export class ProspectService {
  constructor(private readonly options: ProspectServiceOptions) {}

  health(): Promise<ProspectHealthDto> {
    return this.options.provider.peopleHealthCheck();
  }

  /**
   * One page of prospects for one stored ICP.
   *
   * The ICP is read through the repository rather than accepted as a payload,
   * so a search is always traceable to a stored criteria version - the part of
   * the plan's `search_runs` audit this slice can honestly provide without
   * inventing a table for it.
   */
  async searchForIcp(icpId: string, options: SearchProspectsOptions): Promise<ProspectRunDto> {
    const icp = await this.options.icpRepository.findById(icpId);
    if (!icp) throw AppError.notFound(`No ICP found with id "${icpId}"`);

    const analysis = await this.loadAnalysis(icpId, options.analysisId);
    const query = mapIcpToPeopleQuery(icp.config, {
      page: options.page,
      perPage: options.perPage,
      analysis: analysis.output,
    });

    const startedAt = new Date();
    const result = await this.options.provider.searchPeople(query);
    const completedAt = new Date();
    const provider = this.options.provider.describePeople();

    /**
     * The same criteria version that built the query filters the results.
     *
     * Read from `icp.config` rather than re-fetched, so a concurrent edit
     * cannot leave a run whose filters and whose query came from two different
     * versions of the ICP - which would be unreproducible and unexplainable.
     */
    const processing = await this.options.processing.process(icp.config, result.people, {
      icpId: icp.id,
      icpVersion: icp.version,
      ...(analysis.output !== null && analysis.id !== undefined ? { analysisId: analysis.id } : {}),
      provider: provider.id,
      queryVersion: PEOPLE_QUERY_VERSION,
      startedAt,
    });

    return {
      people: result.people,
      pagination: result.pagination,
      processing,
      meta: {
        icpId: icp.id,
        icpVersion: icp.version,
        // Present only when the analysis actually contributed to the query, so
        // the meta block never claims an input the search did not have.
        ...(analysis.output !== null ? { analysisId: analysis.id } : {}),
        provider: provider.id,
        providerVersion: provider.version,
        queryVersion: PEOPLE_QUERY_VERSION,
        query,
        returned: result.people.length,
        duplicatesRemoved: result.duplicatesRemoved,
        ...(result.unsupportedFilters && result.unsupportedFilters.length > 0
          ? { unsupportedFilters: result.unsupportedFilters }
          : {}),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    };
  }

  /**
   * Resolves the optional analysis, distinguishing two different mistakes.
   *
   * A caller naming an analysis that does not belong to this ICP has made a
   * request error, and gets a 404 rather than a search that quietly ignored
   * half of what was asked for.
   *
   * An analysis that exists but cannot be read as current intelligence - a row
   * written under an older contract, or one whose stored shape has drifted - is
   * different. The search itself is entirely valid without it: the analysis only
   * ever *widens* the title filter, so dropping it costs some reach and nothing
   * else. Failing the whole search over it would be the worse answer, so the
   * search runs and `meta.analysisId` is omitted, which is how the caller can
   * tell the difference.
   */
  private async loadAnalysis(
    icpId: string,
    analysisId: string | undefined,
  ): Promise<{ id: string | undefined; output: IcpAnalysisOutput | null }> {
    if (analysisId === undefined) return { id: undefined, output: null };

    const record = await this.options.analysisRepository.findById(icpId, analysisId);
    if (!record) {
      throw AppError.notFound(`No analysis found with id "${analysisId}" for this ICP`);
    }

    return { id: record.id, output: readAnalysisOutput(record) };
  }
}
