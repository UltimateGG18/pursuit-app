import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CandidateProcessingResult } from '@pursuit/shared';

const listMock = vi.fn();
const getMock = vi.fn();
const analysisListMock = vi.fn();
const prospectSearchMock = vi.fn();

vi.mock('../src/api/client.js', () => ({
  icpApi: { list: listMock, get: getMock, create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  analysisApi: { run: vi.fn(), list: analysisListMock, get: vi.fn(), health: vi.fn() },
  prospectsApi: { search: prospectSearchMock, health: vi.fn() },
}));

const { App } = await import('../src/App.js');
const { ICP_ID, listOf, noAnalyses, personCandidate, profileDto, prospectRun, summaryDto } =
  await import('./fixtures.js');

/**
 * The processing half of the prospects panel.
 *
 * What these assert is the separation the whole stage exists for: a reader can
 * always tell what the provider returned from what survived the ICP's hard
 * criteria from what was excluded and why. A UI that showed only the survivors
 * would make a too-narrow ICP indistinguishable from an empty market.
 */

const SURVIVOR = personCandidate();
const REJECTED = personCandidate({
  name: 'Bram Janssen',
  linkedinUrl: 'https://www.linkedin.com/in/bram-janssen',
  rawSourceRef: 'apollo:person:rejected-1',
  company: {
    externalId: 'org-ander',
    name: 'Ander Bedrijf GmbH',
    domain: 'ander-bedrijf.de',
    country: 'DE',
  },
});

/** One survivor, one hard-filter rejection, one suppressed account. */
function mixedProcessing(): Partial<CandidateProcessingResult> {
  return {
    survivors: [
      {
        personRef: SURVIVOR.rawSourceRef,
        providerRefs: SURVIVOR.providerRefs,
        companyId: 'domain:voorbeeld-software.nl',
        state: 'SURVIVOR',
        rejections: [],
      },
    ],
    rejected: [
      {
        personRef: REJECTED.rawSourceRef,
        providerRefs: REJECTED.providerRefs,
        companyId: 'domain:ander-bedrijf.de',
        state: 'COLD',
        rejections: [
          {
            reason: 'HARD_LOCATION_MISMATCH',
            detail: 'Company country DE is not in the target countries NL, BE, LU',
          },
        ],
      },
    ],
    counts: {
      received: 2,
      duplicatesRemoved: 0,
      companiesResolved: 2,
      suppressed: 0,
      hardFilterRejected: 1,
      unreachable: 0,
      survivors: 1,
      cold: 1,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
  listMock.mockResolvedValue(listOf([summaryDto()]));
  getMock.mockResolvedValue({ ok: true, data: profileDto() });
  analysisListMock.mockResolvedValue(noAnalyses());
  prospectSearchMock.mockResolvedValue(
    prospectRun([SURVIVOR, REJECTED], { processing: mixedProcessing() }),
  );
});

const panel = () => screen.getByRole('region', { name: 'Matching prospects' });
/** The candidate rows' text only - the tab strip uses the same words as the badges. */
const rowText = () =>
  within(panel())
    .getAllByRole('listitem')
    .map((row) => row.textContent ?? '')
    .join(' | ');

async function search() {
  window.location.hash = `#/icps/${ICP_ID}/prospects`;
  render(<App />);
  await waitFor(() => expect(listMock).toHaveBeenCalled());
  await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));
  await waitFor(() => expect(prospectSearchMock).toHaveBeenCalled());
}

describe('prospect processing - the funnel', () => {
  it('shows what was discovered, what passed and what is in the cold pool', async () => {
    await search();

    const counts = panel();
    expect(await within(counts).findByRole('button', { name: /Passed hard filters 1/ })).toBeTruthy();
    expect(within(counts).getByRole('button', { name: /Cold pool 1/ })).toBeTruthy();
    expect(within(counts).getByRole('button', { name: /All discovered 2/ })).toBeTruthy();
  });

  it('shows the survivors first, and not the excluded candidate', async () => {
    await search();

    expect(await within(panel()).findByText('Sanne de Vries')).toBeTruthy();
    expect(within(panel()).queryByText('Bram Janssen')).toBeNull();
  });

  it('shows the excluded candidate with its reason when the cold pool is opened', async () => {
    await search();
    await userEvent.click(await screen.findByRole('button', { name: /Cold pool 1/ }));

    expect(within(panel()).getByText('Bram Janssen')).toBeTruthy();
    expect(
      within(panel()).getByText('Company country DE is not in the target countries NL, BE, LU'),
    ).toBeTruthy();
    expect(within(panel()).queryByText('Sanne de Vries')).toBeNull();
  });

  it('shows every discovered person, labelled, in the All view', async () => {
    await search();
    await userEvent.click(await screen.findByRole('button', { name: /All discovered 2/ }));

    const text = rowText();
    expect(text).toContain('Sanne de Vries');
    expect(text).toContain('Bram Janssen');
    // Each row carries its own verdict, so the two are never confusable even
    // when they sit next to each other.
    expect(text).toContain('Passed hard filters');
    expect(text).toContain('Location');
  });
});

describe('prospect processing - what the panel never claims', () => {
  it('does not call a survivor qualified, scored or ranked', async () => {
    await search();

    const text = panel().textContent ?? '';
    for (const forbidden of ['Qualified', 'Score', 'Rank', 'Fit score']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('names the hard criteria that were not applied', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([SURVIVOR], {
        processing: {
          unsupportedHardCriteria: ['technology.requiredTechnologies (no source reports a stack)'],
        },
      }),
    );
    await search();

    expect(within(panel()).getByText(/Not applied, because nothing in the system/)).toBeTruthy();
  });

  it('says so when the run was not recorded', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([SURVIVOR], {
        processing: {
          persistence: { persisted: false, detail: 'The results could not be recorded.' },
        },
      }),
    );
    await search();

    expect(within(panel()).getByText('The results could not be recorded.')).toBeTruthy();
  });

  it('explains an empty survivor list rather than looking like a failed search', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([REJECTED], {
        processing: {
          survivors: [],
          rejected: mixedProcessing().rejected,
          counts: {
            received: 1,
            duplicatesRemoved: 0,
            companiesResolved: 1,
            suppressed: 0,
            hardFilterRejected: 1,
            unreachable: 0,
            survivors: 0,
            cold: 1,
          },
        },
      }),
    );
    await search();

    expect(
      await within(panel()).findByText('No one on this page passed the hard filters'),
    ).toBeTruthy();
  });
});
