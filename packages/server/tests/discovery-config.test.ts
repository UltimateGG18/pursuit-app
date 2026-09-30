import { describe, expect, it } from 'vitest';
import {
  DiscoveryProviderNotConfiguredError,
  NullPeopleEnrichmentProvider,
} from '@pursuit/shared';
import { loadEnv, loadEnvOrThrow } from '../src/config/env.js';
import {
  describeDiscoveryProvider,
  resolveDiscoveryProvider,
  resolvePeopleEnrichmentProvider,
} from '../src/modules/discovery/discovery-provider-registry.js';
import { ApolloService } from '../src/modules/apollo/apollo-service.js';
import { ApolloPeopleEnrichmentService } from '../src/modules/apollo/apollo-people-enrichment-service.js';

const baseEnv = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' };
const apolloEnv = {
  ...baseEnv,
  DISCOVERY_PROVIDER: 'apollo',
  // Not a credential.
  APOLLO_API_KEY: 'test-apollo-key',
};

describe('discovery environment configuration', () => {
  it('applies defaults, and stays fully working with no provider configured', () => {
    const result = loadEnv(baseEnv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.env).toMatchObject({
      // The default install boots and serves ICPs; only discovery is absent.
      DISCOVERY_PROVIDER: 'none',
      APOLLO_API_KEY: '',
      APOLLO_BASE_URL: 'https://api.apollo.io',
      APOLLO_TIMEOUT_MS: 10000,
      APOLLO_MAX_ATTEMPTS: 2,
      APOLLO_RETRY_BASE_DELAY_MS: 250,
      APOLLO_MAX_PAGES_PER_SEARCH: 5,
    });
  });

  it('reads the Apollo settings from the environment', () => {
    const env = loadEnvOrThrow({
      ...apolloEnv,
      APOLLO_BASE_URL: 'https://apollo.test',
      APOLLO_TIMEOUT_MS: '2500',
      APOLLO_MAX_ATTEMPTS: '3',
      APOLLO_MAX_PAGES_PER_SEARCH: '2',
    });

    expect(env.APOLLO_BASE_URL).toBe('https://apollo.test');
    expect(env.APOLLO_TIMEOUT_MS).toBe(2500);
    expect(env.APOLLO_MAX_ATTEMPTS).toBe(3);
    expect(env.APOLLO_MAX_PAGES_PER_SEARCH).toBe(2);
  });

  it('boots even when Apollo is selected without a key', () => {
    // A server that refuses to start can report nothing at all, so the missing
    // key is a reported state rather than a boot failure.
    const result = loadEnv({ ...baseEnv, DISCOVERY_PROVIDER: 'apollo' });

    expect(result.ok).toBe(true);
    expect(describeDiscoveryProvider(loadEnvOrThrow({ ...baseEnv, DISCOVERY_PROVIDER: 'apollo' })))
      .toMatchObject({ id: 'apollo', available: false });
  });

  it('rejects a malformed base URL', () => {
    expect(loadEnv({ ...apolloEnv, APOLLO_BASE_URL: 'not-a-url' }).ok).toBe(false);
  });

  it('rejects a timeout too short to be a real budget', () => {
    expect(loadEnv({ ...apolloEnv, APOLLO_TIMEOUT_MS: '10' }).ok).toBe(false);
  });

  it('rejects an unknown discovery provider rather than falling back', () => {
    expect(loadEnv({ ...baseEnv, DISCOVERY_PROVIDER: 'clearbit' }).ok).toBe(false);
  });

  it('rejects a page ceiling that would allow an unbounded walk', () => {
    expect(loadEnv({ ...apolloEnv, APOLLO_MAX_PAGES_PER_SEARCH: '0' }).ok).toBe(false);
    expect(loadEnv({ ...apolloEnv, APOLLO_MAX_PAGES_PER_SEARCH: '500' }).ok).toBe(false);
  });
});

