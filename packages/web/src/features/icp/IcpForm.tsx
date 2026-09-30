import { useMemo } from 'react';
import { ICP_STATUS_OPTIONS, type IcpConfig, type SelectOption } from '@pursuit/shared';
import { TextInput } from '../../components/form/controls.js';
import {
  Alert,
  Badge,
  Button,
  DotIcon,
  FormField,
  FormSection,
  SelectControl,
  XL_QUERY,
  describedBy,
  useMediaQuery,
} from '../../components/ui/index.js';
import { BasicProfileSection } from './sections/BasicProfileSection.js';
import { GeographySection } from './sections/GeographySection.js';
import { CompanyProfileSection } from './sections/CompanyProfileSection.js';
import { TechnologySection } from './sections/TechnologySection.js';
import { ServicesFitSection } from './sections/ServicesFitSection.js';
import { BusinessProblemsSection } from './sections/BusinessProblemsSection.js';
import { MustNiceExcludeSection } from './sections/MustNiceExcludeSection.js';
import { TriggersIntentSection } from './sections/TriggersIntentSection.js';
import { TargetBuyerSection } from './sections/TargetBuyerSection.js';
import { EvidenceDiscoverySection } from './sections/EvidenceDiscoverySection.js';
import { SECTION_ORDER } from './sections/section-types.js';
import { deriveSectionStatuses } from './sections/section-status.js';
import { SectionNav, SectionNavStrip } from './SectionNav.js';
import type { UseIcpForm } from './useIcpForm.js';

/** ARCHIVED is reached through the Archive action, never chosen in the form. */
const WRITABLE_STATUS_OPTIONS: readonly SelectOption<'ACTIVE' | 'INACTIVE'>[] =
  ICP_STATUS_OPTIONS.filter(
    (option): option is SelectOption<'ACTIVE' | 'INACTIVE'> => option.value !== 'ARCHIVED',
  );

export interface IcpFormProps {
  form: UseIcpForm;
  /** Called with the saved ICP's id, so the caller can open its workspace. */
  onSaved: (id: string) => void;
  /** Called when the user abandons the form. */
  onCancel: () => void;
}

