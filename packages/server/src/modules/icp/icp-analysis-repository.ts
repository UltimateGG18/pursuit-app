import type { IcpAnalysisOutput, IcpAnalysisStatus, IcpModelInput } from '@pursuit/shared';

/** A stored analysis row, as the repository returns it. */
export interface IcpAnalysisRecord {
  id: string;
  icpProfileId: string;
  /** ICP version the analysis ran against; the ICP may have moved on since. */
  icpVersion: number;
  status: IcpAnalysisStatus;
  provider: string;
  model: string;
  promptVersion: string;
  analysisSchemaVersion: string;
  /** The exact normalized input handed to the model, for reproducibility. */
  inputSnapshot: unknown;
  output: IcpAnalysisOutput | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Opens an analysis before the model is called, so a crash leaves a trace. */
export interface IcpAnalysisStartInput {
  icpProfileId: string;
  icpVersion: number;
  provider: string;
  model: string;
  promptVersion: string;
  analysisSchemaVersion: string;
  inputSnapshot: IcpModelInput;
}

export interface IcpAnalysisCompleteInput {
  output: IcpAnalysisOutput;
  durationMs: number;
  /** The model that actually answered, which the provider reports back. */
  model: string;
  promptVersion: string;
}

export interface IcpAnalysisFailInput {
  errorCode: string;
  errorMessage: string;
  durationMs: number;
}

/**
 * Persistence boundary for ICP analyses.
 *
 * Separate from `IcpRepository` because an analysis is a different lifecycle:
 * it is created in a running state, then closed exactly once. Keeping it behind
 * its own interface is what lets the API tests drive the whole analyze flow
 * without a database.
 */
export interface IcpAnalysisRepository {
  /** Creates the row in RUNNING state and returns it. */
  start(input: IcpAnalysisStartInput): Promise<IcpAnalysisRecord>;

  /** Closes the row as COMPLETED with the validated output. */
  complete(id: string, input: IcpAnalysisCompleteInput): Promise<IcpAnalysisRecord>;

  /** Closes the row as FAILED. The output column stays null. */
  fail(id: string, input: IcpAnalysisFailInput): Promise<IcpAnalysisRecord>;

  /** Newest first. */
  listForIcp(icpProfileId: string, limit: number): Promise<IcpAnalysisRecord[]>;

  findById(icpProfileId: string, analysisId: string): Promise<IcpAnalysisRecord | null>;

  countForIcp(icpProfileId: string): Promise<number>;
}
