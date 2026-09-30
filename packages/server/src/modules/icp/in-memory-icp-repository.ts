import { randomUUID } from 'node:crypto';
import type {
  IcpListFilter,
  IcpListResult,
  IcpRecord,
  IcpRepository,
  IcpWriteInput,
} from './icp-repository.js';

/** Records are cloned on the way in and out so callers cannot mutate the store. */
function clone(record: IcpRecord): IcpRecord {
  return structuredClone(record);
}

interface StoredVersion {
  icpProfileId: string;
  version: number;
  input: IcpWriteInput;
  createdAt: Date;
}

/**
 * In-memory repository used by the API tests. It reproduces the behaviour the
 * routes depend on - soft delete, slug lookup, append-only versioning - so the
 * HTTP contract can be tested without a live PostgreSQL instance.
 */
export class InMemoryIcpRepository implements IcpRepository {
  private readonly profiles = new Map<string, IcpRecord>();
  private readonly versions: StoredVersion[] = [];
  private clock = 0;

  /** Monotonic timestamps keep `updatedAt` ordering deterministic in tests. */
  private now(): Date {
    this.clock += 1000;
    return new Date(Date.UTC(2026, 0, 1) + this.clock);
  }

  create(input: IcpWriteInput): Promise<IcpRecord> {
    const timestamp = this.now();
    const record: IcpRecord = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      description: input.description,
      version: 1,
      status: input.status,
      schemaVersion: input.schemaVersion,
      config: input.config,
      submittedConfig: input.submittedConfig,
      scoringWeights: input.scoringWeights,
      createdBy: input.createdBy,
      changeReason: input.changeReason,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    this.profiles.set(record.id, record);
    this.versions.push({ icpProfileId: record.id, version: 1, input, createdAt: timestamp });
    return Promise.resolve(clone(record));
  }

  findById(id: string): Promise<IcpRecord | null> {
    const record = this.profiles.get(id);
    if (!record || record.deletedAt !== null) return Promise.resolve(null);
    return Promise.resolve(clone(record));
  }

  findActiveBySlug(slug: string): Promise<IcpRecord | null> {
    for (const record of this.profiles.values()) {
      if (record.slug === slug && record.deletedAt === null) {
        return Promise.resolve(clone(record));
      }
    }
    return Promise.resolve(null);
  }

  list(filter: IcpListFilter): Promise<IcpListResult> {
    const search = filter.search?.toLowerCase();
    const matches = [...this.profiles.values()]
      .filter((record) => record.deletedAt === null)
      .filter((record) => (filter.status ? record.status === filter.status : true))
      .filter((record) => (search ? record.name.toLowerCase().includes(search) : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return Promise.resolve({
      items: matches.slice(filter.offset, filter.offset + filter.limit).map(clone),
      total: matches.length,
    });
  }

  replace(id: string, input: IcpWriteInput): Promise<IcpRecord | null> {
    const existing = this.profiles.get(id);
    if (!existing || existing.deletedAt !== null) return Promise.resolve(null);

    const timestamp = this.now();
    const nextVersion = existing.version + 1;
    const updated: IcpRecord = {
      ...existing,
      name: input.name,
      slug: input.slug,
      description: input.description,
      version: nextVersion,
      status: input.status,
      schemaVersion: input.schemaVersion,
      config: input.config,
      submittedConfig: input.submittedConfig,
      scoringWeights: input.scoringWeights,
      createdBy: input.createdBy,
      changeReason: input.changeReason,
      updatedAt: timestamp,
    };
    this.profiles.set(id, updated);
    this.versions.push({ icpProfileId: id, version: nextVersion, input, createdAt: timestamp });
    return Promise.resolve(clone(updated));
  }

  archive(id: string): Promise<IcpRecord | null> {
    const existing = this.profiles.get(id);
    if (!existing || existing.deletedAt !== null) return Promise.resolve(null);

    const archived: IcpRecord = {
      ...existing,
      status: 'ARCHIVED',
      deletedAt: this.now(),
    };
    this.profiles.set(id, archived);
    return Promise.resolve(clone(archived));
  }

  countVersions(id: string): Promise<number> {
    return Promise.resolve(this.versions.filter((version) => version.icpProfileId === id).length);
  }

  /** Test helper: the submitted payload stored for a specific version. */
  submittedConfigForVersion(id: string, version: number): unknown {
    return this.versions.find(
      (stored) => stored.icpProfileId === id && stored.version === version,
    )?.input.submittedConfig;
  }
}
