import type {
  EnrichedProspect,
  ProspectEnrichmentResult,
  ProspectEnrichmentStatus,
  ReachabilityChannel,
} from '@pursuit/shared';
import { Badge } from '../../components/ui/index.js';

/**
 * Contact details, as a reader sees them.
 *
 * The rules this half of the UI exists to hold:
 *
 *  1. **A missing channel says it is missing.** "Not available" - never a dash,
 *    never a greyed-out placeholder that looks like a redacted value, and never
 *    `undefined`, `null` or `[object Object]`. A reader has to be able to tell
 *    "the provider holds no number" from "the number is there and I cannot see
 *    it", because only one of those is worth chasing.
 *  2. **Nothing is constructed.** No LinkedIn URL built from a name, no email
 *    guessed from a domain. Every value below was returned by the provider.
 *  3. **Channels are independent, never a grade.** A prospect with LinkedIn
 *    only is fully reachable through LinkedIn. There is no "weak contact", no
 *    completeness percentage and no ordering by how many channels someone has.
 *  4. **Enrichment status is shown, not hidden.** A person the provider could
 *    not identify, and one whose enrichment the account's plan refused, look
 *    identical in the data - both have no contact details - and they call for
 *    opposite responses.
 */

/**
 * Reader-facing wording per status.
 *
 * An exhaustive `Record`, so a status added to the contract fails the build
 * here rather than rendering as a raw enum in front of a user.
 */
const STATUS_LABELS: Record<ProspectEnrichmentStatus, string> = {
  NOT_REQUESTED: 'Not enriched',
  ENRICHED: 'Enriched',
  PARTIAL: 'No contact channels',
  NO_MATCH: 'No match',
  UNAVAILABLE: 'Enrichment unavailable',
  FAILED: 'Enrichment failed',
};

const STATUS_TONES: Record<ProspectEnrichmentStatus, 'positive' | 'caution' | 'critical' | 'outline'> =
  {
    NOT_REQUESTED: 'outline',
    ENRICHED: 'positive',
    // Caution rather than critical: the provider answered, and the finding is
    // about the person's contactability rather than about anything being wrong.
    PARTIAL: 'caution',
    NO_MATCH: 'caution',
    UNAVAILABLE: 'critical',
    FAILED: 'critical',
  };

export function enrichmentStatusLabel(status: ProspectEnrichmentStatus): string {
  return STATUS_LABELS[status];
}

