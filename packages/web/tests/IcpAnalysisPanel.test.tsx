import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IcpAnalysisDto } from '@pursuit/shared';

const runMock = vi.fn();
const listMock = vi.fn();

vi.mock('../src/api/client.js', () => ({
  icpApi: {},
  analysisApi: { run: runMock, list: listMock, get: vi.fn(), health: vi.fn() },
  prospectsApi: { search: vi.fn(), health: vi.fn() },
}));

const { IcpAnalysisPanel } = await import('../src/features/analysis/IcpAnalysisPanel.js');
const { analysisDto, analysisOutput, ICP_ID } = await import('./fixtures.js');

function emptyHistory() {
  return { ok: true as const, data: { items: [], total: 0 } };
}

async function renderPanel(icpId: string | null = ICP_ID) {
  const utils = render(<IcpAnalysisPanel icpId={icpId} icpName="Benelux mid-market" />);
  if (icpId !== null) await waitFor(() => expect(listMock).toHaveBeenCalledWith(icpId));
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue(emptyHistory());
});

describe('analysis panel - before anything is run', () => {
  it('asks for a saved ICP when the form still holds an unsaved draft', async () => {
    render(<IcpAnalysisPanel icpId={null} icpName={null} />);

    expect(await screen.findByText('Save the ICP first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze ICP' })).toBeDisabled();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('loads the stored analyses for a saved ICP without running the model', async () => {
    await renderPanel();

    expect(await screen.findByText('No analysis yet')).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Analyze ICP' })).toBeEnabled();
  });

  it('shows a stored analysis straight away when one exists', async () => {
    listMock.mockResolvedValue({ ok: true, data: { items: [analysisDto()], total: 1 } });

    await renderPanel();

    expect(await screen.findByRole('heading', { name: 'ICP interpretation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-run analysis' })).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('analysis panel - running an analysis', () => {
  it('shows a loading state while the model works, then the result', async () => {
    const user = userEvent.setup();
    let resolveRun: (value: { ok: true; data: IcpAnalysisDto }) => void = () => {};
    runMock.mockReturnValue(
      new Promise<{ ok: true; data: IcpAnalysisDto }>((resolve) => {
        resolveRun = resolve;
      }),
    );
    await renderPanel();

    await user.click(screen.getByRole('button', { name: 'Analyze ICP' }));

    expect(await screen.findByText('Analyzing ICP…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyzing…' })).toBeDisabled();
    // No invented percentage: the backend reports no progress.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    resolveRun({ ok: true, data: analysisDto() });

    expect(await screen.findByRole('heading', { name: 'ICP interpretation' })).toBeInTheDocument();
    expect(screen.queryByText('Analyzing ICP…')).not.toBeInTheDocument();
  });

  it('does not let a second click start a second run', async () => {
    const user = userEvent.setup();
    runMock.mockReturnValue(new Promise(() => {}));
    await renderPanel();

    await user.click(screen.getByRole('button', { name: 'Analyze ICP' }));
    await user.click(screen.getByRole('button', { name: 'Analyzing…' }));

    expect(runMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The result. These assertions are the reason v2 exists: the panel has to
// present reasoning, not a restated ICP.
// ---------------------------------------------------------------------------

describe('analysis panel - the intelligence sections', () => {
  async function renderResult() {
    const user = userEvent.setup();
    runMock.mockResolvedValue({ ok: true, data: analysisDto() });
    await renderPanel();
    await user.click(screen.getByRole('button', { name: 'Analyze ICP' }));
    await screen.findByRole('heading', { name: 'ICP interpretation' });
  }

  it('renders every intelligence section of the contract', async () => {
    await renderResult();

    for (const title of [
      'ICP interpretation',
      'Ideal company profile',
      'Fit model',
      'Pain hypotheses',
      'Intent signals',
      'Technology intelligence',
      'Service fit',
      'Opportunity hypotheses',
      'Discovery strategy',
      'Search queries',
      'Evidence strategy',
      'Buyer strategy',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('shows the interpretation as reasoning rather than as field values', async () => {
    await renderResult();
    const output = analysisOutput();

    expect(screen.getByText(output.icpInterpretation.targetProfile)).toBeInTheDocument();
    expect(screen.getByText(output.icpInterpretation.primaryOpportunity)).toBeInTheDocument();
    expect(screen.getByText(output.icpInterpretation.buyingContext)).toBeInTheDocument();
  });

  it('shows a pain hypothesis with its severity, impact and observable evidence', async () => {
    await renderResult();
    const [pain] = analysisOutput().painHypotheses;

    expect(screen.getByText(pain!.problem)).toBeInTheDocument();
    expect(screen.getByText(pain!.whyLikely)).toBeInTheDocument();
    expect(screen.getByText(pain!.businessImpact[0]!)).toBeInTheDocument();
    expect(screen.getByText(pain!.observableEvidence[0]!)).toBeInTheDocument();
  });

  it('shows an intent signal with its freshness window', async () => {
    await renderResult();
    const [signal] = analysisOutput().intentSignals;

    expect(screen.getByText(signal!.signal)).toBeInTheDocument();
    expect(screen.getByText(`${signal!.lookbackDays}d lookback`)).toBeInTheDocument();
  });

  /** The technology section's value is the combination, so it has to be shown. */
  it('shows a technology pattern with all the technologies it is read from', async () => {
    await renderResult();
    const [pattern] = analysisOutput().technologyIntelligence;

    expect(screen.getByText(pattern!.pattern)).toBeInTheDocument();
    expect(screen.getByText(pattern!.interpretation)).toBeInTheDocument();
    for (const technology of pattern!.technologies) {
      expect(screen.getByText(technology)).toBeInTheDocument();
    }
  });

  /**
   * The ordering *is* the recommendation - step four before step two is a
   * different plan - so the rendered order is asserted, not just membership.
   */
  it('shows the discovery sequence in the order the model gave it', async () => {
    await renderResult();
    const { recommendedSequence } = analysisOutput().discoveryStrategy;

    const rendered = recommendedSequence.map((step) => screen.getByText(step));
    for (let index = 1; index < rendered.length; index += 1) {
      const previous = rendered[index - 1]!;
      const current = rendered[index]!;
      // DOCUMENT_POSITION_FOLLOWING: `current` comes after `previous`.
      expect(previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).
        toBeTruthy();
    }
    expect(screen.getByText(String(recommendedSequence.length))).toBeInTheDocument();
  });

  it('shows search queries verbatim, so they can be copied', async () => {
    await renderResult();
    const [group] = analysisOutput().searchQueryStrategy;

    expect(screen.getByText(group!.purpose)).toBeInTheDocument();
    for (const query of group!.queries) {
      expect(screen.getByText(query)).toBeInTheDocument();
    }
  });

  /**
   * The contract stores source *codes*, because that is what discovery
   * consumes. A person reading the screen should see the wording.
   */
  it('labels evidence source types instead of showing the raw codes', async () => {
    await renderResult();

    expect(screen.getAllByText('Job posting').length).toBeGreaterThan(0);
    expect(screen.queryByText('JOB_POSTING')).not.toBeInTheDocument();
  });

  it('shows the evidence corroboration and freshness requirements', async () => {
    await renderResult();
    const [requirement] = analysisOutput().evidenceStrategy;

    expect(screen.getByText(requirement!.claim)).toBeInTheDocument();
    expect(screen.getAllByText(`max ${requirement!.freshnessDays}d old`).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(`${requirement!.minimumCorroboration} sources`).length,
    ).toBeGreaterThan(0);
  });

  it('explains why each buyer matters rather than only listing the title', async () => {
    await renderResult();
    const [buyer] = analysisOutput().buyerStrategy;

    expect(screen.getByText(buyer!.role)).toBeInTheDocument();
    expect(screen.getByText(buyer!.whyTarget)).toBeInTheDocument();
    expect(screen.getByText('PRIMARY')).toBeInTheDocument();
  });

  it('separates strong fit, weak fit and disqualifiers', async () => {
    await renderResult();
    const { fitModel } = analysisOutput();

    for (const column of ['Strong fit', 'Weak fit', 'Disqualifiers']) {
      expect(screen.getByText(column)).toBeInTheDocument();
    }
    expect(screen.getByText(fitModel.disqualifiers[0]!)).toBeInTheDocument();
  });

  /** Hypotheses must not read as findings about real companies. */
  it('marks the opportunity hypotheses as bets awaiting evidence', async () => {
    await renderResult();

    expect(
      screen.getByText(/Bets to investigate, not findings/),
    ).toBeInTheDocument();
    expect(screen.getByText(analysisOutput().opportunityHypotheses[0]!.hypothesis)).toBeInTheDocument();
  });

  it('shows which model produced the result', async () => {
    await renderResult();

    expect(
      screen.getByText((text) => text.startsWith('groq · openai/gpt-oss-20b · prompt v3')),
    ).toBeInTheDocument();
  });

  /**
   * Available, but not the interface. The analysis is the input contract for
   * prospect discovery, so whoever builds that needs the exact payload - it
   * just must not be what a user is shown first.
   */
  it('keeps the raw JSON collapsed behind a developer disclosure', async () => {
    await renderResult();

    const disclosure = screen.getByText('Raw analysis JSON');
    expect(disclosure).toBeInTheDocument();
    expect(disclosure.closest('details')?.open).toBe(false);
  });
});

describe('analysis panel - failures', () => {
  /**
   * The panel names no provider of its own: which model runtime is configured
   * is a backend concern, and only the backend can say what is wrong with it.
   */
  it('shows the backend explanation when the model is unavailable', async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'MODEL_PROVIDER_UNAVAILABLE',
        message: 'GROQ_API_KEY is not configured. Add it to packages/server/.env.',
        details: [],
      },
    });
    await renderPanel();

    await user.click(screen.getByRole('button', { name: 'Analyze ICP' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The analysis model is unavailable');
    expect(alert).toHaveTextContent(/GROQ_API_KEY is not configured/);
    expect(screen.queryByRole('heading', { name: 'ICP interpretation' })).not.toBeInTheDocument();
  });

  it('explains a rate limit and repeats the retry hint', async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'MODEL_RATE_LIMITED',
        message: 'The analysis model is rate limited. Retry after about 12s.',
        details: [],
      },
    });
    await renderPanel();

    await user.click(screen.getByRole('button', { name: 'Analyze ICP' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The analysis model is rate limited');
    expect(alert).toHaveTextContent(/Retry after about 12s/);
  });

  it('explains a timeout', async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({
      ok: false,
      error: { code: 'MODEL_TIMEOUT', message: 'timeout', details: [] },
    });
    await renderPanel();

    await user.click(screen.getByRole('button', { name: 'Analyze ICP' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The analysis timed out');
  });

  it('reports an invalid result and shows nothing as if it were a result', async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({
      ok: false,
      error: { code: 'MODEL_OUTPUT_VALIDATION_FAILED', message: 'bad', details: [] },
    });
    await renderPanel();

    await user.click(screen.getByRole('button', { name: 'Analyze ICP' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The model returned an unusable result');
    expect(alert).toHaveTextContent('Error code: MODEL_OUTPUT_VALIDATION_FAILED');
    expect(screen.queryByRole('heading', { name: 'ICP interpretation' })).not.toBeInTheDocument();
  });

  /**
   * "Try again" alone is not a reportable failure. The backend names the field
   * and the constraint for both validators, so the panel shows it.
   */
  it('names the field and constraint that broke, when the backend reports one', async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_VALIDATION_FAILED',
        message: 'bad',
        details: [
          {
            path: 'output.fitModel.strongFit',
            message: 'minimum 2 items required, but found 1 items',
          },
        ],
      },
    });
    await renderPanel();

    await user.click(screen.getByRole('button', { name: 'Analyze ICP' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('output.fitModel.strongFit');
    expect(alert).toHaveTextContent('minimum 2 items required');
  });

  it('surfaces a stored FAILED run instead of rendering an empty result', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: {
        items: [
          analysisDto({
            status: 'FAILED',
            output: null,
            error: { code: 'MODEL_TIMEOUT', message: 'The model did not respond in time.' },
          }),
        ],
        total: 1,
      },
    });

    await renderPanel();

    expect(await screen.findByText('The last run ended as FAILED')).toBeInTheDocument();
    expect(screen.getByText('The model did not respond in time.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Older contracts
// ---------------------------------------------------------------------------

describe('analysis panel - a run stored under an older contract', () => {
  /**
   * A `v1` row is a complete analysis of the contract it was written under. The
   * only honest options are to say so or to pretend it has sections it does
   * not; rendering twelve empty blocks would be the worst of both.
   */
  it('says the analysis predates the contract rather than rendering it', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: {
        items: [
          analysisDto({
            promptVersion: 'v2',
            analysisSchemaVersion: 'icp-analysis.v1',
            output: { summary: 'A v1 analysis', industrySignals: [] },
          }),
        ],
        total: 1,
      },
    });

    await renderPanel();

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('This analysis predates the current contract');
    expect(notice).toHaveTextContent('icp-analysis.v1');
    expect(screen.queryByRole('heading', { name: 'ICP interpretation' })).not.toBeInTheDocument();
    // The provenance strip still says which prompt and contract produced it.
    expect(
      screen.getByText((text) => text.startsWith('groq · openai/gpt-oss-20b · prompt v2')),
    ).toBeInTheDocument();
  });

  /** Version aside, a payload that no longer fits the contract is not a result. */
  it('does not render a current-version row whose stored shape has drifted', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: {
        items: [analysisDto({ output: { icpInterpretation: { targetProfile: 'short' } } })],
        total: 1,
      },
    });

    await renderPanel();

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'ICP interpretation' })).not.toBeInTheDocument(),
    );
    expect(within(await screen.findByRole('status')).getByText(/predates the current contract/)).toBeInTheDocument();
  });
});
