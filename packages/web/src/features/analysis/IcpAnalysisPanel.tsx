import { ICP_ANALYSIS_SCHEMA_VERSION, readAnalysisOutput, type IcpAnalysisDto } from '@pursuit/shared';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Skeleton,
} from '../../components/ui/index.js';
import type { ClientError } from '../../api/client.js';
import {
  PHASE_STATE_LABEL,
  PHASE_TONE,
  analysisPhase,
} from '../icp/icp-status.js';
import { ScrollLink } from '../../router/ScrollLink.js';
import { useIcpAnalysis, type UseIcpAnalysis } from './useIcpAnalysis.js';
import { AnalysisIntelligence, INTELLIGENCE_ANCHORS } from './AnalysisIntelligence.js';

export interface IcpAnalysisPanelProps {
  /** The saved ICP to analyze; null while the form holds an unsaved draft. */
  icpId: string | null;
  icpName: string | null;
  /**
   * Analysis state owned by the page, so the workspace header and the sidebar
   * can show the same run this panel is rendering. Omitted, the panel manages
   * its own state and works as a standalone section.
   */
  analysis?: UseIcpAnalysis;
  /**
   * Set when the page header already offers the Analyze action. The panel then
   * moves it into its empty state instead, so a screen never carries two
   * primary buttons that do the same thing.
   */
  hideRunAction?: boolean;
  /**
   * Starts prospect discovery from this analysis.
   *
   * Offered only once there is a readable result, because it is the next step
   * of one flow rather than an independent feature: the analysis says who to
   * look for, and this goes and finds them. Omitted, the panel simply ends at
   * the analysis - which is what it did before prospects existed.
   */
  onFindProspects?: () => void;
}

/**
 * Error copy keyed by API error code.
 *
 * Deliberately provider-neutral: the frontend does not know which model
 * provider is configured, holds no credential, and must not tell a user to go
 * and start something. Configuration failures are named by the backend, so
 * that message is shown as it was written.
 */
function errorCopy(error: ClientError): { title: string; body: string } {
  switch (error.code) {
    case 'MODEL_PROVIDER_UNAVAILABLE':
      // The backend names the configuration setting when one is missing, so
      // its message is more useful here than anything hardcoded.
      return { title: 'The analysis model is unavailable', body: error.message };
    case 'MODEL_RATE_LIMITED':
      return {
        title: 'The analysis model is rate limited',
        body: error.message,
      };
    case 'MODEL_TIMEOUT':
      return {
        title: 'The analysis timed out',
        body: 'The model did not finish in time. Try again, or raise MODEL_TIMEOUT_MS.',
      };
    case 'MODEL_INVALID_RESPONSE':
    case 'MODEL_OUTPUT_VALIDATION_FAILED':
      return {
        title: 'The model returned an unusable result',
        body: 'The response did not match the expected analysis contract, so nothing was stored. Try again.',
      };
    case 'NETWORK_ERROR':
      return { title: 'Could not reach the API', body: error.message };
    default:
      return { title: 'The analysis failed', body: error.message };
  }
}

/** Provenance strip: which model, which prompt, how long, when. */
function AnalysisMeta({ analysis }: { analysis: IcpAnalysisDto }) {
  return (
    <p className="border-t border-line px-5 py-3 text-xs text-ink-muted sm:px-6">
      {analysis.provider} &middot; {analysis.model} &middot; prompt {analysis.promptVersion} &middot;{' '}
      {analysis.analysisSchemaVersion} &middot; ICP v{analysis.icpVersion}
      {analysis.durationMs === null ? '' : ` · ${(analysis.durationMs / 1000).toFixed(1)}s`} &middot;{' '}
      {new Date(analysis.createdAt).toLocaleString()}
    </p>
  );
}

/**
 * The stored JSON, for a developer.
 *
 * Collapsed and last, because the whole point of this panel is that the
 * analysis is readable intelligence rather than a payload. It stays available
 * because this output is the input contract for prospect discovery, and
 * whoever builds that will want to see the exact shape.
 */
