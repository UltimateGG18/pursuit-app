import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IcpAnalysisDto } from '@pursuit/shared';

const listMock = vi.fn();
const getMock = vi.fn();
const removeMock = vi.fn();
const analysisListMock = vi.fn();
const analysisRunMock = vi.fn();

vi.mock('../src/api/client.js', () => ({
  icpApi: {
    list: listMock,
    get: getMock,
    create: vi.fn(),
    update: vi.fn(),
    remove: removeMock,
  },
  analysisApi: {
    run: analysisRunMock,
    list: analysisListMock,
    get: vi.fn(),
    health: vi.fn(),
  },
  prospectsApi: { search: vi.fn(), health: vi.fn() },
}));

const { App } = await import('../src/App.js');
const {
  ICP_ID,
  ICP_NAME,
  OTHER_ICP_ID,
  analysisDto,
  emptyList,
  listOf,
  noAnalyses,
  profileDto,
  summaryDto,
} = await import('./fixtures.js');

const OTHER_NAME = 'DACH enterprise data platform';

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
  listMock.mockResolvedValue(listOf([summaryDto()]));
  getMock.mockResolvedValue({ ok: true, data: profileDto() });
  analysisListMock.mockResolvedValue(noAnalyses());
});

async function renderAt(hash: string) {
  window.location.hash = hash;
  const utils = render(<App />);
  await waitFor(() => expect(listMock).toHaveBeenCalled());
  return utils;
}

const sidebar = () => screen.getByRole('navigation', { name: 'ICPs' });

describe('ICP sidebar', () => {
  it('lists the stored ICPs with their status and version', async () => {
    listMock.mockResolvedValue(
      listOf([summaryDto({ version: 4 }), summaryDto({ id: OTHER_ICP_ID, name: OTHER_NAME, status: 'INACTIVE' })]),
    );
    await renderAt('#/icps');

    const panel = sidebar();
    expect(await within(panel).findByRole('link', { name: new RegExp(ICP_NAME) })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: new RegExp(OTHER_NAME) })).toBeInTheDocument();
    expect(within(panel).getByText('v4')).toBeInTheDocument();
    // Active and inactive ICPs are separated rather than mixed together.
    expect(within(panel).getByRole('heading', { name: 'Active' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Inactive' })).toBeInTheDocument();
  });

  it('marks the ICP in view as the current row', async () => {
    await renderAt(`#/icps/${ICP_ID}`);

    const row = await within(sidebar()).findByRole('link', { name: new RegExp(ICP_NAME) });
    expect(row).toHaveAttribute('aria-current', 'page');
  });

  it('opens an ICP workspace when a row is clicked', async () => {
    const user = userEvent.setup();
    await renderAt('#/icps');

    expect(await screen.findByText('Select an ICP')).toBeInTheDocument();

    await user.click(await within(sidebar()).findByRole('link', { name: new RegExp(ICP_NAME) }));

    expect(window.location.hash).toBe(`#/icps/${ICP_ID}`);
    expect(await screen.findByRole('heading', { level: 1, name: ICP_NAME })).toBeInTheDocument();
  });

  it('switches between ICPs without leaving the workspace', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(
      listOf([summaryDto(), summaryDto({ id: OTHER_ICP_ID, name: OTHER_NAME })]),
    );
    getMock.mockImplementation((id: string) =>
      Promise.resolve({
        ok: true,
        data: id === OTHER_ICP_ID ? profileDto({ id: OTHER_ICP_ID, name: OTHER_NAME }) : profileDto(),
      }),
    );
    await renderAt(`#/icps/${ICP_ID}`);
    await screen.findByRole('heading', { level: 1, name: ICP_NAME });

    await user.click(within(sidebar()).getByRole('link', { name: new RegExp(OTHER_NAME) }));

    expect(await screen.findByRole('heading', { level: 1, name: OTHER_NAME })).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/icps/${OTHER_ICP_ID}`);
    // The sidebar is still there, so the next switch is one click away.
    expect(sidebar()).toBeInTheDocument();
  });

  it('reports a failed list load with a retry', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'Could not reach the API', details: [] },
    });
    await renderAt('#/icps');

    const panel = sidebar();
    expect(await within(panel).findByText('Unable to load ICPs')).toBeInTheDocument();
    expect(within(panel).getByText('Could not reach the API')).toBeInTheDocument();

    listMock.mockResolvedValue(listOf([summaryDto()]));
    await user.click(within(panel).getByRole('button', { name: 'Retry' }));

    expect(
      await within(sidebar()).findByRole('link', { name: new RegExp(ICP_NAME) }),
    ).toBeInTheDocument();
  });

  it('explains an empty account instead of showing a blank page', async () => {
    listMock.mockResolvedValue(emptyList());
    await renderAt('#/icps');

    expect(await screen.findByText('No ICPs yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create ICP' })).toBeInTheDocument();
  });
});

describe('ICP workspace - overview', () => {
  it('summarizes the stored criteria in readable groups', async () => {
    await renderAt(`#/icps/${ICP_ID}`);

    expect(await screen.findByRole('heading', { level: 1, name: ICP_NAME })).toBeInTheDocument();

    for (const group of [
      'Profile',
      'Company profile',
      'Geography',
      'Technology',
      'Services & fit',
      'Business problems',
      'Target buyer',
      'Triggers & intent',
      'Criteria rules',
      'Evidence & discovery',
    ]) {
      expect(screen.getByRole('region', { name: group })).toBeInTheDocument();
    }
  });

  it('shows stored codes as the labels the form used, never as raw enums', async () => {
    await renderAt(`#/icps/${ICP_ID}`);

    const company = await screen.findByRole('region', { name: 'Company profile' });
    // The example ICP targets financial services, logistics and manufacturing.
    expect(within(company).getByText('Financial services')).toBeInTheDocument();
    expect(screen.queryByText('FINANCIAL_SERVICES')).not.toBeInTheDocument();
  });

  it('renders criteria rules as sentences rather than as JSON', async () => {
    await renderAt(`#/icps/${ICP_ID}`);

    const rules = await screen.findByRole('region', { name: 'Criteria rules' });
    expect(within(rules).getByText(/Employee count is at least 200/)).toBeInTheDocument();
    expect(within(rules).getByText(/Country is any of Netherlands, Belgium, Luxembourg/)).toBeInTheDocument();
    // A nice-to-have rule carries its scoring weight; a hard filter does not.
    expect(within(rules).getByText('weight 7')).toBeInTheDocument();
  });

  it('puts Edit, Analyze and Delete in the header, not at the bottom of a form', async () => {
    await renderAt(`#/icps/${ICP_ID}`);

    const header = (await screen.findByRole('heading', { level: 1, name: ICP_NAME })).closest(
      'header',
    );
    expect(header).not.toBeNull();
    const actions = within(header as HTMLElement);
    expect(actions.getByRole('button', { name: 'Edit ICP' })).toBeInTheDocument();
    expect(actions.getByRole('button', { name: 'Analyze ICP' })).toBeInTheDocument();
    expect(actions.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('reports a workspace load failure with a retry and a way back', async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'No ICP found with that id', details: [] },
    });
    await renderAt(`#/icps/${ICP_ID}`);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to load this ICP');
    expect(alert).toHaveTextContent('No ICP found with that id');

    getMock.mockResolvedValue({ ok: true, data: profileDto() });
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { level: 1, name: ICP_NAME })).toBeInTheDocument();
  });
});

