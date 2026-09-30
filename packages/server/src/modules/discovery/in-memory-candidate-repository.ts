import { randomUUID } from 'node:crypto';
import type {
  CandidateRepository,
  PersistSearchRunInput,
  PersistedSearchRun,
} from './candidate-repository.js';

/**
 * In-memory candidate store, the sibling of `InMemoryIcpRepository`.
 *
 * Exists so the persistence *path* can be exercised without PostgreSQL: a test
 * asserting that a run is recorded, that the cold pool is stored with its
 * reasons, or that a write failure is reported rather than swallowed should not
 * need a database container to do it.
 *
 * `failWith` is the second half of that. A store that can only succeed cannot
 * test the failure branch, and the failure branch is the interesting one - it
 * is where a response could start claiming a run was stored when it was not.
 */
export class InMemoryCandidateRepository implements CandidateRepository {
  readonly runs: (PersistSearchRunInput & { searchRunId: string })[] = [];
  /** Set to make the next and every subsequent write fail. */
  failWith: Error | null = null;

  saveRun(input: PersistSearchRunInput): Promise<PersistedSearchRun> {
    if (this.failWith) return Promise.reject(this.failWith);
    const searchRunId = randomUUID();
    this.runs.push({ ...input, searchRunId });
    return Promise.resolve({ searchRunId });
  }

  get lastRun(): (PersistSearchRunInput & { searchRunId: string }) | undefined {
    return this.runs[this.runs.length - 1];
  }
}
