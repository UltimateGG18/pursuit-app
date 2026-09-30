import { describe, expect, it } from 'vitest';
import {
  API_ERROR_STATUS,
  ModelProviderNotConfiguredError,
  ModelRateLimitedError,
  NullModelProvider,
  buildIcpModelInput,
  createExampleIcpConfig,
  isModelProviderError,
} from '../src/index.js';

const ICP_ID = '11111111-1111-4111-8111-111111111111';

describe('ModelProvider abstraction', () => {
  it('advertises that no model is available when none is configured', () => {
    const descriptor = new NullModelProvider().describe();
    expect(descriptor).toMatchObject({ id: 'none', available: false, capabilities: [] });
  });

  it('supports no capability', () => {
    expect(new NullModelProvider().supports('ICP_ANALYSIS')).toBe(false);
    expect(new NullModelProvider().supports('STRUCTURED_EXTRACTION')).toBe(false);
  });

  it('reports unavailability from healthCheck instead of throwing', async () => {
    const health = await new NullModelProvider().healthCheck();
    expect(health).toMatchObject({ available: false, provider: 'none' });
    expect(health.detail).toContain('none');
  });

  it('fails loudly instead of silently degrading when asked to analyze', async () => {
    const input = buildIcpModelInput({
      icpId: ICP_ID,
      icpVersion: 1,
      config: createExampleIcpConfig(),
    });

    await expect(new NullModelProvider().analyzeICP(input)).rejects.toBeInstanceOf(
      ModelProviderNotConfiguredError,
    );
  });

  it('fails loudly on the generic structured path too', async () => {
    const provider = new NullModelProvider();
    await expect(
      provider.generateStructured({
        capability: 'STRUCTURED_EXTRACTION',
        requestId: 'req-1',
        input: { companyId: 'c-1' },
        outputContract: {},
      }),
    ).rejects.toBeInstanceOf(ModelProviderNotConfiguredError);
  });

  it('tags its failures so the API can map them onto an error code', () => {
    const error = new ModelProviderNotConfiguredError('ICP_ANALYSIS');
    expect(isModelProviderError(error)).toBe(true);
    expect(error.code).toBe('MODEL_PROVIDER_NOT_CONFIGURED');
    // Nothing to forward: the generic case has no setting to name.
    expect(error.reason).toBeUndefined();
  });

  /**
   * A missing credential is the one provider failure an operator can fix, so
   * the port lets an adapter name the setting - and only the setting.
   */
  it('carries an operator-facing reason when a credential is missing', () => {
    const error = new ModelProviderNotConfiguredError('ICP_ANALYSIS', 'GROQ_API_KEY is not configured.');
    expect(error.reason).toBe('GROQ_API_KEY is not configured.');
  });

  it('distinguishes a rate limit from unavailability and answers 429', () => {
    const error = new ModelRateLimitedError('quota exhausted', 12);
    expect(isModelProviderError(error)).toBe(true);
    expect(error.code).toBe('MODEL_RATE_LIMITED');
    expect(error.retryAfterSeconds).toBe(12);
    expect(API_ERROR_STATUS.MODEL_RATE_LIMITED).toBe(429);
  });
});
