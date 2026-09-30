import {
  createExampleAnalysisOutput,
  type IcpAnalysisModelResult,
  type IcpAnalysisOutput,
  type IcpModelInput,
  type ModelCapability,
  type ModelProvider,
  type ModelProviderDescriptor,
  type ModelProviderHealth,
  type StructuredModelRequest,
  type StructuredModelResponse,
} from '@pursuit/shared';

/**
 * A complete, contract-valid analysis, used wherever a good model answer is
 * needed.
 *
 * Delegated to the shared worked example rather than kept here: the analysis
 * contract is validated in three packages, and a local copy is how those three
 * end up disagreeing about what "valid" means.
 */
export function validAnalysisOutput(): IcpAnalysisOutput {
  return createExampleAnalysisOutput();
}

export interface StubProviderOptions {
  /** What `analyzeICP` resolves with, or the error it rejects with. */
  output?: unknown;
  error?: Error;
  health?: Partial<ModelProviderHealth>;
}

/**
 * A `ModelProvider` that answers from a script.
 *
 * The API tests use it so the whole analyze flow - open RUNNING, call the
 * provider, validate, close - is exercised without a model runtime, and so the
 * failure branches can be triggered deterministically.
 */
export class StubModelProvider implements ModelProvider {
  readonly calls: IcpModelInput[] = [];

  constructor(private readonly options: StubProviderOptions = {}) {}

  describe(): ModelProviderDescriptor {
    return {
      id: 'stub',
      displayName: 'Stub provider',
      version: 'stub-model:1b',
      capabilities: ['ICP_ANALYSIS'],
      available: true,
    };
  }

  supports(capability: ModelCapability): boolean {
    return capability === 'ICP_ANALYSIS';
  }

  healthCheck(): Promise<ModelProviderHealth> {
    return Promise.resolve({
      available: true,
      provider: 'stub',
      model: 'stub-model:1b',
      checkedAt: '2026-01-01T00:00:00.000Z',
      detail: 'stub',
      ...this.options.health,
    });
  }

  analyzeICP(input: IcpModelInput): Promise<IcpAnalysisModelResult> {
    this.calls.push(input);
    if (this.options.error) return Promise.reject(this.options.error);

    return Promise.resolve({
      requestId: 'stub-request',
      provider: 'stub',
      model: 'stub-model:1b',
      promptVersion: 'stub-v1',
      // Cast at the seam on purpose: the point of some tests is to hand the
      // service an output the contract rejects.
      output: (this.options.output ?? validAnalysisOutput()) as IcpAnalysisOutput,
      durationMs: 42,
    });
  }

  generateStructured<TOutput>(
    _request: StructuredModelRequest,
  ): Promise<StructuredModelResponse<TOutput>> {
    return Promise.reject(new Error('not used in these tests'));
  }
}