function RawOutput({ output }: { output: unknown }) {
  return (
    <details className="border-t border-line px-5 py-3 sm:px-6">
      <summary className="cursor-pointer text-xs font-medium text-ink-muted transition-colors hover:text-ink">
        Raw analysis JSON
      </summary>
      <pre className="mt-2 max-h-96 overflow-auto rounded-control border border-line bg-surface-sunken p-3 font-mono text-[11px] leading-5 text-ink-soft">
        {JSON.stringify(output, null, 2)}
      </pre>
    </details>
  );
}

/**
 * A stored run this build cannot read as intelligence.
 *
 * Two cases, one treatment. A `v1` row is a complete, honest analysis of the
 * contract it was written under - it simply has none of the sections this
 * screen reads. A current-version row whose stored shape no longer satisfies
 * the contract is the same situation arrived at differently. Either way the
 * only truthful options are to say so or to render sections that are not there,
 * so it says so and offers a re-run.
 */
function UnreadableAnalysis({
  analysis,
  onRerun,
  canRerun,
}: {
  analysis: IcpAnalysisDto;
  onRerun: () => void;
  canRerun: boolean;
}) {
  const olderContract = analysis.analysisSchemaVersion !== ICP_ANALYSIS_SCHEMA_VERSION;
  return (
    <div className="px-5 py-4 sm:px-6">
      <Alert tone="info" role="status" title="This analysis predates the current contract">
        <p>
          {olderContract
            ? `It was produced under ${analysis.analysisSchemaVersion}, which derived signal lists rather than discovery intelligence.`
            : `It is recorded as ${analysis.analysisSchemaVersion}, but the stored result no longer matches that contract.`}{' '}
          Re-run the analysis to get the interpretation, discovery strategy and evidence
          requirements.
        </p>
        {canRerun ? (
          <Button variant="secondary" size="sm" className="mt-2" onClick={onRerun}>
            Re-run analysis
          </Button>
        ) : null}
      </Alert>
    </div>
  );
}

/**
 * PURSUIT Analysis - the intelligence layer between an ICP and discovery.
 *
 * Kept visually distinct from the configuration form: the form is criteria a
 * person authored, this is derived reasoning a model produced, and the two must
 * never look like the same kind of record.
 *
 * The panel owns the run lifecycle - ready, analyzing, completed, failed - and
 * `AnalysisIntelligence` owns reading the result.
 */
