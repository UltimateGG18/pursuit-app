import { memo } from 'react';
import {
  BUSINESS_PROBLEM_OPTIONS,
  CAPACITY_GAP_INDICATOR_OPTIONS,
  COMPLIANCE_FRAMEWORK_OPTIONS,
} from '@pursuit/shared';
import { MultiSelect } from '../../../components/form/controls.js';
import { FieldGrid } from '../../../components/ui/index.js';
import type { SectionProps } from './section-types.js';

function BusinessProblemsSectionImpl({
  value,
  onChange,
  errorsFor,
  disabled,
}: SectionProps<'businessProblems'>) {
  // Priority problems must be a subset of the selected problems, so the choices
  // narrow as soon as the problem list is set.
  const priorityOptions = BUSINESS_PROBLEM_OPTIONS.filter((option) =>
    value.problems.includes(option.value),
  );

  return (
    <FieldGrid>
      <MultiSelect
        path="businessProblems.problems"
        label="Business problems"
        hint="The problems this ICP exists to solve. Feeds the Need dimension."
        required
        values={value.problems}
        options={BUSINESS_PROBLEM_OPTIONS}
        errors={errorsFor('businessProblems.problems')}
        disabled={disabled}
        onChange={(problems) =>
          onChange({
            problems,
            // Drop priorities that are no longer selected problems.
            priorityProblems: value.priorityProblems.filter((problem) => problems.includes(problem)),
          })
        }
      />

      <MultiSelect
        path="businessProblems.priorityProblems"
        label="Priority problems (max 3)"
        hint={
          value.problems.length === 0
            ? 'Select business problems first.'
            : 'Weighted highest when the Need dimension is calculated.'
        }
        values={value.priorityProblems}
        options={priorityOptions}
        errors={errorsFor('businessProblems.priorityProblems')}
        disabled={disabled || value.problems.length === 0}
        columns={1}
        onChange={(priorityProblems) => onChange({ priorityProblems })}
      />

      <MultiSelect
        path="businessProblems.capacityGapIndicators"
        label="Capacity gap indicators"
        values={value.capacityGapIndicators}
        options={CAPACITY_GAP_INDICATOR_OPTIONS}
        errors={errorsFor('businessProblems.capacityGapIndicators')}
        disabled={disabled}
        onChange={(capacityGapIndicators) => onChange({ capacityGapIndicators })}
      />

      <MultiSelect
        path="businessProblems.complianceFrameworks"
        label="Compliance pressure"
        values={value.complianceFrameworks}
        options={COMPLIANCE_FRAMEWORK_OPTIONS}
        errors={errorsFor('businessProblems.complianceFrameworks')}
        disabled={disabled}
        onChange={(complianceFrameworks) => onChange({ complianceFrameworks })}
      />
    </FieldGrid>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const BusinessProblemsSection = memo(BusinessProblemsSectionImpl);
