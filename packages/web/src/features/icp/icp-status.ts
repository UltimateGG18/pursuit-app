import type { IcpStatus } from '@pursuit/shared';
import type { BadgeTone } from '../../components/ui/index.js';
import type { UseIcpAnalysis } from '../analysis/useIcpAnalysis.js';

// ---------------------------------------------------------------------------
// Record lifecycle - authored by a person, stored on the profile.
// ---------------------------------------------------------------------------

export function recordStatusTone(status: IcpStatus): BadgeTone {
  if (status === 'ACTIVE') return 'positive';
  if (status === 'ARCHIVED') return 'critical';
  return 'neutral';
}

export function recordStatusLabel(status: IcpStatus): string {
  return `${status.charAt(0)}${status.slice(1).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Analysis lifecycle - derived, and known only for the ICP in view.
// ---------------------------------------------------------------------------

/**
 * Where an ICP stands with the model.
 *
 * `unknown` is a real state, not a placeholder: the ICP list endpoint returns
 * no analysis information, so the only ICP whose analysis state the client can
 * honestly report is the one whose analyses it has loaded. Every other row
 * shows no analysis badge rather than a guess.
 */
export type AnalysisPhase = 'unknown' | 'none' | 'running' | 'analyzed' | 'failed';

export function analysisPhase(analysis: UseIcpAnalysis): AnalysisPhase {
  if (analysis.status === 'running') return 'running';
  if (analysis.status === 'loading') return 'unknown';
  if (analysis.error) return 'failed';
  if (analysis.current) return analysis.current.output ? 'analyzed' : 'failed';
  return 'none';
}

/** Wording for a list row, where the subject is the ICP. */
export const PHASE_ROW_LABEL: Readonly<Record<AnalysisPhase, string | null>> = {
  unknown: null,
  none: 'Ready to analyze',
  running: 'Analyzing',
  analyzed: 'Analyzed',
  failed: 'Analysis failed',
};

/** Wording for the analysis section, where the subject is the analysis. */
export const PHASE_STATE_LABEL: Readonly<Record<AnalysisPhase, string>> = {
  unknown: 'Loading',
  none: 'Ready to analyze',
  running: 'Analyzing',
  analyzed: 'Completed',
  failed: 'Failed',
};

export const PHASE_TONE: Readonly<Record<AnalysisPhase, BadgeTone>> = {
  unknown: 'outline',
  none: 'outline',
  running: 'brand',
  analyzed: 'positive',
  failed: 'critical',
};

/** Short, unambiguous date for list rows and record metadata. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
