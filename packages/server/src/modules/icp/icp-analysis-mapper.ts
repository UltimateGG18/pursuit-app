import type { IcpAnalysisDto } from '@pursuit/shared';
import type { IcpAnalysisRecord } from './icp-analysis-repository.js';

export function toIcpAnalysisDto(record: IcpAnalysisRecord): IcpAnalysisDto {
  return {
    id: record.id,
    icpId: record.icpProfileId,
    icpVersion: record.icpVersion,
    status: record.status,
    provider: record.provider,
    model: record.model,
    promptVersion: record.promptVersion,
    analysisSchemaVersion: record.analysisSchemaVersion,
    inputSnapshot: record.inputSnapshot,
    output: record.output,
    error:
      record.errorCode === null
        ? null
        : { code: record.errorCode, message: record.errorMessage ?? '' },
    durationMs: record.durationMs,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
