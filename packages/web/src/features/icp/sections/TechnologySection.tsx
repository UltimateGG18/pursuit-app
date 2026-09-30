import { memo } from 'react';
import {
  CLOUD_PROVIDER_OPTIONS,
  LEGACY_INDICATOR_OPTIONS,
  TECHNOLOGY_MATURITY_OPTIONS,
  TECHNOLOGY_OPTIONS,
} from '@pursuit/shared';
import { MultiSelect } from '../../../components/form/controls.js';
import { FieldGrid } from '../../../components/ui/index.js';
import type { SectionProps } from './section-types.js';

function TechnologySectionImpl({ value, onChange, errorsFor, disabled }: SectionProps<'technology'>) {
  return (
    <FieldGrid>
      <MultiSelect
        path="technology.requiredTechnologies"
        label="Required technologies"
        hint="Only turn these into hard filters in section 7 if the account is genuinely unqualified without them."
        values={value.requiredTechnologies}
        options={TECHNOLOGY_OPTIONS}
        errors={errorsFor('technology.requiredTechnologies')}
        disabled={disabled}
        onChange={(requiredTechnologies) => onChange({ requiredTechnologies })}
      />

      <MultiSelect
        path="technology.preferredTechnologies"
        label="Preferred technologies"
        values={value.preferredTechnologies}
        options={TECHNOLOGY_OPTIONS}
        errors={errorsFor('technology.preferredTechnologies')}
        disabled={disabled}
        onChange={(preferredTechnologies) => onChange({ preferredTechnologies })}
      />

      <MultiSelect
        path="technology.excludedTechnologies"
        label="Excluded technologies"
        values={value.excludedTechnologies}
        options={TECHNOLOGY_OPTIONS}
        errors={errorsFor('technology.excludedTechnologies')}
        disabled={disabled}
        onChange={(excludedTechnologies) => onChange({ excludedTechnologies })}
      />

      <MultiSelect
        path="technology.technologyMaturities"
        label="Technology maturity"
        values={value.technologyMaturities}
        options={TECHNOLOGY_MATURITY_OPTIONS}
        errors={errorsFor('technology.technologyMaturities')}
        disabled={disabled}
        columns={1}
        onChange={(technologyMaturities) => onChange({ technologyMaturities })}
      />

      <MultiSelect
        path="technology.cloudProviders"
        label="Cloud providers"
        values={value.cloudProviders}
        options={CLOUD_PROVIDER_OPTIONS}
        errors={errorsFor('technology.cloudProviders')}
        disabled={disabled}
        columns={1}
        onChange={(cloudProviders) => onChange({ cloudProviders })}
      />

      <MultiSelect
        path="technology.legacyIndicators"
        label="Legacy indicators"
        hint="Structural markers; these feed the Need dimension and do not decay."
        values={value.legacyIndicators}
        options={LEGACY_INDICATOR_OPTIONS}
        errors={errorsFor('technology.legacyIndicators')}
        disabled={disabled}
        onChange={(legacyIndicators) => onChange({ legacyIndicators })}
      />
    </FieldGrid>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const TechnologySection = memo(TechnologySectionImpl);
