import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IcpConfig } from '@pursuit/shared';

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
// The workspace reads an ICP's stored analyses when it opens. These tests are
// about the configuration form, so the history stays empty and nothing runs.
const analysisListMock = vi.fn();
const analysisRunMock = vi.fn();

vi.mock('../src/api/client.js', () => ({
  icpApi: {
    list: listMock,
    get: getMock,
    create: createMock,
    update: updateMock,
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
const { ICP_ID, ICP_NAME, emptyList, listOf, noAnalyses, profileDto, summaryDto } = await import(
  './fixtures.js'
);

/** Section headings carry the name only; the ordinal is a visual element. */
const SECTION_TITLES = [
  'Basic Profile',
  'Geography',
  'Company Profile',
  'Technology',
  'Services & Fit',
  'Business Problems',
  'Must / Nice / Exclude',
  'Triggers & Intent',
  'Target Buyer',
  'Evidence & Discovery',
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
  listMock.mockResolvedValue(emptyList());
  analysisListMock.mockResolvedValue(noAnalyses());
});

/**
 * Renders the application at a route. The selected ICP lives in the URL, so a
 * test that wants the create form asks for `#/icps/new` exactly the way a
 * refresh or a shared link would.
 */
async function renderAt(hash: string) {
  window.location.hash = hash;
  const utils = render(<App />);
  await waitFor(() => expect(listMock).toHaveBeenCalled());
  return utils;
}

const renderCreateForm = () => renderAt('#/icps/new');

/**
 * Picks a value from one of the custom select-only comboboxes: open the
 * trigger, then click the option in the listbox popup. Native `selectOptions`
 * does not apply - the control is a button plus a listbox, not a `<select>`.
 */
async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  comboboxName: string | RegExp,
  optionLabel: string,
) {
  await user.click(screen.getByLabelText(comboboxName));
  await user.click(await screen.findByRole('option', { name: optionLabel }));
}

describe('ICP form - rendering', () => {
  it('renders all ten sections', async () => {
    await renderCreateForm();

    for (const title of SECTION_TITLES) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('renders the rule builder buckets and the placeholder account selector', async () => {
    await renderCreateForm();

    expect(screen.getByRole('heading', { name: 'Must have' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nice to have' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Exclude' })).toBeInTheDocument();
    expect(screen.getAllByText('Placeholder').length).toBeGreaterThan(0);
  });

  it('lists every section in the section navigation', async () => {
    await renderCreateForm();

    const nav = screen.getByRole('navigation', { name: 'Form sections' });
    for (const title of SECTION_TITLES) {
      expect(within(nav).getByRole('link', { name: new RegExp(title, 'i') })).toBeInTheDocument();
    }
  });

  it('starts with no unsaved changes', async () => {
    await renderCreateForm();
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('offers a way back out of the form without scrolling to the save bar', async () => {
    await renderCreateForm();
    expect(screen.getByRole('button', { name: /All ICPs/ })).toBeInTheDocument();
  });

  /**
   * The route lives in the hash, so a section jump that let the browser follow
   * its fragment would replace the route and unmount the form mid-edit.
   */
  it('does not let a section jump overwrite the route', async () => {
    const user = userEvent.setup();
    await renderCreateForm();

    const nav = screen.getByRole('navigation', { name: 'Form sections' });
    const link = within(nav).getByRole('link', { name: /Geography/i });

    // Observed on the document, so it is read after React's own handler ran.
    let prevented: boolean | null = null;
    const spy = (event: Event): void => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener('click', spy);
    await user.click(link);
    document.removeEventListener('click', spy);

    expect(prevented).toBe(true);
    expect(window.location.hash).toBe('#/icps/new');
    expect(screen.getByRole('heading', { name: 'Create ICP' })).toBeInTheDocument();
  });
});

describe('ICP form - client-side validation', () => {
  it('blocks submission of the empty draft and shows inline errors', async () => {
    const user = userEvent.setup();
    await renderCreateForm();

    await user.click(screen.getByRole('button', { name: 'Create ICP' }));

    expect(createMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /validation issues before submitting/,
    );

    // Each message is rendered inline on the field it belongs to.
    const inSection = (name: string) => within(screen.getByRole('region', { name }));
    expect(
      inSection('Basic Profile').getByText('Name must be at least 3 characters'),
    ).toBeInTheDocument();
    expect(
      inSection('Geography').getByText('Select at least one target country'),
    ).toBeInTheDocument();
    expect(
      inSection('Must / Nice / Exclude').getByText(
        'Define at least one must-have rule; must-have rules are the hard filters',
      ),
    ).toBeInTheDocument();
  });

  it('marks an invalid field with aria-invalid', async () => {
    const user = userEvent.setup();
    await renderCreateForm();

    await user.click(screen.getByRole('button', { name: 'Create ICP' }));
    expect(screen.getByLabelText(/ICP name/)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ICP form - submission', () => {
  it('submits the loaded example and opens the new ICP workspace', async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({ ok: true, data: profileDto() });
    getMock.mockResolvedValue({ ok: true, data: profileDto() });
    await renderCreateForm();

    await user.click(screen.getByRole('button', { name: 'Load example' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create ICP' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const payload = createMock.mock.calls[0]![0] as { config: IcpConfig; status: string };
    expect(payload.status).toBe('ACTIVE');
    expect(payload.config.basicProfile.name).toBe(ICP_NAME);
    expect(payload.config.mustNiceExclude.mustHave).toHaveLength(2);

    expect(await screen.findByText(new RegExp(`Created "${ICP_NAME}" \\(version 1\\)`))).toBeInTheDocument();

    // The user lands on the workspace for the ICP they just created, with the
    // Analyze action in reach rather than at the bottom of the form.
    expect(await screen.findByRole('heading', { level: 1, name: ICP_NAME })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Analyze ICP' })).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/icps/${ICP_ID}`);
    expect(screen.queryByRole('heading', { name: 'Basic Profile' })).not.toBeInTheDocument();
  });

  it('sends the record status and change reason with the payload', async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({ ok: true, data: profileDto({ status: 'INACTIVE' }) });
    getMock.mockResolvedValue({ ok: true, data: profileDto({ status: 'INACTIVE' }) });
    await renderCreateForm();

    await user.click(screen.getByRole('button', { name: 'Load example' }));
    await chooseOption(user, 'Status', 'Inactive');
    await user.type(screen.getByLabelText(/Change reason/), 'Initial');
    await user.click(screen.getByRole('button', { name: 'Create ICP' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0]![0]).toMatchObject({
      status: 'INACTIVE',
      changeReason: 'Initial',
    });
  });

  it('maps server-side validation details onto the matching fields', async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The ICP payload is invalid',
        details: [
          { path: 'config.basicProfile.name', message: 'This name is already used by another ICP' },
        ],
      },
    });
    await renderCreateForm();

    await user.click(screen.getByRole('button', { name: 'Load example' }));
    await user.click(screen.getByRole('button', { name: 'Create ICP' }));

    // The message must land on the field itself, not only in the summary banner.
    const basicProfile = await screen.findByRole('region', { name: 'Basic Profile' });
    expect(
      await within(basicProfile).findByText('This name is already used by another ICP'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/ICP name/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('surfaces an API error that belongs to no field and keeps the draft', async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Could not reach the API at http://localhost:4000. Is the backend running?',
        details: [],
      },
    });
    await renderCreateForm();

    await user.click(screen.getByRole('button', { name: 'Load example' }));
    await user.click(screen.getByRole('button', { name: 'Create ICP' }));

    expect(await screen.findByText(/Could not reach the API at/)).toBeInTheDocument();
    // Still on the create form, so the work is not lost.
    expect(screen.getByRole('button', { name: 'Create ICP' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/icps/new');
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();
    let resolveCreate: (value: unknown) => void = () => {};
    createMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    getMock.mockResolvedValue({ ok: true, data: profileDto() });
    await renderCreateForm();

    await user.click(screen.getByRole('button', { name: 'Load example' }));
    await user.click(screen.getByRole('button', { name: 'Create ICP' }));

    const submitting = await screen.findByRole('button', { name: 'Saving…' });
    expect(submitting).toBeDisabled();

    resolveCreate({ ok: true, data: profileDto() });
    expect(await screen.findByRole('heading', { level: 1, name: ICP_NAME })).toBeInTheDocument();
  });
});

describe('ICP form - reset and leaving the form', () => {
  it('reset restores the loaded baseline', async () => {
    const user = userEvent.setup();
    await renderCreateForm();

    const nameInput = screen.getByLabelText(/ICP name/);
    await user.type(nameInput, 'Scratch ICP');
    expect(nameInput).toHaveValue('Scratch ICP');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText(/ICP name/)).toHaveValue('');
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });

  it('reset is disabled until something changes', async () => {
    const user = userEvent.setup();
    await renderCreateForm();

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    await user.type(screen.getByLabelText(/ICP name/), 'x');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
  });

  it('cancelling a create returns to the ICP list', async () => {
    const user = userEvent.setup();
    await renderCreateForm();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(window.location.hash).toBe('#/icps');
    expect(await screen.findByText('No ICPs yet')).toBeInTheDocument();
  });

  it('cancelling an edit returns to the ICP workspace', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(listOf([summaryDto()]));
    getMock.mockResolvedValue({ ok: true, data: profileDto() });
    await renderAt(`#/icps/${ICP_ID}/edit`);

    await user.click(await screen.findByRole('button', { name: 'Cancel edit' }));

    expect(window.location.hash).toBe(`#/icps/${ICP_ID}`);
    expect(await screen.findByRole('heading', { level: 1, name: ICP_NAME })).toBeInTheDocument();
  });
});

describe('ICP form - editing an existing ICP', () => {
  it('loads the stored configuration from the route', async () => {
    listMock.mockResolvedValue(listOf([summaryDto({ version: 3 })]));
    getMock.mockResolvedValue({ ok: true, data: profileDto({ version: 3 }) });
    await renderAt(`#/icps/${ICP_ID}/edit`);

    await waitFor(() => expect(getMock).toHaveBeenCalledWith(ICP_ID));
    expect(await screen.findByRole('heading', { name: 'Edit ICP' })).toBeInTheDocument();
    // The record under edit and its stored version are named in the subtitle.
    expect(screen.getByText(new RegExp(`Update the criteria for "${ICP_NAME}"`))).toBeInTheDocument();
    expect(screen.getByText(/leaves version 3 in the audit trail/)).toBeInTheDocument();
    expect(screen.getByLabelText(/ICP name/)).toHaveValue(ICP_NAME);
  });

  it('reaches the form from the workspace Edit action', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(listOf([summaryDto()]));
    getMock.mockResolvedValue({ ok: true, data: profileDto() });
    await renderAt(`#/icps/${ICP_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Edit ICP' }));

    expect(window.location.hash).toBe(`#/icps/${ICP_ID}/edit`);
    expect(await screen.findByRole('heading', { name: 'Edit ICP' })).toBeInTheDocument();
    expect(screen.getByLabelText(/ICP name/)).toHaveValue(ICP_NAME);
  });

  it('saves an edit through PUT and returns to the workspace', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(listOf([summaryDto()]));
    getMock.mockResolvedValue({ ok: true, data: profileDto() });
    updateMock.mockResolvedValue({ ok: true, data: profileDto({ version: 2 }) });
    await renderAt(`#/icps/${ICP_ID}/edit`);

    await screen.findByRole('button', { name: 'Save new version' });

    await user.clear(screen.getByLabelText(/Change reason/));
    await user.type(screen.getByLabelText(/Change reason/), 'Wider band');
    await user.click(screen.getByRole('button', { name: 'Save new version' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![0]).toBe(ICP_ID);
    expect(updateMock.mock.calls[0]![1]).toMatchObject({ changeReason: 'Wider band' });
    expect(createMock).not.toHaveBeenCalled();

    expect(await screen.findByText(/Saved .* as version 2/)).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/icps/${ICP_ID}`);
    expect(await screen.findByRole('heading', { level: 1, name: ICP_NAME })).toBeInTheDocument();
  });
});
