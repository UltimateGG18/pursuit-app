import { useEffect, useMemo, useState } from 'react';
import type {
  EnrichedProspect,
  PersonCandidate,
  ProcessedCandidate,
  ProspectRunDto,
} from '@pursuit/shared';
import { Alert, Badge, Button, EmptyState, Skeleton } from '../../components/ui/index.js';
import type { ClientError } from '../../api/client.js';
import type { UseProspectSearch } from './useProspectSearch.js';
import {
  OutcomeBadge,
  ProcessingSummary,
  RejectionReasons,
  outcomeIndex,
  type ProspectView,
} from './ProspectProcessing.js';
import {
  ProspectContact,
  matchesChannel,
  prospectIndex,
  type ChannelFilter,
} from './ProspectContact.js';

/**
 * Prospect results - the step after the analysis.
 *
 * The panel owns the search lifecycle (ready, searching, found, empty, failed)
 * and the rendering of one page of people. It is visually a sibling of
 * `IcpAnalysisPanel` on purpose: the analysis is derived reasoning and this is
 * retrieved fact, and both are clearly distinct from the criteria form a person
 * authored.
 *
 * Nothing here knows which data provider answered. The panel renders
 * `PersonCandidate`, the provider-neutral contract, so swapping the provider
 * changes no line in this file.
 *
 * It renders two things that are deliberately not merged: the people discovery
 * returned, and what the deterministic processing stage decided about each of
 * them. The list is never silently narrowed to the survivors - a reader has to
 * be able to see what was excluded and why, or a too-narrow ICP looks
 * identical to a market with no prospects in it. `ProspectProcessing` owns
 * that half; see it for why a survivor is never called "qualified" here.
 */

export interface ProspectResultsProps {
  icpId: string;
  icpName: string;
  /** Search state owned by the page, so the header and this panel share a run. */
  prospects: UseProspectSearch;
  /** True when a readable analysis is widening the title filter. */
  analysisApplied: boolean;
  /**
   * Set when the page header already offers the search action. The panel then
   * offers none of its own, so a screen never carries two primary buttons that
   * do the same thing - the header's is sticky and stays in view anyway.
   */
  hideRunAction?: boolean;
}

/**
 * Error copy keyed by API error code.
 *
 * Provider-neutral, exactly like the analysis panel's: the frontend does not
 * know which data provider is configured, holds no credential, and must not
 * name one. Configuration and credential failures are described by the backend
 * in terms an operator can act on, so those messages are shown as written.
 */
function errorCopy(error: ClientError): { title: string; body: string } {
  switch (error.code) {
    case 'DISCOVERY_PROVIDER_UNAVAILABLE':
      // Covers a missing key, a rejected key and an unreachable provider. The
      // backend's message tells the three apart; nothing hardcoded here could.
      return { title: 'Prospect search is unavailable', body: error.message };
    case 'DISCOVERY_PROVIDER_RATE_LIMITED':
      return { title: 'Prospect search is rate limited', body: error.message };
    case 'DISCOVERY_PROVIDER_TIMEOUT':
      return {
        title: 'The prospect search timed out',
        body: 'The data provider did not respond in time. Try again in a moment.',
      };
    case 'DISCOVERY_PROVIDER_INVALID_RESPONSE':
      return {
        title: 'The data provider returned an unusable result',
        body: 'The response did not match the expected contract, so nothing was shown. Try again.',
      };
    case 'NOT_FOUND':
      return { title: 'This ICP could not be found', body: error.message };
    case 'NETWORK_ERROR':
      return { title: 'Could not reach the API', body: error.message };
    default:
      return { title: 'The prospect search failed', body: error.message };
  }
}

