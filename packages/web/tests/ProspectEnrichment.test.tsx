import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnrichedProspect } from '@pursuit/shared';

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
const {
  ICP_ID,
  enrichedProspect,
  enrichmentResult,
  listOf,
  noAnalyses,
  personCandidate,
  profileDto,
  prospectRun,
  summaryDto,
} = await import('./fixtures.js');

/**
 * Contact details, as a reader sees them.
 *
 * Every assertion here is a variation on one rule: the screen says exactly what
 * the provider returned, and says plainly when it returned nothing. A UI that
 * renders a missing phone number as a dash, or invents a LinkedIn URL from a
 * name, turns an honest gap into a claim - and the reader has no way to tell.
 */

const ALL_CHANNELS = personCandidate();
const LINKEDIN_ONLY = personCandidate({
  name: 'Bram Janssen',
  rawSourceRef: 'apollo:person:linkedin-only',
  linkedinUrl: 'https://www.linkedin.com/in/bram-janssen',
});
const NOTHING = personCandidate({
  name: 'Lieke Bakker',
  rawSourceRef: 'apollo:person:no-match',
  linkedinUrl: undefined,
});

function runWith(prospects: EnrichedProspect[], people = [ALL_CHANNELS]) {
  return prospectRun(people, {
    processing: { enrichment: enrichmentResult(prospects) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
  listMock.mockResolvedValue(listOf([summaryDto()]));
  getMock.mockResolvedValue({ ok: true, data: profileDto() });
  analysisListMock.mockResolvedValue(noAnalyses());
  prospectSearchMock.mockResolvedValue(
    runWith([
      enrichedProspect(ALL_CHANNELS.rawSourceRef, { linkedin: true, email: true, phone: true }),
    ]),
  );
});

const panel = () => screen.getByRole('region', { name: 'Matching prospects' });

async function search() {
  window.location.hash = `#/icps/${ICP_ID}/prospects`;
  render(<App />);
  await waitFor(() => expect(listMock).toHaveBeenCalled());
  await userEvent.click(await screen.findByRole('button', { name: 'Find matching leads' }));
  await waitFor(() => expect(prospectSearchMock).toHaveBeenCalled());
}

describe('enriched prospects - the contact details', () => {
  it('shows the work email the provider returned, as a mailto link', async () => {
    await search();

    const email = await within(panel()).findByRole('link', {
      name: 'sanne.de.vries@example.com',
    });
    expect(email.getAttribute('href')).toBe('mailto:sanne.de.vries@example.com');
  });

  it('shows the phone number and the provider\'s own type label', async () => {
    await search();

    expect(await within(panel()).findByText('+31205550142')).toBeTruthy();
    // Apollo's label, shown as sent. Nothing maps `mobile` onto a word we made up.
    expect(within(panel()).getAllByText('Mobile').length).toBeGreaterThan(0);
  });

  it('links the LinkedIn profile safely, in a new tab', async () => {
    await search();

    const profile = await within(panel()).findByRole('link', { name: 'View profile' });
    expect(profile.getAttribute('href')).toBe('https://www.linkedin.com/in/sanne-de-vries');
    expect(profile.getAttribute('target')).toBe('_blank');
    expect(profile.getAttribute('rel')).toContain('noopener');
    expect(profile.getAttribute('rel')).toContain('noreferrer');
  });

  it('shows the enrichment status and the identification confidence', async () => {
    await search();

    expect(await within(panel()).findByText('Enriched')).toBeTruthy();
    // Labelled as a *match*, never as prospect quality.
    expect(within(panel()).getByText('Match: High')).toBeTruthy();
  });
});

describe('enriched prospects - missing channels', () => {
  beforeEach(() => {
    prospectSearchMock.mockResolvedValue(
      runWith(
        [enrichedProspect(LINKEDIN_ONLY.rawSourceRef, { linkedin: true })],
        [LINKEDIN_ONLY],
      ),
    );
  });

  it('says a missing email is not available rather than showing a placeholder', async () => {
    await search();

    const row = (await within(panel()).findAllByRole('listitem'))[0];
    expect(row?.textContent).toContain('Not available');
    // The three things a reader must never see where a value belongs.
    expect(row?.textContent).not.toContain('undefined');
    expect(row?.textContent).not.toContain('null');
    expect(row?.textContent).not.toContain('[object Object]');
  });

  it('never invents an email address from the name and the company domain', async () => {
    await search();

    expect(within(panel()).queryByText(/@voorbeeld-software\.nl/)).toBeNull();
  });

  it('still treats a LinkedIn-only prospect as reachable', async () => {
    await search();

    // A prospect with one channel is fully reachable on that channel. There is
    // no "weak contact" band here, and there must not be.
    expect(await within(panel()).findByText('Reachable on LinkedIn')).toBeTruthy();
  });

  it('distinguishes a pending phone reveal from a number the provider lacks', async () => {
    const pending = enrichedProspect(LINKEDIN_ONLY.rawSourceRef, { linkedin: true });
    prospectSearchMock.mockResolvedValue(
      runWith(
        [{ ...pending, contact: { ...pending.contact, phoneState: 'PENDING' as const } }],
        [LINKEDIN_ONLY],
      ),
    );
    await search();

    // Phone reveal is asynchronous, so "still being fetched" and "there is no
    // number" are different facts that must not render identically.
    expect(await within(panel()).findByText('Phone enrichment pending')).toBeTruthy();
  });
});

describe('enriched prospects - statuses that are not a failure', () => {
  it('shows a no-match with the reason the backend gave', async () => {
    prospectSearchMock.mockResolvedValue(
      runWith(
        [
          {
            ...enrichedProspect(NOTHING.rawSourceRef),
            person: {},
            contact: { phoneNumbers: [], phoneState: 'NONE' as const },
            enrichment: {
              status: 'NO_MATCH' as const,
              matchConfidence: 'none' as const,
              provider: 'apollo',
              detail: 'The contact data provider could not confidently identify this person.',
            },
            reachability: {
              hasLinkedIn: false,
              hasWorkEmail: false,
              hasPhone: false,
              channels: [],
            },
          },
        ],
        [NOTHING],
      ),
    );
    await search();

    expect(await within(panel()).findByText('No match')).toBeTruthy();
    expect(
      within(panel()).getByText(/could not confidently identify this person/),
    ).toBeTruthy();
  });

  it('surfaces a plan restriction as an actionable, provider-neutral note', async () => {
    const unavailable = enrichedProspect(ALL_CHANNELS.rawSourceRef);
    prospectSearchMock.mockResolvedValue(
      prospectRun([ALL_CHANNELS], {
        processing: {
          enrichment: enrichmentResult(
            [
              {
                ...unavailable,
                person: {},
                contact: { phoneNumbers: [], phoneState: 'NOT_REQUESTED' as const },
                enrichment: {
                  status: 'UNAVAILABLE' as const,
                  provider: 'apollo',
                  detail:
                    'Contact enrichment is not available for the current provider account.',
                },
                reachability: {
                  hasLinkedIn: false,
                  hasWorkEmail: false,
                  hasPhone: false,
                  channels: [],
                },
              },
            ],
            { detail: 'Contact enrichment is not available for the current provider account.' },
          ),
        },
      }),
    );
    await search();

    expect(await within(panel()).findByText('Enrichment unavailable')).toBeTruthy();
    // The frontend holds no credential and must never name the vendor to configure.
    expect(panel().textContent?.toLowerCase()).not.toContain('apollo_api_key');
  });
});

describe('enriched prospects - contact channel filters', () => {
  beforeEach(() => {
    prospectSearchMock.mockResolvedValue(
      runWith(
        [
          enrichedProspect(ALL_CHANNELS.rawSourceRef, {
            linkedin: true,
            email: true,
            phone: true,
          }),
          enrichedProspect(LINKEDIN_ONLY.rawSourceRef, { linkedin: true }),
        ],
        [ALL_CHANNELS, LINKEDIN_ONLY],
      ),
    );
  });

  it('counts each channel independently, so the counts overlap', async () => {
    await search();

    expect(await within(panel()).findByRole('button', { name: /LinkedIn 2/ })).toBeTruthy();
    expect(within(panel()).getByRole('button', { name: /Email 1/ })).toBeTruthy();
    expect(within(panel()).getByRole('button', { name: /Phone 1/ })).toBeTruthy();
  });

  it('narrows the list to the people carrying that channel', async () => {
    await search();
    await userEvent.click(await screen.findByRole('button', { name: /Email 1/ }));

    expect(within(panel()).getByText('Sanne de Vries')).toBeTruthy();
    expect(within(panel()).queryByText('Bram Janssen')).toBeNull();
  });

  it('offers no quality or ranking filter, because nothing here scores a person', async () => {
    await search();

    const buttons = within(panel())
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
      .join(' ');
    expect(buttons).not.toMatch(/best|top prospects|high quality|low quality/i);
  });

  it('explains an empty channel filter as a data gap, not a failed search', async () => {
    prospectSearchMock.mockResolvedValue(
      runWith(
        [enrichedProspect(LINKEDIN_ONLY.rawSourceRef, { linkedin: true })],
        [LINKEDIN_ONLY],
      ),
    );
    await search();
    await userEvent.click(await screen.findByRole('button', { name: /Phone 0/ }));

    expect(
      await within(panel()).findByText('No one on this page has that contact channel'),
    ).toBeTruthy();
  });
});

describe('enriched prospects - the run summary', () => {
  it('reports the funnel as counts, with no completeness score', async () => {
    await search();

    expect(await within(panel()).findByText(/Contact enrichment:/)).toBeTruthy();
    // Several elements say "reachable on ..." - the run summary and each row -
    // which is the point: the per-person channels and the run total are the
    // same fact at two scales, and neither is a grade.
    expect(within(panel()).getAllByText(/Reachable on LinkedIn/).length).toBeGreaterThan(0);
    expect(panel().textContent).not.toMatch(/complete|quality score|%/i);
  });

  it('says when phone reveal was not requested, so no numbers is not misread', async () => {
    prospectSearchMock.mockResolvedValue(
      prospectRun([ALL_CHANNELS], {
        processing: {
          enrichment: enrichmentResult(
            [enrichedProspect(ALL_CHANNELS.rawSourceRef, { linkedin: true, email: true })],
            { phoneRevealRequested: false },
          ),
        },
      }),
    );
    await search();

    expect(
      await within(panel()).findByText(/phone reveal not requested for this run/),
    ).toBeTruthy();
  });

  it('shows nothing about enrichment when the stage did not run', async () => {
    prospectSearchMock.mockResolvedValue(prospectRun([ALL_CHANNELS]));
    await search();

    // Reporting the absence of a *stage* as a fact about each *person* is
    // exactly the lie this slice exists to avoid.
    await within(panel()).findByText('Sanne de Vries');
    expect(within(panel()).queryByText(/Contact enrichment:/)).toBeNull();
    expect(within(panel()).queryByRole('button', { name: /Email 0/ })).toBeNull();
  });
});
