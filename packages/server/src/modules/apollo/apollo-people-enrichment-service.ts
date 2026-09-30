import {
  DiscoveryAuthenticationError,
  DiscoveryProviderNotConfiguredError,
  DiscoveryRateLimitError,
  isDiscoveryProviderError,
  type DiscoveryProviderDescriptor,
  type EnrichPeopleOptions,
  type EnrichPersonInput,
  type EnrichedProspect,
  type PeopleEnrichmentProvider,
  type ProspectEnrichmentStatus,
} from '@pursuit/shared';
import {
  APOLLO_BULK_MATCH_MAX,
  type ApolloClient,
  type ApolloPersonMatchDetails,
} from './apollo-client.js';
import type { ApolloEnrichedPersonDto } from './apollo-enrichment-dto.js';
import {
  normalizeApolloEnrichedPerson,
  unenrichedProspect,
} from './apollo-enrichment-normalizer.js';

/**
 * Apollo as a `PeopleEnrichmentProvider`.
 *
 * The third Apollo adapter, alongside `ApolloService` (firmographic search) and
 * `ApolloPeopleService` (people search). Separate from both for the reason they
 * are separate from each other: a different endpoint pair, a different billing
 * model, and a different failure contract - this one is expected to return
 * partial results where a search either works or does not.
 *
 * Its boundaries:
 *
 *  - **No HTTP.** Every request goes through the shared `ApolloClient`, which
 *    owns the credential, the timeout, the bounded retry and payload
 *    validation. There is exactly one Apollo client in this process.
 *  - **No fabrication.** What Apollo returns is normalized; what it does not
 *    return is absent. Nothing is patterned, guessed or filled in from another
 *    field.
 *  - **No exception for one person's failure.** Per-person outcomes are
 *    statuses. `enrichPeople` resolves even when Apollo refuses the whole call,
 *    because a run that discovered 25 people and enriched none of them is still
 *    a run with 25 usable people in it.
 *
 * ## Why it batches, and why it stops early
 *
 * Apollo's bulk endpoint enriches ten people per request, so twenty-five
 * candidates cost three requests rather than twenty-five. The batches are run
 * in sequence, not in parallel: they share one per-minute rate window, and
 * firing three at once is the reliable way to turn a working run into a 429.
 *
 * And when a batch fails for a reason the *next* batch would also hit - a
 * refused credential, an exhausted quota, a plan that does not include
 * enrichment - the remaining batches are not attempted at all. Asking again
 * inside an exhausted window makes the limit worse while buying nothing, and
 * every remaining candidate is marked with the same status so the result stays
 * complete.
 */

export interface ApolloPeopleEnrichmentServiceOptions {
  readonly client: ApolloClient;
}

/** Splits a list into consecutive chunks of at most `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * How one provider failure maps onto a per-person status.
 *
 * The distinction that matters is whether a human can do anything about it.
 * A refused key, a missing scope and an unavailable plan are UNAVAILABLE: the
 * repair is in the Apollo console and no amount of retrying changes it.
 * Everything else - a timeout, a 5xx, an exhausted rate window, a payload that
 * did not validate - is FAILED, which says "this may work if you run it again".
 */
function statusForError(error: unknown): ProspectEnrichmentStatus {
  if (error instanceof DiscoveryProviderNotConfiguredError) return 'UNAVAILABLE';
  if (error instanceof DiscoveryAuthenticationError) return 'UNAVAILABLE';
  return 'FAILED';
}

/**
 * Whether a failure will hit every subsequent batch too.
 *
 * Configuration, credential and quota failures are properties of the *account*,
 * not of the ten people in the batch that happened to hit them. Continuing
 * would spend requests that cannot succeed - and in the rate-limit case, would
 * actively deepen the limit.
 */
function isAccountLevelFailure(error: unknown): boolean {
  return (
    error instanceof DiscoveryProviderNotConfiguredError ||
    error instanceof DiscoveryAuthenticationError ||
    error instanceof DiscoveryRateLimitError
  );
}

/**
 * Frontend-safe wording for a failed batch.
 *
 * Deliberately not Apollo's own message. That message is the only account of
 * *why* Apollo refused and it belongs in the server log, but it can carry an
 * endpoint path, an internal error code or an account identifier, and none of
 * those are written for the person reading a prospect list. The one exception
 * is a configuration mistake, which is only fixable if it is named - and that
 * message is contractually free of secrets and request data.
 */
function detailForError(error: unknown): string {
  if (error instanceof DiscoveryProviderNotConfiguredError) {
    return error.reason ?? 'The contact enrichment provider is not configured.';
  }
  if (error instanceof DiscoveryAuthenticationError) {
    return 'Contact enrichment is not available for the current provider account. The credential was refused or its plan does not include enrichment.';
  }
  if (error instanceof DiscoveryRateLimitError) {
    const retry =
      error.retryAfterSeconds === undefined
        ? ''
        : ` Retry after about ${String(error.retryAfterSeconds)}s.`;
    return `Contact enrichment is rate limited. The provider quota is exhausted for now.${retry}`;
  }
  if (isDiscoveryProviderError(error)) {
    return 'The contact enrichment provider could not be reached, so no contact details were retrieved.';
  }
  return 'Contact enrichment failed unexpectedly, so no contact details were retrieved.';
}