/** `verified` -> `Verified`, and nothing invented for an unknown value. */
function humanize(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim();
  if (words.length === 0) return value;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function EmployeeCount({ count }: { count: number }) {
  return (
    <span className="pu-numeric">
      {new Intl.NumberFormat().format(count)} employee{count === 1 ? '' : 's'}
    </span>
  );
}

/**
 * One person.
 *
 * Every field below is rendered only when the provider actually reported it.
 * Nothing is defaulted to a dash or to "Unknown": the contract distinguishes
 * "not reported" from "reported as empty", and a row that quietly invents
 * structure would make a thin record look like a complete one.
 */
function ProspectCard({
  person,
  outcome,
  prospect,
}: {
  person: PersonCandidate;
  outcome: ProcessedCandidate | undefined;
  /** Contact details, when the enrichment stage ran for this person. */
  prospect: EnrichedProspect | undefined;
}) {
  const company = person.company;

  return (
    <li className="rounded-control border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-semibold leading-5 text-ink">{person.name}</p>
            {person.seniority ? <Badge tone="outline">{humanize(person.seniority)}</Badge> : null}
            {person.emailStatus === 'verified' ? (
              <Badge tone="positive">Email verified</Badge>
            ) : null}
            <OutcomeBadge outcome={outcome} />
          </div>
          {person.title ? (
            <p className="mt-0.5 text-[13px] leading-5 text-ink-soft">{person.title}</p>
          ) : null}
        </div>

        {person.linkedinUrl ? (
          <a
            className="shrink-0 rounded-control border border-line px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink"
            href={person.linkedinUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            LinkedIn
          </a>
        ) : null}
      </div>

      {company ? (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-ink">
            <span className="font-medium">{company.name ?? company.domain ?? 'Company'}</span>
            {company.domain ? (
              <a
                className="text-xs text-ink-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
                href={company.website ?? `https://${company.domain}`}
                rel="noreferrer noopener"
                target="_blank"
              >
                {company.domain}
              </a>
            ) : null}
          </div>
          {/* Firmographic context, as a single wrapped line. Separated by dots
              rather than laid out in a grid, because which of these the
              provider reported varies per person and an empty grid cell reads
              as missing data where a shorter line simply is the data. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
            {[
              company.industry ? <span key="industry">{humanize(company.industry)}</span> : null,
              company.employeeCount !== undefined ? (
                <EmployeeCount count={company.employeeCount} key="employees" />
              ) : null,
              person.location ?? company.location ? (
                <span key="location">{person.location ?? company.location}</span>
              ) : null,
              person.department ? <span key="department">{humanize(person.department)}</span> : null,
            ]
              .filter((part) => part !== null)
              .map((part, index) => (
                <span className="flex items-center gap-1.5" key={index}>
                  {index > 0 ? (
                    <span aria-hidden className="text-ink-faint">
                      &middot;
                    </span>
                  ) : null}
                  {part}
                </span>
              ))}
          </div>
        </div>
      ) : person.location ? (
        <p className="mt-2 text-xs text-ink-muted">{person.location}</p>
      ) : null}

      <ProspectContact prospect={prospect} />
      <RejectionReasons outcome={outcome} />
    </li>
  );
}

/**
 * Page n of m, with the two moves a person can make from here.
 *
 * The totals are optional, because the data provider does not always report
 * them. When they are missing the pager says what it knows - which rows these
 * are, and which page - instead of printing a confident "of 0", and `hasMore`
 * still drives Next. A count the provider never gave is not shown at all.
 */
function Pager({
  run,
  busy,
  onGo,
}: {
  run: ProspectRunDto;
  busy: boolean;
  onGo: (page: number) => void;
}) {
  const { page, totalPages, totalEntries, perPage, hasMore } = run.pagination;
  const first = (page - 1) * perPage + 1;
  const last = first + run.people.length - 1;
  const format = (value: number) => new Intl.NumberFormat().format(value);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
      <p className="text-xs text-ink-muted">
        Showing{' '}
        <span className="pu-numeric">
          {first}&ndash;{last}
        </span>
        {totalEntries === undefined ? null : (
          <>
            {' '}
            of <span className="pu-numeric">{format(totalEntries)}</span> matching{' '}
            {totalEntries === 1 ? 'person' : 'people'}
          </>
        )}{' '}
        &middot; page{' '}
        <span className="pu-numeric">
          {page}
          {totalPages === undefined ? '' : ` of ${format(totalPages)}`}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || page <= 1}
          onClick={() => onGo(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !hasMore}
          onClick={() => onGo(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/** Provenance strip: which provider, which query contract, how long. */
function ProspectMeta({ run }: { run: ProspectRunDto }) {
  const { meta } = run;
  return (
    <div className="border-t border-line px-5 py-3 sm:px-6">
      <p className="text-xs text-ink-muted">
        {meta.provider} &middot; {meta.queryVersion} &middot; ICP v{meta.icpVersion}
        {meta.analysisId ? ' · analysis applied' : ''} &middot;{' '}
        {(meta.durationMs / 1000).toFixed(1)}s
        {meta.duplicatesRemoved > 0
          ? ` · ${String(meta.duplicatesRemoved)} duplicate${meta.duplicatesRemoved === 1 ? '' : 's'} merged`
          : ''}
      </p>
      {/* Never hidden. A caller who asked for procurement leads has to be able
          to tell "the provider cannot filter on that" from "there are none". */}
      {meta.unsupportedFilters && meta.unsupportedFilters.length > 0 ? (
        <p className="mt-1 text-xs text-ink-faint">
          Not filtered by the data provider: {meta.unsupportedFilters.join('; ')}. These criteria
          still apply to your ICP and are enforced later in the pipeline.
        </p>
      ) : null}
    </div>
  );
}

export function ProspectResults({
  icpId,
  icpName,
  prospects,
  analysisApplied,
  hideRunAction = false,
}: ProspectResultsProps) {
  const { status, run, error, searched, search } = prospects;
  const searching = status === 'searching';
  const found = run !== null && run.people.length > 0;

  /**
   * Which slice of the page is on screen.
   *
   * Defaults to the survivors, because they are what a person is here for, and
   * resets whenever a new run arrives - a "cold pool" tab left selected across
   * a re-search would show an empty list under a heading that promises results.
   */
  const [view, setView] = useState<ProspectView>('qualified');
  /**
   * Which contact channel the list is narrowed to.
   *
   * A *filter*, not a ranking, and the wording keeps it that way: there is no
   * "best prospects" tab here, because this stage performs no scoring and a tab
   * called that would be inventing one. Reset alongside the view for the same
   * reason - a channel filter left selected across a re-search would show an
   * empty list under a heading that promises results.
   */
  const [channel, setChannel] = useState<ChannelFilter>('all');
  useEffect(() => {
    setView('qualified');
    setChannel('all');
  }, [run]);

  const outcomes = useMemo(
    () => (run === null ? new Map<string, ProcessedCandidate>() : outcomeIndex(run.processing)),
    [run],
  );

  /** Contact details per person, joined on the same key the rows are keyed by. */
  const contacts = useMemo(
    () =>
      run === null ? new Map<string, EnrichedProspect>() : prospectIndex(run.processing.enrichment),
    [run],
  );

  const visible = useMemo(() => {
    if (run === null) return [];
    return run.people.filter((person) => {
      const outcome = outcomes.get(person.rawSourceRef);
      // A person the processing block does not mention is shown in every view
      // rather than hidden from all of them: an unexplained disappearance is
      // the worst way for the two halves of a response to disagree.
      const inView =
        view === 'all' || !outcome
          ? true
          : view === 'qualified'
            ? outcome.state === 'SURVIVOR'
            : outcome.state !== 'SURVIVOR';
      return inView && matchesChannel(contacts.get(person.rawSourceRef), channel);
    });
  }, [channel, contacts, outcomes, run, view]);

  return (
    <section
      aria-labelledby="pursuit-prospects-title"
      className="rounded-card border border-line bg-surface shadow-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className="text-[15px] font-semibold leading-6 text-ink"
              id="pursuit-prospects-title"
            >
              Matching prospects
            </h3>
            <Badge tone="brand" uppercase>
              Live provider data
            </Badge>
            {analysisApplied ? <Badge tone="outline">Analysis applied</Badge> : null}
          </div>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
            People matching &quot;{icpName}&quot;, retrieved from the configured data provider using
            the ICP&apos;s target buyer, geography and company profile
            {analysisApplied ? ', widened by the buyer roles the analysis identified' : ''}, then
            checked against this ICP&apos;s suppression list and hard criteria. Passing those is not
            a score or a ranking - it means nothing excluded this person.
          </p>
        </div>

        {hideRunAction ? null : (
          <Button
            variant="primary"
            size="sm"
            loading={searching}
            disabled={searching}
            onClick={() => void search()}
          >
            {searching ? 'Searching…' : searched ? 'Search again' : 'Find matching leads'}
          </Button>
        )}
      </header>

      <div className="border-t border-line">
        {searching ? (
          <div className="flex flex-col gap-3 px-5 py-4 sm:px-6">
            {/* An honest wait, not a fake percentage: the backend reports no
                progress. The skeletons below show where results will land, so
                the page stays readable instead of collapsing to a spinner. */}
            <Alert tone="info" role="status" title="Finding and processing matching prospects…">
              <p>
                Searching the data provider for people who match this ICP, then resolving their
                companies and applying this ICP&apos;s suppression list and hard criteria. This
                usually takes a few seconds.
              </p>
            </Alert>
            <div aria-hidden className="flex flex-col gap-2">
              {[0, 1, 2].map((index) => (
                <div className="rounded-control border border-line p-4" key={index}>
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="mt-2 h-3 w-64" />
                  <Skeleton className="mt-3 h-3 w-40" />
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="px-5 py-4 sm:px-6">
            <Alert tone="error" role="alert" title={errorCopy(error).title}>
              <p>{errorCopy(error).body}</p>
              <p className="mt-1 opacity-80">Error code: {error.code}</p>
              {error.details.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] leading-4 opacity-80">
                  {error.details.slice(0, 4).map((detail, index) => (
                    <li key={`${detail.path}-${index}`}>
                      {detail.path}: {detail.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={searching}
                onClick={() => void search(run?.pagination.page ?? 1)}
              >
                Try again
              </Button>
            </Alert>
          </div>
        ) : found ? (
          <>
            <ProcessingSummary
              channel={channel}
              onChannel={setChannel}
              onView={setView}
              processing={run.processing}
              view={view}
            />
            {visible.length > 0 ? (
              <ul className="flex flex-col gap-2 px-5 py-4 sm:px-6">
                {visible.map((person) => (
                  <ProspectCard
                    key={person.rawSourceRef}
                    outcome={outcomes.get(person.rawSourceRef)}
                    person={person}
                    prospect={contacts.get(person.rawSourceRef)}
                  />
                ))}
              </ul>
            ) : (
              /* A count of zero in one tab is a finding about this ICP, not a
                 failure, and the two zeros mean opposite things - so they are
                 worded separately rather than sharing an "empty" state. */
              <div className="px-5 py-5 sm:px-6">
                {channel === 'all' ? (
                  <EmptyState
                    title={
                      view === 'qualified'
                        ? 'No one on this page passed the hard filters'
                        : 'Nothing was excluded on this page'
                    }
                    description={
                      view === 'qualified'
                        ? 'Every person the data provider returned was suppressed, excluded by a hard criterion, or had no usable contact handle. The cold pool lists each one with its reason.'
                        : 'Every person the data provider returned passed suppression, the supported hard criteria and the reachability check.'
                    }
                  />
                ) : (
                  /* A channel filter matching nobody is a fact about what the
                     enrichment provider holds, not a failed search - and it is
                     worded separately so it is never read as the latter. */
                  <EmptyState
                    title="No one on this page has that contact channel"
                    description="Contact data availability varies per person, and a prospect reachable on one channel is often not reachable on another. Clear the filter to see everyone on this page and the channels they do have."
                    action={
                      <Button variant="secondary" size="sm" onClick={() => setChannel('all')}>
                        Show all channels
                      </Button>
                    }
                  />
                )}
              </div>
            )}
            <Pager busy={searching} onGo={(page) => void search(page)} run={run} />
            <ProspectMeta run={run} />
          </>
        ) : run !== null ? (
          <>
            {/* The search worked and matched nobody - a result, not a failure.
                Saying so explicitly is the difference between "your ICP is too
                narrow" and "something is broken". */}
            <div className="px-5 py-5 sm:px-6">
              <EmptyState
                title="No matching prospects found for this ICP"
                description={
                  run.pagination.page > 1
                    ? 'This page is past the end of the result set. Go back to the first page to see the matches.'
                    : 'The search completed successfully against the data provider, and no people matched these criteria. Widen the target titles, seniorities, geography or company size on the ICP and search again.'
                }
                action={
                  // "Back to first page" is its own action and is offered
                  // whatever the header shows; a bare re-run is not, because
                  // that is exactly what the header's button already does.
                  run.pagination.page > 1 ? (
                    <Button variant="secondary" size="sm" onClick={() => void search(1)}>
                      Back to first page
                    </Button>
                  ) : hideRunAction ? null : (
                    <Button variant="secondary" size="sm" onClick={() => void search()}>
                      Search again
                    </Button>
                  )
                }
              />
            </div>
            <ProspectMeta run={run} />
          </>
        ) : (
          <div className="px-5 py-5 sm:px-6">
            <EmptyState
              title="No prospect search yet"
              description="Search the configured data provider for people who match this ICP's target buyer, geography and company profile. Each search costs provider credits, so it runs only when you ask for it."
              action={
                hideRunAction ? null : (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={searching || icpId.length === 0}
                    onClick={() => void search()}
                  >
                    Find matching leads
                  </Button>
                )
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}