describe('discovery provider registry', () => {
  it('resolves the null provider and reports it unavailable when none is configured', () => {
    expect(describeDiscoveryProvider(loadEnvOrThrow(baseEnv))).toMatchObject({
      id: 'none',
      available: false,
    });
  });

  it('rejects a search so no code path can silently depend on a provider', async () => {
    const provider = resolveDiscoveryProvider(loadEnvOrThrow(baseEnv));

    await expect(provider.search({ limit: 10 })).rejects.toBeInstanceOf(
      DiscoveryProviderNotConfiguredError,
    );
  });

  it('reports unavailability from the null provider\'s health check rather than throwing', async () => {
    const health = await resolveDiscoveryProvider(loadEnvOrThrow(baseEnv)).healthCheck();

    expect(health.available).toBe(false);
    expect(health.detail).toContain('DISCOVERY_PROVIDER');
  });

  it('resolves Apollo from configuration alone', () => {
    const env = loadEnvOrThrow(apolloEnv);
    const provider = resolveDiscoveryProvider(env);

    expect(provider).toBeInstanceOf(ApolloService);
    expect(provider.describe()).toMatchObject({
      id: 'apollo',
      version: 'v1',
      // Apollo's documented page ceiling reaches the descriptor.
      maxPageSize: 100,
      available: true,
    });
  });
});

/**
 * Enrichment configuration.
 *
 * The settings that decide whether a contact lookup happens at all, and how
 * much of one. Two of the three are spend controls, and the assertions below
 * are mostly about their defaults: an operator who configures nothing must not
 * discover a phone bill, and one who configures nothing must also not discover
 * a prospect list nobody can contact.
 */
describe('enrichment environment configuration', () => {
  it('enriches by default, because a search alone returns no contact data', () => {
    const env = loadEnvOrThrow(apolloEnv);

    // A people search returns neither email addresses nor phone numbers at any
    // provider. With enrichment off, a run produces names nobody can contact.
    expect(env.APOLLO_ENRICHMENT_ENABLED).toBe(true);
  });

  it('leaves phone reveal off until an operator asks for it', () => {
    const env = loadEnvOrThrow(apolloEnv);

    // Phone reveal consumes a separate credit type and resolves
    // asynchronously, so the credit is spent whether or not a number arrives.
    expect(env.APOLLO_REVEAL_PHONE_NUMBERS).toBe(false);
  });

  it('caps enrichments per run independently of the caller\'s page size', () => {
    const env = loadEnvOrThrow(apolloEnv);
    expect(env.APOLLO_MAX_ENRICHMENTS_PER_RUN).toBe(25);

    const raised = loadEnvOrThrow({ ...apolloEnv, APOLLO_MAX_ENRICHMENTS_PER_RUN: '100' });
    expect(raised.APOLLO_MAX_ENRICHMENTS_PER_RUN).toBe(100);
  });

  it('rejects a per-run ceiling outside the supported range', () => {
    expect(loadEnv({ ...apolloEnv, APOLLO_MAX_ENRICHMENTS_PER_RUN: '0' }).ok).toBe(false);
    expect(loadEnv({ ...apolloEnv, APOLLO_MAX_ENRICHMENTS_PER_RUN: '5000' }).ok).toBe(false);
  });

  it('resolves the Apollo enrichment adapter when Apollo is configured', () => {
    const provider = resolvePeopleEnrichmentProvider(loadEnvOrThrow(apolloEnv));

    expect(provider).toBeInstanceOf(ApolloPeopleEnrichmentService);
    expect(provider.describeEnrichment()).toMatchObject({ id: 'apollo', available: true });
  });

  it('resolves the null adapter when enrichment is switched off', () => {
    const provider = resolvePeopleEnrichmentProvider(
      loadEnvOrThrow({ ...apolloEnv, APOLLO_ENRICHMENT_ENABLED: 'false' }),
    );

    // "Switched off" and "no vendor sells it" take the same path, so both are
    // reported to the user in the same words.
    expect(provider).toBeInstanceOf(NullPeopleEnrichmentProvider);
    expect(provider.describeEnrichment().available).toBe(false);
  });

  it('resolves the null adapter when no provider is configured at all', () => {
    const provider = resolvePeopleEnrichmentProvider(loadEnvOrThrow(baseEnv));
    expect(provider).toBeInstanceOf(NullPeopleEnrichmentProvider);
  });

  it('reports every candidate as UNAVAILABLE rather than rejecting, with no provider', async () => {
    const provider = resolvePeopleEnrichmentProvider(loadEnvOrThrow(baseEnv));

    const result = await provider.enrichPeople(
      [
        {
          personRef: 'apollo:person:p1',
          identity: { basis: 'PROVIDER_ID', provider: 'apollo', externalPersonId: 'p1' },
        },
      ],
      { revealPhoneNumbers: false },
    );

    expect(result[0]?.enrichment.status).toBe('UNAVAILABLE');
    expect(result[0]?.contact.phoneNumbers).toEqual([]);
  });
});
