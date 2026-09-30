import type { IcpProfileDto, IcpProfileSummaryDto } from '@pursuit/shared';
import type { IcpRecord } from './icp-repository.js';

export function toIcpProfileDto(record: IcpRecord): IcpProfileDto {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    description: record.description,
    version: record.version,
    status: record.status,
    schemaVersion: record.schemaVersion,
    config: record.config,
    submittedConfig: record.submittedConfig,
    scoringWeights: record.scoringWeights,
    createdBy: record.createdBy,
    changeReason: record.changeReason,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toIcpProfileSummaryDto(record: IcpRecord): IcpProfileSummaryDto {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    description: record.description,
    version: record.version,
    status: record.status,
    objective: record.config.basicProfile.objective,
    priority: record.config.basicProfile.priority,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
