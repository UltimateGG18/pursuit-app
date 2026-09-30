import { Prisma } from '@prisma/client';
import type { ICPAnalysis, PrismaClient } from '@prisma/client';
import type { IcpAnalysisOutput } from '@pursuit/shared';
import type {
  IcpAnalysisCompleteInput,
  IcpAnalysisFailInput,
  IcpAnalysisRecord,
  IcpAnalysisRepository,
  IcpAnalysisStartInput,
} from './icp-analysis-repository.js';

/**
 * The boundary cast for this module, mirroring `PrismaIcpRepository`: Prisma
 * types JSON columns as its own `JsonValue`, while the values written here have
 * already passed `icpAnalysisOutputSchema`, so the shape is guaranteed by
 * validation rather than by the ORM's type.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toRecord(row: ICPAnalysis): IcpAnalysisRecord {
  return {
    id: row.id,
    icpProfileId: row.icpProfileId,
    icpVersion: row.icpVersion,
    status: row.status,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    analysisSchemaVersion: row.analysisSchemaVersion,
    inputSnapshot: row.inputSnapshot,
    output: (row.output ?? null) as IcpAnalysisOutput | null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaIcpAnalysisRepository implements IcpAnalysisRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async start(input: IcpAnalysisStartInput): Promise<IcpAnalysisRecord> {
    const row = await this.prisma.iCPAnalysis.create({
      data: {
        icpProfileId: input.icpProfileId,
        icpVersion: input.icpVersion,
        status: 'RUNNING',
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        analysisSchemaVersion: input.analysisSchemaVersion,
        inputSnapshot: toJson(input.inputSnapshot),
      },
    });
    return toRecord(row);
  }

  async complete(id: string, input: IcpAnalysisCompleteInput): Promise<IcpAnalysisRecord> {
    const row = await this.prisma.iCPAnalysis.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        output: toJson(input.output),
        durationMs: input.durationMs,
        // The provider reports which model actually answered, which may differ
        // from the configured one if the runtime resolved an alias.
        model: input.model,
        promptVersion: input.promptVersion,
        errorCode: null,
        errorMessage: null,
      },
    });
    return toRecord(row);
  }

  async fail(id: string, input: IcpAnalysisFailInput): Promise<IcpAnalysisRecord> {
    const row = await this.prisma.iCPAnalysis.update({
      where: { id },
      data: {
        status: 'FAILED',
        // Left null on purpose: a failed run must never look like a result.
        output: Prisma.DbNull,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        durationMs: input.durationMs,
      },
    });
    return toRecord(row);
  }

  async listForIcp(icpProfileId: string, limit: number): Promise<IcpAnalysisRecord[]> {
    const rows = await this.prisma.iCPAnalysis.findMany({
      where: { icpProfileId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async findById(icpProfileId: string, analysisId: string): Promise<IcpAnalysisRecord | null> {
    const row = await this.prisma.iCPAnalysis.findFirst({
      where: { id: analysisId, icpProfileId },
    });
    return row ? toRecord(row) : null;
  }

  countForIcp(icpProfileId: string): Promise<number> {
    return this.prisma.iCPAnalysis.count({ where: { icpProfileId } });
  }
}
