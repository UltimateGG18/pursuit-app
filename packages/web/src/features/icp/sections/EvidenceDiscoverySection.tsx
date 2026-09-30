import { memo } from 'react';
import {
  CORROBORATION_MAX,
  CORROBORATION_MIN,
  DISCOVERY_STRATEGY_OPTIONS,
  EVIDENCE_DIRECTNESS_OPTIONS,
  EVIDENCE_FRESHNESS_DAYS_MAX,
  EVIDENCE_FRESHNESS_DAYS_MIN,
  SOURCE_RELIABILITY_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from '@pursuit/shared';
import { MultiSelect, Select, Slider } from '../../../components/form/controls.js';
import { AccountSelector } from '../../../components/form/AccountSelector.js';
import { KeywordGroupEditor } from '../../../components/form/KeywordGroupEditor.js';
import { FieldGrid, FormSubsection } from '../../../components/ui/index.js';
import type { SectionProps } from './section-types.js';

function EvidenceDiscoverySectionImpl({
  value,
  onChange,
  errorsFor,
  disabled,
}: SectionProps<'evidenceDiscovery'>) {
  const usesLookAlike = value.discoveryStrategies.includes('LOOK_ALIKE');
  const usesSemantic = value.discoveryStrategies.includes('SEMANTIC');

  return (
    <div className="flex flex-col gap-6">
      <FieldGrid>
        <MultiSelect
          path="evidenceDiscovery.discoveryStrategies"
          label="Discovery strategies"
          hint="Firmographic is the P0 strategy; the others are enabled as their data sources land."
          required
          values={value.discoveryStrategies}
          options={DISCOVERY_STRATEGY_OPTIONS}
          errors={errorsFor('evidenceDiscovery.discoveryStrategies')}
          disabled={disabled}
          onChange={(discoveryStrategies) => onChange({ discoveryStrategies })}
        />

        <MultiSelect
          path="evidenceDiscovery.allowedSourceTypes"
          label="Allowed evidence sources"
          required
          values={value.allowedSourceTypes}
          options={SOURCE_TYPE_OPTIONS}
          errors={errorsFor('evidenceDiscovery.allowedSourceTypes')}
          disabled={disabled}
          onChange={(allowedSourceTypes) => onChange({ allowedSourceTypes })}
        />

        <Select
          path="evidenceDiscovery.minimumSourceReliability"
          label="Minimum source reliability"
          value={value.minimumSourceReliability}
          options={SOURCE_RELIABILITY_OPTIONS}
          errors={errorsFor('evidenceDiscovery.minimumSourceReliability')}
          disabled={disabled}
          onChange={(minimumSourceReliability) => onChange({ minimumSourceReliability })}
        />

        <Select
          path="evidenceDiscovery.requiredDirectness"
          label="Required directness"
          hint="How directly a source must support a claim before it can affect the score."
          value={value.requiredDirectness}
          options={EVIDENCE_DIRECTNESS_OPTIONS}
          errors={errorsFor('evidenceDiscovery.requiredDirectness')}
          disabled={disabled}
          onChange={(requiredDirectness) => onChange({ requiredDirectness })}
        />

        <Slider
          path="evidenceDiscovery.evidenceFreshnessDays"
          label="Evidence freshness"
          hint="Evidence older than this is queued for re-research instead of being trusted."
          min={EVIDENCE_FRESHNESS_DAYS_MIN}
          max={EVIDENCE_FRESHNESS_DAYS_MAX}
          step={5}
          unit="days"
          value={value.evidenceFreshnessDays}
          errors={errorsFor('evidenceDiscovery.evidenceFreshnessDays')}
          disabled={disabled}
          onChange={(evidenceFreshnessDays) => onChange({ evidenceFreshnessDays })}
        />

        <Slider
          path="evidenceDiscovery.minimumCorroborationCount"
          label="Minimum corroborating sources"
          min={CORROBORATION_MIN}
          max={CORROBORATION_MAX}
          unit="sources"
          value={value.minimumCorroborationCount}
          errors={errorsFor('evidenceDiscovery.minimumCorroborationCount')}
          disabled={disabled}
          onChange={(minimumCorroborationCount) => onChange({ minimumCorroborationCount })}
        />
      </FieldGrid>

      <FormSubsection
        title="Target accounts"
        description="Reference and suppression lists. Both capture the account shape the CRM adapter will return."
        tone="brand"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <AccountSelector
            path="evidenceDiscovery.lookAlikeAccounts"
            label="Look-alike reference accounts"
            required={usesLookAlike}
            hint={
              usesLookAlike
                ? 'Required because the look-alike strategy is enabled.'
                : 'Only used when the look-alike strategy is enabled.'
            }
            selected={value.lookAlikeAccounts}
            errors={errorsFor('evidenceDiscovery.lookAlikeAccounts')}
            disabled={disabled}
            emptyLabel="No reference accounts selected"
            onChange={(lookAlikeAccounts) => onChange({ lookAlikeAccounts })}
          />

          <AccountSelector
            path="evidenceDiscovery.suppressedAccounts"
            label="Suppressed accounts"
            hint="Existing customers, open deals and do-not-contact accounts."
            selected={value.suppressedAccounts}
            errors={errorsFor('evidenceDiscovery.suppressedAccounts')}
            disabled={disabled}
            emptyLabel="No accounts suppressed"
            onChange={(suppressedAccounts) => onChange({ suppressedAccounts })}
          />
        </div>
      </FormSubsection>

      <FormSubsection
        title="Keyword groups"
        required={usesSemantic}
        description="Normalized terms and synonyms for the semantic discovery strategy. No model is involved - matching is deterministic text similarity."
        tone="brand"
      >
        <KeywordGroupEditor
          path="evidenceDiscovery.keywordGroups"
          groups={value.keywordGroups}
          errorsFor={errorsFor}
          disabled={disabled}
          onChange={(keywordGroups) => onChange({ keywordGroups })}
        />
      </FormSubsection>
    </div>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const EvidenceDiscoverySection = memo(EvidenceDiscoverySectionImpl);
