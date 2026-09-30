import {
  ICP_ANALYSIS_SCHEMA_VERSION,
  buildIcpModelInput,
  icpAnalysisOutputSchema,
  icpModelInputSchema,
  zodErrorToDetails,
  type IcpAnalysisDto,
  type IcpAnalysisListDto,
  type IcpConfig,
  type IcpModelInput,
  type ModelProvider,
  type ModelProviderHealth,
} from '@pursuit/shared';
import { AppError } from '../../shared/errors.js';
import {
  apiErrorCodeForModelError,
  describeErrorForLog,
  toAppError,
} from '../model/model-error-mapping.js';
import { toIcpAnalysisDto } from './icp-analysis-mapper.js';
import type {
  IcpAnalysisRecord,
  IcpAnalysisRepository,
} from './icp-analysis-repository.js';
import type { IcpRepository } from './icp-repository.js';

/** Newest-first cap for the analyses list; a UI never needs more. */
const MAX_ANALYSES_RETURNED = 25;

/** Minimal logger surface, so the service does not depend on Fastify. */
export interface AnalysisLogger {
  info(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface IcpAnalysisServiceOptions {
  icpRepository: IcpRepository;
  analysisRepository: IcpAnalysisRepository;
  provider: ModelProvider;
  /** Configured prompt version, stamped on the row before the model answers. */
  promptVersion: string;
  logger: AnalysisLogger;
}

/**
 * Runs one ICP through the configured `ModelProvider` and stores the result.
 *
 * The order of operations is the point of this class:
 *
 *   find ICP -> build normalized input -> open a RUNNING row
 *     -> call the provider -> re-validate the output -> close the row
 *
 * The row is opened *before* the model is called so a timeout or a crash leaves
 * a FAILED analysis rather than nothing, and the input snapshot is written at
 * that moment so the stored result stays reproducible after the ICP is edited.
 *
 * The model never touches the database, and nothing here writes back to the
 * ICP: an analysis is strictly derived data.
 */
export class IcpAnalysisService {
  private readonly icpRepository: IcpRepository;
  private readonly analysisRepository: IcpAnalysisRepository;
  private readonly provider: ModelProvider;
  private readonly promptVersion: string;
  private readonly logger: AnalysisLogger;

  constructor(options: IcpAnalysisServiceOptions) {
    this.icpRepository = options.icpRepository;
    this.analysisRepository = options.analysisRepository;
    this.provider = options.provider;
    this.promptVersion = options.promptVersion;
    this.logger = options.logger;
  }

  health(): Promise<ModelProviderHealth> {
    return this.provider.healthCheck();
  }

  async analyze(icpId: string): Promise<IcpAnalysisDto> {
    const icp = await this.icpRepository.findById(icpId);
    if (!icp) throw AppError.notFound(`No ICP found with id "${icpId}"`);

    const input = this.buildInput(icpId, icp.version, icp.config);
    const descriptor = this.provider.describe();

    const analysis = await this.openAnalysis({
      icpProfileId: icpId,
      icpVersion: icp.version,
      provider: descriptor.id,
      model: descriptor.version,
      promptVersion: this.promptVersion,
      analysisSchemaVersion: ICP_ANALYSIS_SCHEMA_VERSION,
      inputSnapshot: input,
    });

    const startedAt = Date.now();
    try {
      const result = await this.provider.analyzeICP(input);

      // Re-validated at the persistence boundary. The provider already parsed
      // the model's answer; this guards the database against any provider -
      // a stub, a future adapter - that returns something the contract rejects.
      const revalidated = icpAnalysisOutputSchema.safeParse(result.output);
      if (!revalidated.success) {
        throw new AppError(
          'MODEL_OUTPUT_VALIDATION_FAILED',
          'The analysis result did not match the expected schema.',
          zodErrorToDetails(revalidated.error, ['output']),
        );
      }

      const completed = await this.closeAnalysis(analysis.id, {
        output: revalidated.data,
        durationMs: result.durationMs,
        model: result.model,
        promptVersion: result.promptVersion,
      });

      this.logger.info(
        {
          analysisId: completed.id,
          icpId,
          provider: completed.provider,
          model: completed.model,
          durationMs: completed.durationMs,
        },
        'icp analysis completed',
      );
      return toIcpAnalysisDto(completed);
    } catch (error) {
      const appError = toAppError(error);
      const code =
        error instanceof AppError ? error.code : apiErrorCodeForModelError(error);

      // Full diagnostics stay server-side; the client only sees the code and a
      // written message.
      this.logger.error(
        { analysisId: analysis.id, icpId, code, reason: describeErrorForLog(error) },
        'icp analysis failed',
      );

      await this.markFailed(analysis.id, code, appError.message, Date.now() - startedAt);
      throw appError;
    }
  }

  async list(icpId: string): Promise<IcpAnalysisListDto> {
    await this.assertIcpExists(icpId);
    const [items, total] = await Promise.all([
      this.analysisRepository.listForIcp(icpId, MAX_ANALYSES_RETURNED),
      this.analysisRepository.countForIcp(icpId),
    ]);
    return { items: items.map(toIcpAnalysisDto), total };
  }

  async getById(icpId: string, analysisId: string): Promise<IcpAnalysisDto> {
    await this.assertIcpExists(icpId);
    const record = await this.analysisRepository.findById(icpId, analysisId);
    if (!record) throw AppError.notFound(`No analysis found with id "${analysisId}"`);
    return toIcpAnalysisDto(record);
  }

  // -------------------------------------------------------------------------

  private async assertIcpExists(icpId: string): Promise<void> {
    const icp = await this.icpRepository.findById(icpId);
    if (!icp) throw AppError.notFound(`No ICP found with id "${icpId}"`);
  }

  /**
   * Builds and re-validates the model input. The stored configuration already
   * passed `icpConfigSchema` on write, so a failure here is a bug on our side,
   * not bad client input - hence INTERNAL_ERROR rather than a 400.
   */
  private buildInput(
    icpId: string,
    icpVersion: number,
    config: IcpConfig,
  ): IcpModelInput {
    const candidate = buildIcpModelInput({ icpId, icpVersion, config });
    const parsed = icpModelInputSchema.safeParse(candidate);
    if (!parsed.success) {
      throw AppError.internal(
        'The stored ICP could not be prepared for analysis',
        zodErrorToDetails(parsed.error, ['input']),
      );
    }
    return parsed.data;
  }

  private async openAnalysis(
    input: Parameters<IcpAnalysisRepository['start']>[0],
  ): Promise<{ id: string }> {
    try {
      return await this.analysisRepository.start(input);
    } catch (error) {
      this.logger.error(
        { icpId: input.icpProfileId, reason: describeErrorForLog(error) },
        'could not open an analysis record',
      );
      throw new AppError('ANALYSIS_PERSISTENCE_FAILED', 'The analysis could not be started.');
    }
  }

  /** Stores a validated result. A write failure is its own error code. */
  private async closeAnalysis(
    analysisId: string,
    input: Parameters<IcpAnalysisRepository['complete']>[1],
  ): Promise<IcpAnalysisRecord> {
    try {
      return await this.analysisRepository.complete(analysisId, input);
    } catch (error) {
      this.logger.error(
        { analysisId, reason: describeErrorForLog(error) },
        'could not store the analysis result',
      );
      throw new AppError(
        'ANALYSIS_PERSISTENCE_FAILED',
        'The analysis result could not be stored.',
      );
    }
  }

  /**
   * Closing the row must not mask the original failure: if the write itself
   * fails, that is logged and the model error is still what the caller sees.
   */
  private async markFailed(
    analysisId: string,
    code: string,
    message: string,
    durationMs: number,
  ): Promise<void> {
    try {
      await this.analysisRepository.fail(analysisId, {
        errorCode: code,
        errorMessage: message,
        durationMs,
      });
    } catch (error) {
      this.logger.error(
        { analysisId, reason: describeErrorForLog(error) },
        'could not mark the analysis as failed',
      );
    }
  }
}
