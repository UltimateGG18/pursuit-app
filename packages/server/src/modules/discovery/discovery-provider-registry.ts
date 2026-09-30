import {
  NullDiscoveryProvider,
  NullPeopleDiscoveryProvider,
  NullPeopleEnrichmentProvider,
  type CompanyDiscoveryProvider,
  type DiscoveryProviderDescriptor,
  type PeopleDiscoveryProvider,
  type PeopleEnrichmentProvider,
} from '@pursuit/shared';
import type { Env } from '../../config/env.js';
import { ApolloClient, type ApolloLogger } from '../apollo/apollo-client.js';
import { ApolloService } from '../apollo/apollo-service.js';
import { ApolloPeopleService } from '../apollo/apollo-people-service.js';
import { ApolloPeopleEnrichmentService } from '../apollo/apollo-people-enrichment-service.js';

/**
 * Resolves the configured `CompanyDiscoveryProvider`.
 *
 * The registry is the whole switching mechanism, exactly as it is for the model
 * provider: adding a data provider is one entry here plus one class
 * implementing the port. Nothing above this file mentions Apollo, so
 * `DiscoveryService`, the strategies and the routes are unaware of which
 * provider is answering.
 *
 * Neither provider falls back to the other. `none` fails every discovery call
 * loudly and `apollo` reports an Apollo failure as an Apollo failure - there is
 * no silent second attempt behind either.
 */
export interface DiscoveryProviderDeps {
  readonly logger?: ApolloLogger;
}

/**
 * The Apollo transport, built once per resolution.
 *
 * The company and people adapters share one client deliberately: they share a
 * credential, a base URL, a timeout budget and a retry policy, and giving them
 * two clients would mean two places to configure and two sets of rate-limit
 * headroom to reason about for what is one Apollo account.
 */
function apolloClient(env: Env, deps: DiscoveryProviderDeps): ApolloClient {
  return new ApolloClient({
    apiKey: env.APOLLO_API_KEY,
    baseUrl: env.APOLLO_BASE_URL,
    timeoutMs: env.APOLLO_TIMEOUT_MS,
    maxAttempts: env.APOLLO_MAX_ATTEMPTS,
    retryBaseDelayMs: env.APOLLO_RETRY_BASE_DELAY_MS,
    ...(deps.logger ? { logger: deps.logger } : {}),
  });
}

const providers: Record<
  Env['DISCOVERY_PROVIDER'],
  (env: Env, deps: DiscoveryProviderDeps) => CompanyDiscoveryProvider
> = {
  none: () => new NullDiscoveryProvider(),
  apollo: (env, deps) =>
    new ApolloService({
      client: apolloClient(env, deps),
      maxPagesPerSearch: env.APOLLO_MAX_PAGES_PER_SEARCH,
    }),
};

/**
 * The people providers, keyed by the same setting.
 *
 * One setting selects both, because `DISCOVERY_PROVIDER` names the data vendor
 * rather than one of its endpoints - an operator configuring Apollo is
 * configuring Apollo, not opting into company search and separately into people
 * search. A vendor that can only do one of the two would register the null
 * implementation for the other here, and the API would report that endpoint as
 * unavailable while the rest kept working.
 */
const peopleProviders: Record<
  Env['DISCOVERY_PROVIDER'],
  (env: Env, deps: DiscoveryProviderDeps) => PeopleDiscoveryProvider
> = {
  none: () => new NullPeopleDiscoveryProvider(),
  apollo: (env, deps) => new ApolloPeopleService({ client: apolloClient(env, deps) }),
};

/**
 * The contact enrichment providers, keyed by the same setting again.
 *
 * `APOLLO_ENRICHMENT_ENABLED=false` resolves the null provider rather than
 * being handled by the caller, so "enrichment is switched off" and "no vendor
 * sells it" take the same path through the system and are reported to the user
 * in the same words. There is one less branch above this file as a result.
 */
const enrichmentProviders: Record<
  Env['DISCOVERY_PROVIDER'],
  (env: Env, deps: DiscoveryProviderDeps) => PeopleEnrichmentProvider
> = {
  none: () => new NullPeopleEnrichmentProvider(),
  apollo: (env, deps) =>
    env.APOLLO_ENRICHMENT_ENABLED
      ? new ApolloPeopleEnrichmentService({ client: apolloClient(env, deps) })
      : new NullPeopleEnrichmentProvider(),
};

export function resolveDiscoveryProvider(
  env: Env,
  deps: DiscoveryProviderDeps = {},
): CompanyDiscoveryProvider {
  return providers[env.DISCOVERY_PROVIDER](env, deps);
}

export function resolvePeopleProvider(
  env: Env,
  deps: DiscoveryProviderDeps = {},
): PeopleDiscoveryProvider {
  return peopleProviders[env.DISCOVERY_PROVIDER](env, deps);
}

export function resolvePeopleEnrichmentProvider(
  env: Env,
  deps: DiscoveryProviderDeps = {},
): PeopleEnrichmentProvider {
  return enrichmentProviders[env.DISCOVERY_PROVIDER](env, deps);
}

export function describeDiscoveryProvider(env: Env): DiscoveryProviderDescriptor {
  return resolveDiscoveryProvider(env).describe();
}
