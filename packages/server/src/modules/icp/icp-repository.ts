import type { IcpConfig, IcpStatus, ScoringWeights } from '@pursuit/shared';

/** A stored ICP profile row, as the repository returns it. */
export interface IcpRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  version: number;
  status: IcpStatus;
  schemaVersion: string;
  config: IcpConfig;
  submittedConfig: unknown;
  scoringWeights: ScoringWeights;
  createdBy: string | null;
  changeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Everything a write needs; the service assembles this from a validated request. */
export interface IcpWriteInput {
  name: string;
  slug: string;
  description: string | null;
  status: Exclude<IcpStatus, 'ARCHIVED'>;
  schemaVersion: string;
  config: IcpConfig;
  submittedConfig: unknown;
  scoringWeights: ScoringWeights;
  createdBy: string | null;
  changeReason: string | null;
}

export interface IcpListFilter {
  status?: IcpStatus;
  search?: string;
  limit: number;
  offset: number;
}

export interface IcpListResult {
  items: IcpRecord[];
  total: number;
}

/**
 * Persistence boundary for ICP profiles.
 *
 * The API depends on this interface rather than on Prisma so the HTTP layer can
 * be tested without a live database, and so a future read model or cache can be
 * introduced without touching the routes.
 */
export interface IcpRepository {
  /** Creates a profile at version 1 together with its first version row. */
  create(input: IcpWriteInput): Promise<IcpRecord>;

  /** Latest version of a profile. Archived profiles are not returned. */
  findById(id: string): Promise<IcpRecord | null>;

  /** Used to reject a second profile with the same name. */
  findActiveBySlug(slug: string): Promise<IcpRecord | null>;

  list(filter: IcpListFilter): Promise<IcpListResult>;

  /**
   * Replaces the configuration by appending a new version. Returns null when
   * the profile does not exist or is archived.
   */
  replace(id: string, input: IcpWriteInput): Promise<IcpRecord | null>;

  /**
   * Marks a profile archived. Version history is retained, so a delete never
   * destroys a submitted configuration.
   */
  archive(id: string): Promise<IcpRecord | null>;

  /** Number of stored versions, used by tests and the version audit. */
  countVersions(id: string): Promise<number>;
}
