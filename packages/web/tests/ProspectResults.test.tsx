import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listMock = vi.fn();
const getMock = vi.fn();
const analysisListMock = vi.fn();
const prospectSearchMock = vi.fn();

vi.mock('../src/api/client.js', () => ({
  icpApi: {
    list: listMock,
    get: getMock,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  analysisApi: {
    run: vi.fn(),
    list: analysisListMock,
    get: vi.fn(),
    health: vi.fn(),
  },
  prospectsApi: {
    search: prospectSearchMock,
    health: vi.fn(),
  },
}));

const { App } = await import('../src/App.js');
const {
  ANALYSIS_ID,
  ICP_ID,
  analysisDto,
  listOf,
  noAnalyses,
  personCandidate,
  profileDto,
  prospectRun,
  summaryDto,
} = await import('./fixtures.js');

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
  listMock.mockResolvedValue(listOf([summaryDto()]));
  getMock.mockResolvedValue({ ok: true, data: profileDto() });
  analysisListMock.mockResolvedValue(noAnalyses());
  prospectSearchMock.mockResolvedValue(prospectRun());
});

async function renderAt(hash: string) {
  window.location.hash = hash;
  const utils = render(<App />);
  await waitFor(() => expect(listMock).toHaveBeenCalled());
  return utils;
}

const panel = () => screen.getByRole('region', { name: 'Matching prospects' });

describe('prospect search - starting one', () => {
  it('does not search until asked, because a search costs provider credits', async () => {
    await renderAt(`#/icps/${ICP_ID}/prospects`);

    await screen.findByText('No prospect search yet');
    expect(prospectSearchMock).not.toHaveBeenCalled();
  });

  it('searches from the empty state and lists the people found', async () => {
    await renderAt(`#/icps/${ICP_ID}/prospects`);

    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    expect(await within(panel()).findByText('Sanne de Vries')).toBeInTheDocument();
    expect(within(panel()).getByText('Chief Technology Officer')).toBeInTheDocument();
    expect(within(panel()).getByText('Voorbeeld Software B.V.')).toBeInTheDocument();
  });

  it('reaches prospects from the analysis, carrying the analysis on screen', async () => {
    analysisListMock.mockResolvedValue({
      ok: true,
      data: { items: [analysisDto({ id: ANALYSIS_ID })], total: 1 },
    });
    await renderAt(`#/icps/${ICP_ID}/analyze`);

    // The handoff at the end of the reasoning, not a separate feature.
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    await waitFor(() => expect(prospectSearchMock).toHaveBeenCalled());
    expect(prospectSearchMock.mock.calls[0]?.[1]).toMatchObject({ analysisId: ANALYSIS_ID });
    // And it lands on the results view rather than leaving the user to find it.
    expect(window.location.hash).toBe(`#/icps/${ICP_ID}/prospects`);
  });

  it('searches on the ICP alone when there is no readable analysis', async () => {
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    await waitFor(() => expect(prospectSearchMock).toHaveBeenCalled());
    expect(prospectSearchMock.mock.calls[0]?.[1]).not.toHaveProperty('analysisId');
  });
});

describe('prospect search - the states', () => {
  it('shows a loading state without freezing the page', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    prospectSearchMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    expect(await screen.findByText('Finding and processing matching prospects…')).toBeInTheDocument();
    // The rest of the application is still there and still navigable.
    expect(screen.getByRole('navigation', { name: 'ICP views' })).toBeInTheDocument();

    resolve?.(prospectRun());
    await screen.findByText('Sanne de Vries');
  });

  it('reports zero matches as a completed search, not a failure', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([], { pagination: { totalEntries: 0, totalPages: 0 } }),
    );
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    expect(
      await screen.findByText('No matching prospects found for this ICP'),
    ).toBeInTheDocument();
    expect(screen.getByText(/completed successfully/)).toBeInTheDocument();
  });

  it('names a missing credential without exposing anything internal', async () => {
    prospectSearchMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'DISCOVERY_PROVIDER_UNAVAILABLE',
        message: 'APOLLO_API_KEY is not configured. Add it to packages/server/.env.',
        details: [],
      },
    });
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Prospect search is unavailable')).toBeInTheDocument();
    // The backend names the setting, because that is the one thing an operator
    // can act on. Nothing here invents a provider name of its own.
    expect(within(alert).getByText(/APOLLO_API_KEY is not configured/)).toBeInTheDocument();
  });

  it('offers a retry after a rate limit rather than swallowing it', async () => {
    prospectSearchMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'DISCOVERY_PROVIDER_RATE_LIMITED',
        message: 'Prospect discovery is rate limited. Retry after about 30s.',
        details: [],
      },
    });
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Prospect search is rate limited')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says which criteria the provider could not filter on', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([personCandidate()], {
        meta: { unsupportedFilters: ['buyer.departments: DATA, PROCUREMENT'] },
      }),
    );
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    // Never hidden: "the provider cannot filter on that" and "there are none"
    // lead a user to different decisions.
    expect(
      await screen.findByText(/buyer.departments: DATA, PROCUREMENT/),
    ).toBeInTheDocument();
  });
});

