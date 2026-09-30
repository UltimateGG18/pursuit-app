import { memo } from 'react';
import { COUNTRY_OPTIONS, LOCATION_SCOPE_OPTIONS, REGION_OPTIONS } from '@pursuit/shared';
import { MultiSelect, Select } from '../../../components/form/controls.js';
import { FieldGrid } from '../../../components/ui/index.js';
import type { SectionProps } from './section-types.js';

function GeographySectionImpl({ value, onChange, errorsFor, disabled }: SectionProps<'geography'>) {
  return (
    <FieldGrid>
      <MultiSelect
        path="geography.regions"
        label="Regions"
        hint="Coarse grouping used for reporting and discovery batching."
        values={value.regions}
        options={REGION_OPTIONS}
        errors={errorsFor('geography.regions')}
        disabled={disabled}
        onChange={(regions) => onChange({ regions })}
      />

      <Select
        path="geography.locationScope"
        label="Which location must match"
        required
        value={value.locationScope}
        options={LOCATION_SCOPE_OPTIONS}
        errors={errorsFor('geography.locationScope')}
        disabled={disabled}
        onChange={(locationScope) => onChange({ locationScope })}
      />

      <MultiSelect
        path="geography.includedCountries"
        label="Target countries"
        required
        values={value.includedCountries}
        options={COUNTRY_OPTIONS}
        errors={errorsFor('geography.includedCountries')}
        disabled={disabled}
        columns={3}
        onChange={(includedCountries) => onChange({ includedCountries })}
      />

      <MultiSelect
        path="geography.excludedCountries"
        label="Excluded countries"
        hint="Applied as a suppression rule, never as a scoring penalty."
        values={value.excludedCountries}
        options={COUNTRY_OPTIONS}
        errors={errorsFor('geography.excludedCountries')}
        disabled={disabled}
        columns={3}
        onChange={(excludedCountries) => onChange({ excludedCountries })}
      />
    </FieldGrid>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const GeographySection = memo(GeographySectionImpl);