export function IcpForm({ form, onSaved, onCancel }: IcpFormProps) {
  const {
    draft,
    meta,
    mode,
    status,
    editTarget,
    errors,
    formError,
    dirty,
    errorsFor,
    updateSection,
    updateMeta,
    submit,
    reset,
    loadExample,
  } = form;

  const busy = status !== 'idle';
  const submitting = status === 'submitting';
  const errorCount = Object.values(errors).reduce((total, messages) => total + messages.length, 0);
  const showRail = useMediaQuery(XL_QUERY);

  /**
   * Saving is the end of the form, not a step inside it: the caller moves the
   * user to the ICP workspace, so nobody is left at the bottom of ten sections
   * hunting for what to do next.
   */
  const handleSubmit = async (): Promise<void> => {
    const savedId = await submit();
    if (savedId !== null) onSaved(savedId);
  };

  const sectionStatuses = useMemo(() => deriveSectionStatuses(draft, errors), [draft, errors]);
  const issuesBySection = useMemo(
    () => new Map(sectionStatuses.map((entry) => [entry.section.id, entry.issueCount])),
    [sectionStatuses],
  );

  // Stable per-section change handlers, so a memoized section only re-renders
  // when its own slice of the draft or its own errors change.
  const onSectionChange = useMemo(
    () => ({
      basicProfile: (patch: Partial<IcpConfig['basicProfile']>) =>
        updateSection('basicProfile', patch),
      geography: (patch: Partial<IcpConfig['geography']>) => updateSection('geography', patch),
      companyProfile: (patch: Partial<IcpConfig['companyProfile']>) =>
        updateSection('companyProfile', patch),
      technology: (patch: Partial<IcpConfig['technology']>) => updateSection('technology', patch),
      servicesFit: (patch: Partial<IcpConfig['servicesFit']>) => updateSection('servicesFit', patch),
      businessProblems: (patch: Partial<IcpConfig['businessProblems']>) =>
        updateSection('businessProblems', patch),
      mustNiceExclude: (patch: Partial<IcpConfig['mustNiceExclude']>) =>
        updateSection('mustNiceExclude', patch),
      triggersIntent: (patch: Partial<IcpConfig['triggersIntent']>) =>
        updateSection('triggersIntent', patch),
      targetBuyer: (patch: Partial<IcpConfig['targetBuyer']>) => updateSection('targetBuyer', patch),
      evidenceDiscovery: (patch: Partial<IcpConfig['evidenceDiscovery']>) =>
        updateSection('evidenceDiscovery', patch),
    }),
    [updateSection],
  );

  // The ten section cards only depend on the draft, the errors and the busy
  // flag. Memoizing them keeps edits to the record settings (status, change
  // reason) from re-rendering every option list in the form.
  const sectionCards = useMemo(() => {
    const issueCount = (id: string): number => issuesBySection.get(id) ?? 0;
    return (
      <>
        <FormSection {...SECTION_ORDER[0]!} issueCount={issueCount('basic-profile')}>
          <BasicProfileSection
            value={draft.basicProfile}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.basicProfile}
          />
        </FormSection>

        <FormSection {...SECTION_ORDER[1]!} issueCount={issueCount('geography')}>
          <GeographySection
            value={draft.geography}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.geography}
          />
        </FormSection>

        <FormSection {...SECTION_ORDER[2]!} issueCount={issueCount('company-profile')}>
          <CompanyProfileSection
            value={draft.companyProfile}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.companyProfile}
          />
        </FormSection>

        <FormSection {...SECTION_ORDER[3]!} issueCount={issueCount('technology')}>
          <TechnologySection
            value={draft.technology}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.technology}
          />
        </FormSection>

        <FormSection {...SECTION_ORDER[4]!} issueCount={issueCount('services-fit')}>
          <ServicesFitSection
            value={draft.servicesFit}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.servicesFit}
          />
        </FormSection>

        <FormSection {...SECTION_ORDER[5]!} issueCount={issueCount('business-problems')}>
          <BusinessProblemsSection
            value={draft.businessProblems}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.businessProblems}
          />
        </FormSection>

        <FormSection {...SECTION_ORDER[6]!} issueCount={issueCount('must-nice-exclude')}>
          <MustNiceExcludeSection
            value={draft.mustNiceExclude}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.mustNiceExclude}
          />
        </FormSection>

        <FormSection {...SECTION_ORDER[7]!} issueCount={issueCount('triggers-intent')}>
          <TriggersIntentSection
            value={draft.triggersIntent}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.triggersIntent}
          />
        </FormSection>

        <FormSection {...SECTION_ORDER[8]!} issueCount={issueCount('target-buyer')}>
          <TargetBuyerSection
            value={draft.targetBuyer}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.targetBuyer}
          />
        </FormSection>

        <FormSection {...SECTION_ORDER[9]!} issueCount={issueCount('evidence-discovery')}>
          <EvidenceDiscoverySection
            value={draft.evidenceDiscovery}
            errorsFor={errorsFor}
            disabled={busy}
            onChange={onSectionChange.evidenceDiscovery}
          />
        </FormSection>
      </>
    );
  }, [draft, errorsFor, busy, onSectionChange, issuesBySection]);

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      {/* --- page header --------------------------------------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {/* Leaving is always one click, at the top, whichever section the
              user has scrolled to. */}
          <button
            className="text-xs font-medium text-ink-muted transition-colors hover:text-ink"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            &larr; {mode === 'edit' && editTarget ? editTarget.name : 'All ICPs'}
          </button>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold leading-7 tracking-[-0.01em] text-ink sm:text-2xl">
              {mode === 'edit' ? 'Edit ICP' : 'Create ICP'}
            </h1>
            {mode === 'edit' && editTarget ? (
              <Badge tone="outline" className="pu-numeric">
                v{editTarget.version}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-6 text-ink-muted">
            {mode === 'edit' && editTarget
              ? `Update the criteria for "${editTarget.name}". Saving appends a new version and leaves version ${editTarget.version} in the audit trail.`
              : 'Define the companies PURSUIT should prioritize. Ten sections make up the criteria object the discovery pipeline runs on.'}
          </p>
        </div>

        {/* Negative margin optically aligns the ghost button's label with the
            heading above it once the header wraps to two rows. */}
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2.5 sm:ml-0"
          disabled={busy}
          onClick={loadExample}
        >
          Load example
        </Button>
      </header>

      {status === 'loading' ? <Alert tone="info" title="Loading ICP…" role="status" /> : null}

      {formError ? (
        <Alert tone="error" role="alert" title="Unable to save ICP">
          <p>{formError.message}</p>
          {/* The per-field messages are rendered on the fields themselves, so
              the summary only has to say where to look. */}
          {formError.code === 'VALIDATION_ERROR' ? (
            <p className="mt-1 opacity-80">Please check the highlighted fields and try again.</p>
          ) : (
            <p className="mt-1 opacity-80">Error code: {formError.code}</p>
          )}
        </Alert>
      ) : null}

      {/* --- section navigation + cards ------------------------------------ */}
      <div className="grid min-w-0 gap-6 xl:grid-cols-[13rem_minmax(0,1fr)]">
        {showRail ? (
          <div className="sticky top-24 min-w-0 self-start">
            <SectionNav statuses={sectionStatuses} />
          </div>
        ) : (
          // Two guards keep the strip from widening the page: `min-w-0` stops
          // the grid track from being sized to the nav's min-content, and
          // `overflow-hidden` stops the scroller's layout overflow from
          // propagating to the viewport - the inner `overflow-x-auto` clips
          // visually but the page still gains a horizontal scrollbar without
          // a clipping box here.
          <div className="sticky top-16 z-20 min-w-0 overflow-hidden rounded-control border border-line bg-canvas/95 px-3 py-2 backdrop-blur">
            <SectionNavStrip statuses={sectionStatuses} />
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-5">
          {sectionCards}

          {/* --- record settings -------------------------------------------- */}
          <section
            aria-labelledby="record-title"
            className="scroll-mt-24 rounded-card border border-line bg-surface shadow-card"
          >
            <header className="px-5 py-4 sm:px-6 sm:py-5">
              <h3 className="text-[15px] font-semibold leading-6 text-ink" id="record-title">
                Record settings
              </h3>
              <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
                Stored alongside the configuration. Scoring weights use the plan defaults
                (20/15/20/20/10/10/5) until a weights editor is built.
              </p>
            </header>

            <div className="grid grid-cols-1 items-start gap-x-6 gap-y-5 border-t border-line px-5 py-5 sm:px-6 sm:py-6 md:grid-cols-2">
              <FormField
                path="record.status"
                label="Status"
                hint="Only active ICPs are picked up by a search run."
              >
                <SelectControl
                  id="record.status"
                  labelledBy="record.status-label"
                  describedBy={describedBy('record.status', true, false)}
                  value={meta.status}
                  options={WRITABLE_STATUS_OPTIONS}
                  disabled={busy}
                  onChange={(next) => updateMeta({ status: next })}
                />
              </FormField>

              <TextInput
                path="record.changeReason"
                label="Change reason"
                hint="Recorded with this version for the audit trail."
                maxLength={280}
                value={meta.changeReason}
                disabled={busy}
                onChange={(changeReason) => updateMeta({ changeReason })}
              />
            </div>
          </section>

          {/* --- save bar ---------------------------------------------------- */}
          {/* Below `sm` the bar is fixed: the stacked layout puts the form
              column far enough down the page that a sticky bar would be
              clamped to the top of its containing block and start off-screen.
              From `sm` up it docks inside the column as a normal sticky bar. */}
          <footer className="z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-bar backdrop-blur max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 sm:sticky sm:bottom-0 sm:rounded-card sm:border">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <p
                className="flex min-w-0 items-center gap-2 text-xs"
                aria-live="polite"
                aria-atomic="true"
              >
                {errorCount > 0 ? (
                  <>
                    <DotIcon className="h-1.5 w-1.5 flex-none text-critical-600" />
                    <span className="font-medium text-critical-600">
                      {errorCount} validation {errorCount === 1 ? 'issue' : 'issues'}
                    </span>
                  </>
                ) : submitting ? (
                  <span className="text-ink-muted">Saving changes…</span>
                ) : dirty ? (
                  <>
                    <DotIcon className="h-1.5 w-1.5 flex-none text-brand-500" />
                    <span className="font-medium text-ink-soft">Unsaved changes</span>
                  </>
                ) : (
                  <span className="text-ink-muted">No unsaved changes</span>
                )}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" disabled={busy || !dirty} onClick={reset}>
                  Reset
                </Button>
                <Button variant="secondary" disabled={busy} onClick={onCancel}>
                  {mode === 'edit' ? 'Cancel edit' : 'Cancel'}
                </Button>
                <Button type="submit" variant="primary" loading={submitting} disabled={busy}>
                  {submitting ? 'Saving…' : mode === 'edit' ? 'Save new version' : 'Create ICP'}
                </Button>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </form>
  );
}