describe('ICP workspace - analysis', () => {
  it('starts at the criteria and reaches the analysis in one click', async () => {
    const user = userEvent.setup();
    await renderAt(`#/icps/${ICP_ID}`);
    await screen.findByRole('heading', { level: 1, name: ICP_NAME });

    const views = screen.getByRole('navigation', { name: 'ICP views' });
    await user.click(within(views).getByRole('link', { name: /Analysis/ }));

    expect(window.location.hash).toBe(`#/icps/${ICP_ID}/analyze`);
    expect(
      await screen.findByRole('heading', { name: 'PURSUIT Analysis' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No analysis yet')).toBeInTheDocument();
  });

  it('opens straight onto the analysis when the route says so', async () => {
    await renderAt(`#/icps/${ICP_ID}/analyze`);

    expect(await screen.findByRole('heading', { name: 'PURSUIT Analysis' })).toBeInTheDocument();
    await waitFor(() => expect(analysisListMock).toHaveBeenCalledWith(ICP_ID));
    expect(analysisRunMock).not.toHaveBeenCalled();
  });

  it('runs the analysis from the header and shows the result in the workspace', async () => {
    const user = userEvent.setup();
    analysisRunMock.mockResolvedValue({ ok: true, data: analysisDto() });
    await renderAt(`#/icps/${ICP_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Analyze ICP' }));

    await waitFor(() => expect(analysisRunMock).toHaveBeenCalledWith(ICP_ID));
    // Running the analysis moves the user to where the result appears.
    expect(window.location.hash).toBe(`#/icps/${ICP_ID}/analyze`);
    expect(await screen.findByRole('heading', { name: 'ICP interpretation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Discovery strategy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Buyer strategy' })).toBeInTheDocument();
    // No going back to the form to read it, and re-running is offered here.
    expect(screen.getByRole('button', { name: 'Re-analyze' })).toBeInTheDocument();
  });

  it('shows a running state and refuses a second concurrent run', async () => {
    const user = userEvent.setup();
    let resolveRun: (value: { ok: true; data: IcpAnalysisDto }) => void = () => {};
    analysisRunMock.mockReturnValue(
      new Promise<{ ok: true; data: IcpAnalysisDto }>((resolve) => {
        resolveRun = resolve;
      }),
    );
    await renderAt(`#/icps/${ICP_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Analyze ICP' }));

    const running = await screen.findByRole('button', { name: 'Analyzing…' });
    expect(running).toBeDisabled();
    expect(await screen.findByText('Analyzing ICP…')).toBeInTheDocument();

    await user.click(running);
    expect(analysisRunMock).toHaveBeenCalledTimes(1);

    resolveRun({ ok: true, data: analysisDto() });
    expect(await screen.findByRole('heading', { name: 'ICP interpretation' })).toBeInTheDocument();
  });

  it('shows a stored analysis without spending a model call', async () => {
    analysisListMock.mockResolvedValue({ ok: true, data: { items: [analysisDto()], total: 1 } });
    await renderAt(`#/icps/${ICP_ID}/analyze`);

    expect(await screen.findByRole('heading', { name: 'ICP interpretation' })).toBeInTheDocument();
    expect(analysisRunMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Re-analyze' })).toBeInTheDocument();
  });

  it('explains a failed analysis in the user’s terms and offers another try', async () => {
    const user = userEvent.setup();
    analysisRunMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'MODEL_PROVIDER_UNAVAILABLE',
        message: 'GROQ_API_KEY is not configured. Add it to packages/server/.env.',
        details: [],
      },
    });
    await renderAt(`#/icps/${ICP_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Analyze ICP' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The analysis model is unavailable');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ICP interpretation' })).not.toBeInTheDocument();
  });

  it('reports the analysis state on the row and the view', async () => {
    analysisListMock.mockResolvedValue({ ok: true, data: { items: [analysisDto()], total: 1 } });
    await renderAt(`#/icps/${ICP_ID}`);

    expect(await within(sidebar()).findByText('Analyzed')).toBeInTheDocument();
    const views = screen.getByRole('navigation', { name: 'ICP views' });
    expect(within(views).getByText('Analyzed')).toBeInTheDocument();
  });
});

describe('ICP workspace - deleting', () => {
  it('asks for confirmation before deleting', async () => {
    const user = userEvent.setup();
    await renderAt(`#/icps/${ICP_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: `Delete "${ICP_NAME}"?` });
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(removeMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: ICP_NAME })).toBeInTheDocument();
  });

  it('deletes the ICP and returns to the list', async () => {
    const user = userEvent.setup();
    removeMock.mockResolvedValue({
      ok: true,
      data: { id: ICP_ID, status: 'ARCHIVED', deletedAt: '2026-01-02T00:00:00.000Z' },
    });
    listMock.mockResolvedValueOnce(listOf([summaryDto()])).mockResolvedValue(emptyList());
    await renderAt(`#/icps/${ICP_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith(ICP_ID));
    expect(window.location.hash).toBe('#/icps');
    expect(await screen.findByText('No ICPs yet')).toBeInTheDocument();
  });
});

/**
 * The suite runs at a desktop viewport (see `tests/setup.ts`), so the narrow
 * layout has to be asked for explicitly. `useMediaQuery` decides which of the
 * two renders, and only one of them exists at a time.
 */
describe('ICP workspace - narrow viewports', () => {
  const desktopMatchMedia = window.matchMedia.bind(window);

  afterEach(() => {
    window.matchMedia = desktopMatchMedia;
  });

  function narrowViewport(): void {
    window.matchMedia = (query: string): MediaQueryList => ({
      media: query,
      matches: false,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
  }

  it('swaps the docked sidebar for a selector that opens a drawer', async () => {
    narrowViewport();
    const user = userEvent.setup();
    listMock.mockResolvedValue(
      listOf([summaryDto(), summaryDto({ id: OTHER_ICP_ID, name: OTHER_NAME })]),
    );
    getMock.mockImplementation((id: string) =>
      Promise.resolve({
        ok: true,
        data: id === OTHER_ICP_ID ? profileDto({ id: OTHER_ICP_ID, name: OTHER_NAME }) : profileDto(),
      }),
    );
    await renderAt(`#/icps/${ICP_ID}`);
    await screen.findByRole('heading', { level: 1, name: ICP_NAME });

    // The list is behind the selector rather than taking half the screen.
    expect(screen.queryByRole('navigation', { name: 'ICPs' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: new RegExp(`ICP ${ICP_NAME}`) }));

    const drawer = await screen.findByRole('dialog', { name: 'ICPs' });
    await user.click(within(drawer).getByRole('link', { name: new RegExp(OTHER_NAME) }));

    // Selecting an ICP is what the drawer is for, so it dismisses itself.
    expect(await screen.findByRole('heading', { level: 1, name: OTHER_NAME })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ICPs' })).not.toBeInTheDocument());
  });
});
