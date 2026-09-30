import type { ICPProfile, Prisma, PrismaClient } from '@prisma/client';
import type { IcpConfig, ScoringWeights } from '@pursuit/shared';
import type {
  IcpListFilter,
  IcpListResult,
  IcpRecord,
  IcpRepository,
  IcpWriteInput,
} from './icp-repository.js';

/**
 * The single boundary cast in this module. Prisma types JSON columns as its own
 * `JsonValue`/`InputJsonValue`; the domain objects are plain JSON validated by
 * `icpConfigSchema`, so the shape is guaranteed by validation rather than by the
 * ORM's type.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toRecord(row: ICPProfile): IcpRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    version: row.version,
    status: row.status,
    schemaVersion: row.schemaVersion,
    config: row.config as unknown as IcpConfig,
    submittedConfig: row.submittedConfig,
    scoringWeights: row.scoringWeights as unknown as ScoringWeights,
    createdBy: row.createdBy,
    changeReason: row.changeReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/** Fields shared by the profile row and its append-only version row. */
function versionPayload(input: IcpWriteInput, version: number) {
  return {
    version,
    status: input.status,
    schemaVersion: input.schemaVersion,
    config: toJson(input.config),
    submittedConfig: toJson(input.submittedConfig),
    scoringWeights: toJson(input.scoringWeights),
    createdBy: input.createdBy,
    changeReason: input.changeReason,
  };
}

export class PrismaIcpRepository implements IcpRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: IcpWriteInput): Promise<IcpRecord> {
    const row = await this.prisma.iCPProfile.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        version: 1,
        status: input.status,
        schemaVersion: input.schemaVersion,
        config: toJson(input.config),
        submittedConfig: toJson(input.submittedConfig),
        scoringWeights: toJson(input.scoringWeights),
        createdBy: input.createdBy,
        changeReason: input.changeReason,
        versions: { create: [versionPayload(input, 1)] },
      },
    });
    return toRecord(row);
  }

  async findById(id: string): Promise<IcpRecord | null> {
    const row = await this.prisma.iCPProfile.findFirst({ where: { id, deletedAt: null } });
    return row ? toRecord(row) : null;
  }

  async findActiveBySlug(slug: string): Promise<IcpRecord | null> {
    const row = await this.prisma.iCPProfile.findFirst({ where: { slug, deletedAt: null } });
    return row ? toRecord(row) : null;
  }

  async list(filter: IcpListFilter): Promise<IcpListResult> {
    const where = {
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? { name: { contains: filter.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.iCPProfile.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
      }),
      this.prisma.iCPProfile.count({ where }),
    ]);

    return { items: items.map(toRecord), total };
  }

  /**
   * Appends a new version and points the profile row at it. Both writes happen
   * in one transaction so a profile can never advertise a version that has no
   * stored configuration.
   */
  async replace(id: string, input: IcpWriteInput): Promise<IcpRecord | null> {
    const existing = await this.prisma.iCPProfile.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, version: true },
    });
    if (!existing) return null;

    const nextVersion = existing.version + 1;
    const [, updated] = await this.prisma.$transaction([
      this.prisma.iCPProfileVersion.create({
        data: { icpProfileId: id, ...versionPayload(input, nextVersion) },
      }),
      this.prisma.iCPProfile.update({
        where: { id },
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          version: nextVersion,
          status: input.status,
          schemaVersion: input.schemaVersion,
          config: toJson(input.config),
          submittedConfig: toJson(input.submittedConfig),
          scoringWeights: toJson(input.scoringWeights),
          createdBy: input.createdBy,
          changeReason: input.changeReason,
        },
      }),
    ]);

    return toRecord(updated);
  }

  async archive(id: string): Promise<IcpRecord | null> {
    const existing = await this.prisma.iCPProfile.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) return null;

    const row = await this.prisma.iCPProfile.update({
      where: { id },
      data: { status: 'ARCHIVED', deletedAt: new Date() },
    });
    return toRecord(row);
  }

  countVersions(id: string): Promise<number> {
    return this.prisma.iCPProfileVersion.count({ where: { icpProfileId: id } });
  }
}