export function IcpAnalysisPanel({
  icpId,
  icpName,
  analysis,
  hideRunAction = false,
  onFindProspects,
}: IcpAnalysisPanelProps) {
  // Passing `null` when the page owns the state keeps this from issuing a
  // second read of the same analyses; the hook itself stays unconditional.
  const ownState = useIcpAnalysis(analysis ? null : icpId);
  const { status, current, history, error, run, select } = analysis ?? ownState;
  const running = status === 'running';
  const phase = analysisPhase(analysis ?? ownState);

  /**
   * The result, only when this build can actually read it: the version has to
   * match and the stored payload still has to satisfy the contract. Anything
   * else is reported rather than rendered as an empty analysis.
   */
  const intelligence = current ? readAnalysisOutput(current) : null;
  /** A COMPLETED run whose stored output this build cannot interpret. */
  const unreadable =
    current !== null &&
    current.output !== null &&
    current.output !== undefined &&
    intelligence === null;

  return (
    <section
      aria-labelledby="pursuit-analysis-title"
      className="rounded-card border border-line bg-surface shadow-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-6 text-ink" id="pursuit-analysis-title">
              PURSUIT Analysis
            </h3>
            <Badge tone="brand" uppercase>
              Model generated
            </Badge>
            {icpId === null ? null : (
              <Badge tone={PHASE_TONE[phase]}>{PHASE_STATE_LABEL[phase]}</Badge>
            )}
          </div>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
            {icpName
              ? `Discovery intelligence reasoned from "${icpName}": who to look for, why they would buy, how to find them and what would prove it. Every conclusion is a hypothesis about a class of company, not a claim about a named one.`
              : 'Discovery intelligence reasoned from a saved ICP.'}
          </p>
        </div>

        {hideRunAction ? null : (
          <Button
            variant="primary"
            size="sm"
            loading={running}
            disabled={icpId === null || status !== 'idle'}
            onClick={() => void run()}
          >
            {running ? 'Analyzing…' : history.length > 0 ? 'Re-run analysis' : 'Analyze ICP'}
          </Button>
        )}
      </header>

      {history.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-3 sm:px-6">
          <span className="text-xs text-ink-muted">Runs:</span>
          {history.map((item, index) => (
            <Button
              key={item.id}
              variant={item.id === current?.id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => select(item.id)}
            >
              {index === 0 ? 'Latest' : new Date(item.createdAt).toLocaleTimeString()}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="border-t border-line">
        {icpId === null ? (
          <div className="px-5 py-5 sm:px-6">
            <EmptyState
              title="Save the ICP first"
              description="An analysis runs against a stored ICP, so create or select one before analyzing."
            />
          </div>
        ) : error ? (
          <div className="px-5 py-4 sm:px-6">
            <Alert tone="error" role="alert" title={errorCopy(error).title}>
              <p>{errorCopy(error).body}</p>
              <p className="mt-1 opacity-80">Error code: {error.code}</p>
              {/* Which field broke which rule. Technical, but it is the
                  difference between "try again" and a reportable failure -
                  and the backend now names it for both validators. */}
              {error.details.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] leading-4 opacity-80">
                  {error.details.slice(0, 4).map((detail, index) => (
                    <li key={`${detail.path}-${index}`}>
                      {detail.path}: {detail.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {hideRunAction ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  disabled={status !== 'idle'}
                  onClick={() => void run()}
                >
                  Try again
                </Button>
              ) : null}
            </Alert>
          </div>
        ) : running ? (
          <div className="px-5 py-4 sm:px-6">
            {/* No progress bar: the backend reports no progress, and a fake
                percentage is worse than an honest wait. */}
            <Alert tone="info" role="status" title="Analyzing ICP…">
              <p>
                The model is reasoning across the configuration to produce discovery intelligence.
                This usually takes a few seconds.
              </p>
            </Alert>
          </div>
        ) : status === 'loading' ? (
          <div
            className="flex flex-col gap-3 px-5 py-5 sm:px-6"
            role="status"
            aria-label="Loading stored analyses"
          >
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : intelligence ? (
          <>
            {/* In-result navigation, so a long analysis stays one click deep. */}
            <nav
              aria-label="Analysis sections"
              className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-subtle px-5 py-2 sm:px-6"
            >
              {INTELLIGENCE_ANCHORS.map((anchor) => (
                <ScrollLink
                  className="rounded-control px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas-deep hover:text-ink"
                  key={anchor.id}
                  targetId={anchor.id}
                >
                  {anchor.label}
                </ScrollLink>
              ))}
            </nav>
            <AnalysisIntelligence output={intelligence} />
            {/* The handoff to discovery, at the end of the reasoning rather
                than in the header: this is what to do *with* the analysis, and
                it only makes sense once there is one to act on. */}
            {onFindProspects ? (
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line bg-surface-subtle px-5 py-4 sm:px-6">
                <p className="max-w-xl text-xs leading-5 text-ink-muted">
                  Next: find real people matching this profile. The search uses the ICP&apos;s target
                  buyer, geography and company size, widened by the buyer roles above.
                </p>
                <Button variant="primary" size="sm" onClick={onFindProspects}>
                  Find matching leads
                </Button>
              </div>
            ) : null}
            <AnalysisMeta analysis={current!} />
            <RawOutput output={intelligence} />
          </>
        ) : unreadable ? (
          <>
            <UnreadableAnalysis
              analysis={current}
              canRerun={hideRunAction && status === 'idle'}
              onRerun={() => void run()}
            />
            <AnalysisMeta analysis={current} />
          </>
        ) : current ? (
          <div className="px-5 py-5 sm:px-6">
            <Alert
              tone="error"
              role="status"
              title={`The last run ended as ${current.status}`}
            >
              <p>{current.error?.message ?? 'No result was stored for this run.'}</p>
              {hideRunAction ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  disabled={status !== 'idle'}
                  onClick={() => void run()}
                >
                  Try again
                </Button>
              ) : null}
            </Alert>
          </div>
        ) : (
          <div className="px-5 py-5 sm:px-6">
            <EmptyState
              title="No analysis yet"
              description="Run the analysis to turn this ICP into an ideal company profile, pain and intent hypotheses, a discovery and search strategy, evidence requirements and a buyer plan."
              action={
                hideRunAction ? (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={status !== 'idle'}
                    onClick={() => void run()}
                  >
                    Analyze ICP
                  </Button>
                ) : null
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}
