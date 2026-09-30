import type {
  CandidateProcessingResult,
  CandidateRejectionReason,
  ProcessedCandidate,
  ReachabilityCounts,
} from '@pursuit/shared';
import { Badge } from '../../components/ui/index.js';
import { EnrichmentSummary, type ChannelFilter } from './ProspectContact.js';

/**
 * The deterministic stage after discovery, as a reader sees it.
 *
 * Its whole job is to keep three things visibly separate, because conflating
 * them is how a prospecting tool starts lying to the person using it:
 *
 *  1. **what the data provider returned** - retrieved fact;
 *  2. **what survived the ICP's hard criteria** - a deterministic verdict;
 *  3. **what was excluded, and why** - the cold pool.
 *
 * A survivor is *not* labelled "good", "qualified for outreach" or given a
 * score, here or anywhere else in this slice. It passed suppression, the
 * supported hard criteria and a reachability sanity check. The copy says
 * exactly that, because the moment the UI implies more, the number stops
 * meaning anything.
 */

/**
 * Reader-facing wording per structured reason.
 *
 * The code is the contract and this is the sentence. Kept as an exhaustive
 * `Record` so a reason added to the contract fails the build here rather than
 * rendering as a raw enum in front of a user.
 */
const REJECTION_LABELS: Record<CandidateRejectionReason, string> = {
  DUPLICATE: 'Duplicate',
  SUPPRESSED: 'Suppressed',
  HARD_LOCATION_MISMATCH: 'Location',
  HARD_INDUSTRY_MISMATCH: 'Industry',
  HARD_EMPLOYEE_RANGE_MISMATCH: 'Company size',
  HARD_TECHNOLOGY_MISMATCH: 'Technology',
  HARD_SENIORITY_MISMATCH: 'Seniority',
  HARD_DEPARTMENT_MISMATCH: 'Department',
  HARD_RULE_MISMATCH: 'Must-have rule',
  HARD_EXCLUSION_MATCH: 'Exclusion rule',
  UNREACHABLE: 'Not reachable',
};

export function rejectionLabel(reason: CandidateRejectionReason): string {
  return REJECTION_LABELS[reason];
}

/** Which candidates a reader is looking at. */
export type ProspectView = 'qualified' | 'cold' | 'all';

/**
 * Outcome per person, keyed the way the list already keys its rows.
 *
 * The processing block references people by `rawSourceRef` rather than
 * repeating them, so this is the join. A person with no entry - which should
 * not happen, and would mean the two halves of the response disagree - simply
 * renders without an outcome badge rather than crashing the list.
 */
export function outcomeIndex(
  processing: CandidateProcessingResult,
): ReadonlyMap<string, ProcessedCandidate> {
  return new Map(
    [...processing.survivors, ...processing.rejected].map((candidate) => [
      candidate.personRef,
      candidate,
    ]),
  );
}

/** The one-word verdict on a person's row. */
export function OutcomeBadge({ outcome }: { outcome: ProcessedCandidate | undefined }) {
  if (!outcome) return null;
  if (outcome.state === 'SURVIVOR') return <Badge tone="positive">Passed hard filters</Badge>;

  return (
    <>
      {outcome.rejections.map((rejection, index) => (
        <Badge
          key={`${rejection.reason}-${String(index)}`}
          tone={rejection.reason === 'SUPPRESSED' ? 'caution' : 'critical'}
        >
          {REJECTION_LABELS[rejection.reason]}
        </Badge>
      ))}
    </>
  );
}

/**
 * Why a candidate was excluded, in the words the backend produced.
 *
 * Rendered verbatim rather than re-derived in the browser: the detail names the
 * criteria value and the candidate value that disagreed, and only the stage
 * that compared them can say which they were. Nothing here re-decides anything.
 */
export function RejectionReasons({ outcome }: { outcome: ProcessedCandidate | undefined }) {
  if (!outcome || outcome.rejections.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2 text-xs leading-5 text-ink-muted">
      {outcome.rejections.map((rejection, index) => (
        <li key={`${rejection.reason}-${String(index)}`}>{rejection.detail}</li>
      ))}
    </ul>
  );
}

function Tab({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={
        active
          ? 'rounded-control border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-ink'
          : 'rounded-control border border-transparent px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink'
      }
      onClick={onClick}
      type="button"
    >
      {label} <span className="pu-numeric">{new Intl.NumberFormat().format(count)}</span>
    </button>
  );
}