describe('prospect search - paging', () => {
  it('shows the position in the result set', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([personCandidate()], {
        pagination: { page: 2, perPage: 25, totalEntries: 431, totalPages: 18, hasMore: true },
      }),
    );
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    expect(await screen.findByText(/431/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 18/)).toBeInTheDocument();
  });

  it('fetches the next page rather than loading everything at once', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([personCandidate()], {
        pagination: { page: 1, perPage: 25, totalEntries: 431, totalPages: 18, hasMore: true },
      }),
    );
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));

    await waitFor(() => expect(prospectSearchMock).toHaveBeenCalledTimes(2));
    expect(prospectSearchMock.mock.calls[1]?.[1]).toMatchObject({ page: 2 });
  });

  it('pages on what the provider reported, with no totals to go on', async () => {
    // The shape the live API actually returned: results, no pagination block.
    // The server reconstructs the position and answers "is there more?" from
    // the row count; the pager must not print a total it was never given.
    prospectSearchMock.mockResolvedValue(
      prospectRun([personCandidate()], {
        pagination: { page: 1, perPage: 25, totalEntries: undefined, totalPages: undefined, hasMore: true },
      }),
    );
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    expect(await screen.findByText(/Showing/)).toBeInTheDocument();
    // No "of 0" and no "of 0 pages" anywhere.
    expect(within(panel()).queryByText(/of 0/)).not.toBeInTheDocument();
    // Next still works, because `hasMore` is answerable without a total.
    expect(within(panel()).getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('stops offering Next when the provider says there is no more', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([personCandidate()], {
        pagination: { page: 1, perPage: 25, totalEntries: undefined, totalPages: undefined, hasMore: false },
      }),
    );
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    expect(await within(panel()).findByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('disables Previous on the first page', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([personCandidate()], {
        pagination: { page: 1, perPage: 25, totalEntries: 431, totalPages: 18, hasMore: true },
      }),
    );
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    expect(await screen.findByRole('button', { name: 'Previous' })).toBeDisabled();
  });
});

describe('prospect search - what a lead row shows', () => {
  it('renders only the fields the provider actually reported', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([
        personCandidate({
          providerRefs: [{ provider: 'apollo', externalId: 'thin' }],
          name: 'Thin Record',
          rawSourceRef: 'apollo:person:thin',
          title: undefined,
          seniority: undefined,
          linkedinUrl: undefined,
          emailStatus: undefined,
          company: undefined,
          location: undefined,
        }),
      ]),
    );
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    expect(await screen.findByText('Thin Record')).toBeInTheDocument();
    // No dashes, no "Unknown": a thin record must not be dressed up as a
    // complete one.
    expect(within(panel()).queryByRole('link', { name: 'LinkedIn' })).not.toBeInTheDocument();
    expect(within(panel()).queryByText('—')).not.toBeInTheDocument();
  });

  it('links a LinkedIn profile out safely', async () => {
    await renderAt(`#/icps/${ICP_ID}/prospects`);
    await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));

    const link = await within(panel()).findByRole('link', { name: 'LinkedIn' });
    expect(link).toHaveAttribute('href', 'https://www.linkedin.com/in/sanne-de-vries');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