export class ApolloPeopleEnrichmentService implements PeopleEnrichmentProvider {
  constructor(private readonly options: ApolloPeopleEnrichmentServiceOptions) {}

  describeEnrichment(): DiscoveryProviderDescriptor {
    const client = this.options.client.describe();
    return {
      id: client.id,
      displayName: `Apollo people enrichment (API ${client.version})`,
      version: client.version,
      // The batch ceiling rather than the search page size: for this port,
      // "how many per request" is what a caller would want to know.
      maxPageSize: APOLLO_BULK_MATCH_MAX,
      available: client.available,
    };
  }

  async enrichPeople(
    people: readonly EnrichPersonInput[],
    options: EnrichPeopleOptions,
  ): Promise<readonly EnrichedProspect[]> {
    if (people.length === 0) return [];

    const prospects: EnrichedProspect[] = [];
    const batches = chunk(people, APOLLO_BULK_MATCH_MAX);
    /** Set once an account-level failure makes further requests pointless. */
    let abort: { status: ProspectEnrichmentStatus; detail: string } | undefined;

    for (const batch of batches) {
      const aborted = abort;
      if (aborted) {
        prospects.push(...batch.map((person) => this.failed(person, aborted)));
        continue;
      }

      try {
        prospects.push(...(await this.enrichBatch(batch, options)));
      } catch (error) {
        const failure = { status: statusForError(error), detail: detailForError(error) };
        if (isAccountLevelFailure(error)) abort = failure;
        prospects.push(...batch.map((person) => this.failed(person, failure)));
      }
    }

    return prospects;
  }

  /**
   * One bulk request, joined back to its inputs by position.
   *
   * Apollo's `matches` array is positional - one entry per requested record,
   * null where nothing matched - so index is the join. A response that is
   * *shorter* than the request is treated as "no match" for the missing tail
   * rather than being trusted to line up: attributing one person's contact
   * details to another is the single worst thing this stage could do, and a
   * missing no-match record costs nothing but a retry.
   */
  private async enrichBatch(
    batch: readonly EnrichPersonInput[],
    options: EnrichPeopleOptions,
  ): Promise<EnrichedProspect[]> {
    const response = await this.options.client.bulkMatchPeople(
      batch.map((person) => this.matchDetails(person)),
      { revealPhoneNumbers: options.revealPhoneNumbers, pollOnly: true },
    );

    const enrichedAt = new Date().toISOString();
    return batch.map((person, index) => {
      const match: ApolloEnrichedPersonDto | null | undefined = response.matches[index];
      if (!match) {
        return unenrichedProspect({
          personRef: person.personRef,
          status: 'NO_MATCH',
          detail: 'The contact data provider could not confidently identify this person.',
          enrichedAt,
          ...(person.identity.externalPersonId !== undefined
            ? { externalPersonId: person.identity.externalPersonId }
            : {}),
        });
      }
      return normalizeApolloEnrichedPerson(match, {
        personRef: person.personRef,
        revealPhoneNumbers: options.revealPhoneNumbers,
        enrichedAt,
      });
    });
  }

  /**
   * The identity, in Apollo's request vocabulary.
   *
   * Which fields are sent is decided upstream by `enrichmentIdentityFor`, which
   * owns the rule about what counts as enough to identify a human. This only
   * translates - so the "never ask a provider to guess who we meant" rule lives
   * in one place rather than once per adapter.
   */
  private matchDetails(person: EnrichPersonInput): ApolloPersonMatchDetails {
    const { identity } = person;
    return {
      ...(identity.externalPersonId !== undefined ? { id: identity.externalPersonId } : {}),
      ...(identity.linkedinUrl !== undefined ? { linkedinUrl: identity.linkedinUrl } : {}),
      ...(identity.firstName !== undefined ? { firstName: identity.firstName } : {}),
      ...(identity.lastName !== undefined ? { lastName: identity.lastName } : {}),
      ...(identity.name !== undefined ? { name: identity.name } : {}),
      ...(identity.domain !== undefined ? { domain: identity.domain } : {}),
    };
  }

  private failed(
    person: EnrichPersonInput,
    failure: { status: ProspectEnrichmentStatus; detail: string },
  ): EnrichedProspect {
    return unenrichedProspect({
      personRef: person.personRef,
      status: failure.status,
      detail: failure.detail,
      ...(person.identity.externalPersonId !== undefined
        ? { externalPersonId: person.identity.externalPersonId }
        : {}),
    });
  }
}
