import type { EnrichedProspect, EnrichmentIdentity } from './enrichment.js';
import type { DiscoveryProviderDescriptor } from './provider.js';

/**
 * `PeopleEnrichmentProvider` - the seam a *contact enrichment* provider plugs
 * into.
 *
 * A third sibling of `CompanyDiscoveryProvider` and `PeopleDiscoveryProvider`,
 * separate from both for the reason those two are separate from each other: it
 * answers a different question, against a different endpoint, with a different
 * billing model. Search asks "who matches?" and is billed per page; enrichment
 * asks "how do I reach this specific person?" and is billed per person. One
 * adapter class may implement all three - Apollo does - but a vendor that sells
 * only search implements only the port it can honour rather than stubbing one
 * it cannot.
 *
 *   survivor -> identity -> provider match endpoint -> EnrichedProspect
 *
 * The constraints that make this port safe to depend on:
 *
 *  - **An adapter returns normalized prospects, never its own DTOs.** Nothing
 *    above this line may name a provider field.
 *  - **An adapter never invents contact data.** A provider that returns no
 *    email yields no email. Pattern-generating an address, scraping a profile
 *    or calling a second service to fill a gap are all out of contract.
 *  - **An adapter never throws for one person's failure.** Per-candidate
 *    outcomes - no match, plan refusal, a malformed record - are *statuses on
 *    that prospect*. The method rejects only when the whole call failed and no
 *    per-person answer exists, which callers handle by marking the batch.
 *  - **An adapter never scores or ranks.** `matchConfidence` is identification
 *    confidence and nothing else.
 */

export interface EnrichPeopleOptions {
  /**
   * Whether to ask the provider to reveal phone numbers.
   *
   * Explicit, and defaulted off by the caller, because phone reveal is the
   * expensive half of enrichment at every provider that sells it: it consumes a
   * separate credit type, and at most it is resolved asynchronously so the
   * numbers are not in the response that requested them. A run that did not ask
   * reports `phoneState: NOT_REQUESTED` rather than an empty list that reads
   * like an answer.
   */
  readonly revealPhoneNumbers: boolean;
}

/**
 * One candidate to enrich, as the port sees it.
 *
 * The identity is resolved by the caller through `enrichmentIdentityFor`, not
 * by the adapter, so the rule that decides when an identity is too weak to act
 * on lives in one place and is the same for every provider.
 */
export interface EnrichPersonInput {
  /** `PersonCandidate.rawSourceRef`; how the result is joined back. */
  readonly personRef: string;
  readonly identity: EnrichmentIdentity;
}

export interface PeopleEnrichmentProvider {
  describeEnrichment(): DiscoveryProviderDescriptor;

  /**
   * Enriches a set of people, in as few provider calls as the provider allows.
   *
   * Batching is the *adapter's* decision, because the batch size is a provider
   * fact - Apollo's bulk endpoint takes ten - and a caller that had to know it
   * would be encoding one vendor's limit into the pipeline.
   *
   * Returns one `EnrichedProspect` per input, in any order, joined on
   * `personRef`. An input the provider could not match still comes back, with
   * the status that says so.
   */
  enrichPeople(
    people: readonly EnrichPersonInput[],
    options: EnrichPeopleOptions,
  ): Promise<readonly EnrichedProspect[]>;
}

/**
 * The enrichment provider selected by `DISCOVERY_PROVIDER=none`.
 *
 * Unlike the null *search* provider, this one does not reject. The difference
 * is what the caller can do about it: a search with no provider has no result
 * at all and must fail loudly, while enrichment with no provider still leaves
 * every candidate exactly as discovery found them - which is a usable list.
 * So it resolves with `UNAVAILABLE` on every person, which is both true and
 * the same shape a plan restriction produces.
 */
export class NullPeopleEnrichmentProvider implements PeopleEnrichmentProvider {
  describeEnrichment(): DiscoveryProviderDescriptor {
    return {
      id: 'none',
      displayName: 'No contact enrichment provider configured',
      version: '0.0.0',
      maxPageSize: 0,
      available: false,
    };
  }

  enrichPeople(people: readonly EnrichPersonInput[]): Promise<readonly EnrichedProspect[]> {
    return Promise.resolve(
      people.map((person) => ({
        personRef: person.personRef,
        provider: 'none',
        person: {},
        company: {},
        contact: { phoneNumbers: [], phoneState: 'NOT_REQUESTED' as const },
        enrichment: {
          status: 'UNAVAILABLE' as const,
          provider: 'none',
          detail:
            'No contact enrichment provider is configured, so no contact details were retrieved.',
        },
        reachability: { hasLinkedIn: false, hasWorkEmail: false, hasPhone: false, channels: [] },
      })),
    );
  }
}
