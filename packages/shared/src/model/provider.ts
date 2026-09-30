import type {
  IcpAnalysisModelResult,
  IcpModelInput,
  ModelProviderHealth,
} from './analysis.js';
import { ModelProviderNotConfiguredError } from './errors.js';

/**
 * ModelProvider - the seam an open-source model plugs into.
 *
 * The pipeline this abstraction belongs to is:
 *
 *   ICP -> Discovery -> Prospect -> Evidence -> Model -> Structured Model
 *   Output -> Deterministic Scoring -> Stored Result
 *
 * Only the first hop is implemented: an ICP is analyzed into structured
 * discovery intelligence. Everything downstream of that arrow is later work,
 * but it sits behind this same port, so adding it changes no API code.
 *
 * Deliberate design constraints, carried over from the implementation plan:
 *  - the provider only ever returns *structured* output, never prose;
 *  - every response carries a model id and a version so a downstream score
 *    stays reproducible;
 *  - deterministic scoring stays outside the provider.
 */

export const MODEL_CAPABILITIES = [
  'ICP_ANALYSIS',
  'STRUCTURED_EXTRACTION',
  'CLASSIFICATION',
  'SIMILARITY',
] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export interface ModelProviderDescriptor {
  /** Stable identifier, e.g. `none` or `groq`. */
  readonly id: string;
  readonly displayName: string;
  /** The concrete model/build; stored with each result. */
  readonly version: string;
  readonly capabilities: readonly ModelCapability[];
  /** False when no model is wired up. */
  readonly available: boolean;
}

export interface StructuredModelRequest<TSchema = unknown> {
  readonly capability: ModelCapability;
  /** Correlation id so a model call can be traced back to a search run. */
  readonly requestId: string;
  /** Structured facts assembled from evidence; never free-form instructions. */
  readonly input: Record<string, unknown>;
  /** Description of the output contract the caller expects. */
  readonly outputContract: TSchema;
}

export interface StructuredModelResponse<TOutput = unknown> {
  readonly requestId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly output: TOutput;
  /** 0..1 self-reported reliability, folded into the deterministic confidence. */
  readonly confidence: number;
}

export interface ModelProvider {
  describe(): ModelProviderDescriptor;
  supports(capability: ModelCapability): boolean;

  /** Cheap reachability probe. Never throws; reports unavailability instead. */
  healthCheck(): Promise<ModelProviderHealth>;

  /**
   * Turns a normalized ICP into structured discovery intelligence.
   *
   * Implementations must validate the model's answer against
   * `icpAnalysisOutputSchema` before returning, and must reject rather than
   * repair anything that does not fit.
   */
  analyzeICP(input: IcpModelInput): Promise<IcpAnalysisModelResult>;

  generateStructured<TOutput, TSchema = unknown>(
    request: StructuredModelRequest<TSchema>,
  ): Promise<StructuredModelResponse<TOutput>>;
}

/**
 * The provider selected by `MODEL_PROVIDER=none`. It advertises no capabilities
 * and throws on use, which keeps "the system works with no model configured" an
 * enforceable configuration rather than an aspiration (plan Part B, B8).
 */
export class NullModelProvider implements ModelProvider {
  describe(): ModelProviderDescriptor {
    return {
      id: 'none',
      displayName: 'No model provider configured',
      version: '0.0.0',
      capabilities: [],
      available: false,
    };
  }

  supports(capability: ModelCapability): boolean {
    return this.describe().capabilities.includes(capability);
  }

  healthCheck(): Promise<ModelProviderHealth> {
    return Promise.resolve({
      available: false,
      provider: 'none',
      model: 'none',
      checkedAt: new Date().toISOString(),
      detail: 'MODEL_PROVIDER is set to "none", so no model is connected.',
    });
  }

  analyzeICP(_input: IcpModelInput): Promise<IcpAnalysisModelResult> {
    return Promise.reject(new ModelProviderNotConfiguredError('ICP_ANALYSIS'));
  }

  generateStructured<TOutput, TSchema = unknown>(
    request: StructuredModelRequest<TSchema>,
  ): Promise<StructuredModelResponse<TOutput>> {
    return Promise.reject(new ModelProviderNotConfiguredError(request.capability));
  }
}
