import { memo } from 'react';
import {
  ICP_OBJECTIVE_OPTIONS,
  ICP_PRIORITY_OPTIONS,
  LANGUAGE_OPTIONS,
} from '@pursuit/shared';
import { MultiSelect, Select, TextArea, TextInput } from '../../../components/form/controls.js';
import { FieldGrid, FieldSpan } from '../../../components/ui/index.js';
import type { SectionProps } from './section-types.js';

function BasicProfileSectionImpl({
  value,
  onChange,
  errorsFor,
  disabled,
}: SectionProps<'basicProfile'>) {
  return (
    <FieldGrid>
      <TextInput
        path="basicProfile.name"
        label="ICP name"
        hint="Used as the unique identifier of this ICP across search runs."
        required
        maxLength={120}
        value={value.name}
        errors={errorsFor('basicProfile.name')}
        disabled={disabled}
        onChange={(name) => onChange({ name })}
      />

      <Select
        path="basicProfile.objective"
        label="Commercial objective"
        required
        value={value.objective}
        options={ICP_OBJECTIVE_OPTIONS}
        errors={errorsFor('basicProfile.objective')}
        disabled={disabled}
        onChange={(objective) => onChange({ objective })}
      />

      <Select
        path="basicProfile.priority"
        label="Priority"
        hint="Highest-priority ICP owns routing when an account matches several."
        required
        value={value.priority}
        options={ICP_PRIORITY_OPTIONS}
        errors={errorsFor('basicProfile.priority')}
        disabled={disabled}
        onChange={(priority) => onChange({ priority })}
      />

      <MultiSelect
        path="basicProfile.languages"
        label="Operating languages"
        hint="Feeds the language component of the ICP Fit dimension."
        required
        values={value.languages}
        options={LANGUAGE_OPTIONS}
        errors={errorsFor('basicProfile.languages')}
        disabled={disabled}
        columns={3}
        onChange={(languages) => onChange({ languages })}
      />

      <FieldSpan>
        <TextArea
          path="basicProfile.description"
          label="Description"
          hint="Internal note explaining who this ICP targets and why."
          rows={3}
          maxLength={2000}
          value={value.description ?? ''}
          errors={errorsFor('basicProfile.description')}
          disabled={disabled}
          onChange={(description) => onChange({ description })}
        />
      </FieldSpan>
    </FieldGrid>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const BasicProfileSection = memo(BasicProfileSectionImpl);
