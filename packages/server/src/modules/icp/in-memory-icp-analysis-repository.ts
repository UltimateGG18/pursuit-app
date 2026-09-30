import { randomUUID } from 'node:crypto';
import type {
  IcpAnalysisCompleteInput,
  IcpAnalysisFailInput,
  IcpAnalysisRecord,
  IcpAnalysisRepository,
  IcpAnalysisStartInput,
} from './icp-analysis-repository.js';

function clone(record: IcpAnalysisRecord): IcpAnalysisRecord {
  return structuredClone(record);
}

/**
 * In-memory analysis store used by the API tests, so the whole analyze flow -
 * open a RUNNING row, call the provider, close it COMPLETED or FAILED - can be
 * asserted without a live PostgreSQL instance.
 */
export class InMemoryIcpAnalysisRepository implements IcpAnalysisRepository {
  private readonly rows = new Map<string, IcpAnalysisRecord>();
  private clock = 0;

  /** Monotonic timestamps keep `createdAt` ordering deterministic in tests. */
  private now(): Date {
    this.clock += 1000;
    return new Date(Date.UTC(2026, 0, 1) + this.clock);
  }

  /** Injected so a persistence failure can be exercised end to end. */
  failNextWrite: Error | null = null;

  private guard(): void {
    const failure = this.failNextWrite;
    if (!failure) return;
    this.failNextWrite = null;
    throw failure;
  }

  start(input: IcpAnalysisStartInput): Promise<IcpAnalysisRecord> {
    this.guard();
    const timestamp = this.now();
    const record: IcpAnalysisRecord = {
      id: randomUUID(),
      icpProfileId: input.icpProfileId,
      icpVersion: input.icpVersion,
      status: 'RUNNING',
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      analysisSchemaVersion: input.analysisSchemaVersion,
      inputSnapshot: structuredClone(input.inputSnapshot),
      output: null,
      errorCode: null,
      errorMessage: null,
      durationMs: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.rows.set(record.id, record);
    return Promise.resolve(clone(record));
  }

  complete(id: string, input: IcpAnalysisCompleteInput): Promise<IcpAnalysisRecord> {
    this.guard();
    const existing = this.rows.get(id);
    if (!existing) return Promise.reject(new Error(`No analysis with id "${id}"`));

    const updated: IcpAnalysisRecord = {
      ...existing,
      status: 'COMPLETED',
      output: structuredClone(input.output),
      durationMs: input.durationMs,
      model: input.model,
      promptVersion: input.promptVersion,
      errorCode: null,
      errorMessage: null,
      updatedAt: this.now(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(clone(updated));
  }

  fail(id: string, input: IcpAnalysisFailInput): Promise<IcpAnalysisRecord> {
    const existing = this.rows.get(id);
    if (!existing) return Promise.reject(new Error(`No analysis with id "${id}"`));

    const updated: IcpAnalysisRecord = {
      ...existing,
      status: 'FAILED',
      output: null,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      durationMs: input.durationMs,
      updatedAt: this.now(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(clone(updated));
  }

  private forIcp(icpProfileId: string): IcpAnalysisRecord[] {
    return [...this.rows.values()]
      .filter((row) => row.icpProfileId === icpProfileId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  listForIcp(icpProfileId: string, limit: number): Promise<IcpAnalysisRecord[]> {
    return Promise.resolve(this.forIcp(icpProfileId).slice(0, limit).map(clone));
  }

  findById(icpProfileId: string, analysisId: string): Promise<IcpAnalysisRecord | null> {
    const row = this.rows.get(analysisId);
    if (!row || row.icpProfileId !== icpProfileId) return Promise.resolve(null);
    return Promise.resolve(clone(row));
  }

  countForIcp(icpProfileId: string): Promise<number> {
    return Promise.resolve(this.forIcp(icpProfileId).length);
  }
}
