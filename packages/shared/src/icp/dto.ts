import type { IcpStatus } from './catalogs/basic.js';
import type { IcpConfig, ScoringWeights } from './schema.js';

/** Full ICP profile as returned by the API. */
export interface IcpProfileDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly version: number;
  readonly status: IcpStatus;
  readonly schemaVersion: string;
  /** Normalized configuration; this is what the pipeline will read. */
  readonly config: IcpConfig;
  /** Exactly what the client submitted for this version, kept for audit. */
  readonly submittedConfig: unknown;
  readonly scoringWeights: ScoringWeights;
  readonly createdBy: string | null;
  readonly changeReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Lightweight row used by the ICP list screen. */
export interface IcpProfileSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly version: number;
  readonly status: IcpStatus;
  readonly objective: IcpConfig['basicProfile']['objective'];
  readonly priority: IcpConfig['basicProfile']['priority'];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IcpProfileListDto {
  readonly items: IcpProfileSummaryDto[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface DeletedIcpDto {
  readonly id: string;
  readonly status: IcpStatus;
  readonly deletedAt: string;
}