export interface ProcessingSummaryProps {
  processing: CandidateProcessingResult;
  view: ProspectView;
  onView: (view: ProspectView) => void;
  /** Which contact channel the list is narrowed to. */
  channel: ChannelFilter;
  onChannel: (channel: ChannelFilter) => void;
}

/**
 * Contact-channel filters.
 *
 * Deliberately a separate row from the outcome tabs above, and deliberately
 * worded as channels rather than as quality. The two answer different
 * questions - "did this person pass the ICP's hard criteria?" and "how can I
 * reach them?" - and a combined control would imply one is a refinement of the
 * other.
 *
 * There is no "best prospects" or "high quality" filter here, and there will
 * not be one at this stage: nothing in this pipeline scores or ranks a person,
 * so a tab promising the top ones would have to invent an ordering. Ranking is
 * a later stage with its own evidence behind it.
 *
 * Hidden entirely when no enrichment ran: filtering by a channel nobody was
 * checked for would return an empty list for every option but "All", which
 * reads as "these people have no contact details" rather than "we did not look".
 */
function ChannelFilters({
  counts,
  channel,
  onChannel,
}: {
  counts: ReachabilityCounts;
  channel: ChannelFilter;
  onChannel: (channel: ChannelFilter) => void;
}) {
  const options: { id: ChannelFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'linkedin', label: 'LinkedIn', count: counts.linkedin },
    { id: 'email', label: 'Email', count: counts.email },
    { id: 'phone', label: 'Phone', count: counts.phone },
  ];

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-xs text-ink-muted">Contact channel</span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((option) => (
          <button
            aria-pressed={channel === option.id}
            className={
              channel === option.id
                ? 'rounded-control border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-ink'
                : 'rounded-control border border-transparent px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink'
            }
            key={option.id}
            onClick={() => onChannel(option.id)}
            type="button"
          >
            {option.label}
            {option.count === undefined ? null : (
              <span className="pu-numeric"> {new Intl.NumberFormat().format(option.count)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The funnel, and the three honest caveats that go with it.
 *
 * The counts are counts. The two notes below them are the parts that stop the
 * counts being misread: criteria that could not be evaluated (so a reader never
 * assumes a requirement was enforced when no source exists for it), and whether
 * the run was recorded (so nobody assumes an audit row exists when the write
 * failed). Both are hidden only when there is genuinely nothing to say.
 */
export function ProcessingSummary({
  processing,
  view,
  onView,
  channel,
  onChannel,
}: ProcessingSummaryProps) {
  const { counts, unsupportedHardCriteria, persistence, enrichment } = processing;

  return (
    <div className="border-t border-line bg-canvas-deep/40 px-5 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <Tab
            active={view === 'qualified'}
            count={counts.survivors}
            label="Passed hard filters"
            onClick={() => onView('qualified')}
          />
          <Tab
            active={view === 'cold'}
            count={counts.cold}
            label="Cold pool"
            onClick={() => onView('cold')}
          />
          <Tab
            active={view === 'all'}
            count={counts.received}
            label="All discovered"
            onClick={() => onView('all')}
          />
        </div>
        <p className="text-xs text-ink-muted">
          <span className="pu-numeric">{counts.companiesResolved}</span>{' '}
          {counts.companiesResolved === 1 ? 'company' : 'companies'} resolved
          {counts.suppressed > 0 ? ` · ${String(counts.suppressed)} suppressed` : ''}
          {counts.hardFilterRejected > 0
            ? ` · ${String(counts.hardFilterRejected)} filtered out`
            : ''}
          {counts.unreachable > 0 ? ` · ${String(counts.unreachable)} not reachable` : ''}
          {counts.duplicatesRemoved > 0
            ? ` · ${String(counts.duplicatesRemoved)} duplicate${counts.duplicatesRemoved === 1 ? '' : 's'}`
            : ''}
        </p>
      </div>

      {enrichment ? (
        <ChannelFilters channel={channel} counts={enrichment.reachability} onChannel={onChannel} />
      ) : null}

      <EnrichmentSummary enrichment={enrichment} />

      {/* Never hidden when present. A requirement that was not applied must not
          be indistinguishable from one that everybody satisfied. */}
      {unsupportedHardCriteria && unsupportedHardCriteria.length > 0 ? (
        <p className="mt-2 text-xs leading-5 text-ink-faint">
          Not applied, because nothing in the system reports these yet:{' '}
          {unsupportedHardCriteria.join('; ')}.
        </p>
      ) : null}

      {persistence.persisted ? null : (
        <p className="mt-2 text-xs leading-5 text-ink-faint">
          {persistence.detail ?? 'This run was not recorded.'}
        </p>
      )}
    </div>
  );
}