/** `high` -> `High`. Never a number, and never recomputed in the browser. */
function titleCase(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim();
  if (words.length === 0) return value;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** Which contact channels a reader is filtering on. */
export type ChannelFilter = 'all' | 'linkedin' | 'email' | 'phone';

/**
 * Whether a prospect carries the channel being filtered on.
 *
 * Exported so the list and the filter counts are answered by one function - a
 * tab reading "Email 12" above a list of 9 rows is the kind of disagreement
 * that makes a reader stop trusting every other number on the screen.
 */
export function matchesChannel(
  prospect: EnrichedProspect | undefined,
  filter: ChannelFilter,
): boolean {
  if (filter === 'all') return true;
  if (!prospect) return false;
  if (filter === 'linkedin') return prospect.reachability.hasLinkedIn;
  if (filter === 'email') return prospect.reachability.hasWorkEmail;
  return prospect.reachability.hasPhone;
}

/** Prospect per person, keyed the way the list already keys its rows. */
export function prospectIndex(
  enrichment: ProspectEnrichmentResult | undefined,
): ReadonlyMap<string, EnrichedProspect> {
  if (!enrichment) return new Map();
  return new Map(enrichment.prospects.map((prospect) => [prospect.personRef, prospect]));
}

/** One labelled row. `value` absent renders the honest empty state. */
function ContactRow({
  label,
  value,
  empty = 'Not available',
}: {
  label: string;
  value: React.ReactNode | null;
  empty?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[68px] shrink-0 text-xs text-ink-muted">{label}</span>
      {value === null ? (
        <span className="text-xs text-ink-faint">{empty}</span>
      ) : (
        <span className="min-w-0 break-words text-[13px] leading-5 text-ink">{value}</span>
      )}
    </div>
  );
}

/**
 * What to say in the phone row, per state.
 *
 * Four states rather than "number or nothing", because a reveal that is still
 * running and a provider that holds no number render identically otherwise -
 * and one of the two is worth coming back for.
 */
function phoneEmptyCopy(prospect: EnrichedProspect): string {
  switch (prospect.contact.phoneState) {
    case 'PENDING':
      return 'Phone enrichment pending';
    case 'NOT_REQUESTED':
      return 'Not requested';
    default:
      return 'Not available';
  }
}

export interface ProspectContactProps {
  prospect: EnrichedProspect | undefined;
}

/**
 * The contact block on one prospect row.
 *
 * Renders nothing at all when the run had no enrichment stage - an empty
 * "LinkedIn: Not available" block under every person would report the absence
 * of a *stage* as a fact about each *person*, which is exactly the lie this
 * slice exists to avoid.
 */
export function ProspectContact({ prospect }: ProspectContactProps) {
  if (!prospect) return null;

  const { person, contact, enrichment, reachability } = prospect;
  const phones = contact.phoneNumbers;

  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <div className="flex flex-col gap-1">
        <ContactRow
          label="LinkedIn"
          value={
            person.linkedinUrl ? (
              <a
                className="underline decoration-line underline-offset-2 transition-colors hover:text-ink-muted"
                href={person.linkedinUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                View profile
              </a>
            ) : null
          }
        />
        <ContactRow
          label="Email"
          value={
            contact.workEmail ? (
              <>
                {/* A mailto, matching how the company domain is already linked
                    elsewhere on this card. The address is shown in full: a
                    truncated one cannot be copied, which is the main thing
                    anybody does with it. */}
                <a
                  className="underline decoration-line underline-offset-2 transition-colors hover:text-ink-muted"
                  href={`mailto:${contact.workEmail}`}
                >
                  {contact.workEmail}
                </a>
                {contact.emailStatus ? (
                  <span className="ml-1.5 text-xs text-ink-muted">
                    {titleCase(contact.emailStatus)}
                  </span>
                ) : null}
              </>
            ) : null
          }
        />
        <ContactRow
          empty={phoneEmptyCopy(prospect)}
          label="Phone"
          value={
            phones.length > 0 ? (
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {phones.map((phone, index) => (
                  <span key={`${phone.number}-${String(index)}`}>
                    <span className="pu-numeric">{phone.number}</span>
                    {/* The provider's own label, shown as sent. Nothing here
                        maps `work_hq` onto a tidier word we made up. */}
                    {phone.type ? (
                      <span className="ml-1 text-xs text-ink-muted">{titleCase(phone.type)}</span>
                    ) : null}
                  </span>
                ))}
              </span>
            ) : null
          }
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={STATUS_TONES[enrichment.status]}>{STATUS_LABELS[enrichment.status]}</Badge>
        {/* Identification confidence, labelled as such. It says the provider is
            sure *who* this is - never that they are a good prospect. */}
        {enrichment.matchConfidence ? (
          <span className="text-xs text-ink-muted">
            Match: {titleCase(enrichment.matchConfidence)}
          </span>
        ) : null}
        {reachability.channels.length > 0 ? (
          <span className="text-xs text-ink-faint">
            Reachable on {reachability.channels.map(channelLabel).join(', ')}
          </span>
        ) : null}
      </div>

      {/* Why there is no contact data, in the words the backend produced.
          Rendered verbatim: only the stage that called the provider knows
          whether it was a plan refusal, a no-match or a budget limit. */}
      {enrichment.status !== 'ENRICHED' && enrichment.detail ? (
        <p className="mt-1 text-xs leading-5 text-ink-muted">{enrichment.detail}</p>
      ) : null}
    </div>
  );
}

function channelLabel(channel: ReachabilityChannel): string {
  if (channel === 'LINKEDIN') return 'LinkedIn';
  if (channel === 'EMAIL') return 'email';
  return 'phone';
}

/**
 * The enrichment funnel, under the processing one.
 *
 * Counts and nothing else - no completeness score, no "quality" band, no
 * ranking. The two lines below answer different questions: how many lookups
 * landed, and how many people can actually be reached on each channel. The
 * second set overlaps by design, because one person can be on all three.
 */
export function EnrichmentSummary({
  enrichment,
}: {
  enrichment: ProspectEnrichmentResult | undefined;
}) {
  if (!enrichment) return null;
  const { counts, reachability } = enrichment;

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
      <p className="text-xs text-ink-muted">
        Contact enrichment: <span className="pu-numeric">{counts.enriched}</span> enriched
        {counts.partial > 0 ? ` · ${String(counts.partial)} with no contact channel` : ''}
        {counts.noMatch > 0 ? ` · ${String(counts.noMatch)} no match` : ''}
        {counts.unavailable > 0 ? ` · ${String(counts.unavailable)} unavailable` : ''}
        {counts.failed > 0 ? ` · ${String(counts.failed)} failed` : ''}
        {counts.skipped > 0 ? ` · ${String(counts.skipped)} not requested` : ''}
      </p>
      <p className="text-xs text-ink-muted">
        Reachable on LinkedIn <span className="pu-numeric">{reachability.linkedin}</span> · email{' '}
        <span className="pu-numeric">{reachability.email}</span> · phone{' '}
        <span className="pu-numeric">{reachability.phone}</span>
        {/* Never hidden. "Nobody has a phone number" and "we did not ask for
            phone numbers" are identical result sets with opposite meanings. */}
        {enrichment.phoneRevealRequested ? '' : ' (phone reveal not requested for this run)'}
      </p>
      {enrichment.detail ? (
        <p className="text-xs leading-5 text-ink-faint">{enrichment.detail}</p>
      ) : null}
    </div>
  );
}
