import { memo } from 'react';
import {
  BUSINESS_MODEL_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  CURRENCY_OPTIONS,
  INDUSTRY_OPTIONS,
  MATURITY_STAGE_OPTIONS,
} from '@pursuit/shared';
import { MultiSelect, NumberRange, Select } from '../../../components/form/controls.js';
import { FieldGrid } from '../../../components/ui/index.js';
import type { SectionProps } from './section-types.js';

function CompanyProfileSectionImpl({
  value,
  onChange,
  errorsFor,
  disabled,
}: SectionProps<'companyProfile'>) {
  return (
    <FieldGrid>
      <MultiSelect
        path="companyProfile.industries"
        label="Target industries"
        required
        values={value.industries}
        options={INDUSTRY_OPTIONS}
        errors={errorsFor('companyProfile.industries')}
        disabled={disabled}
        onChange={(industries) => onChange({ industries })}
      />

      <MultiSelect
        path="companyProfile.excludedIndustries"
        label="Excluded industries"
        values={value.excludedIndustries}
        options={INDUSTRY_OPTIONS}
        errors={errorsFor('companyProfile.excludedIndustries')}
        disabled={disabled}
        onChange={(excludedIndustries) => onChange({ excludedIndustries })}
      />

      <NumberRange
        path="companyProfile.employeeRange"
        label="Employee count"
        hint="Leave a side empty for an open-ended range. Missing data stays UNKNOWN, it does not reject."
        min={value.employeeRange.min}
        max={value.employeeRange.max}
        bounds={{ min: 0, max: 1000000 }}
        unit="employees"
        errors={errorsFor('companyProfile.employeeRange')}
        minErrors={errorsFor('companyProfile.employeeRange.min')}
        maxErrors={errorsFor('companyProfile.employeeRange.max')}
        disabled={disabled}
        onChange={(employeeRange) => onChange({ employeeRange })}
      />

      <div className="flex flex-col gap-5">
        <NumberRange
          path="companyProfile.revenueRange"
          label="Annual revenue"
          min={value.revenueRange.min}
          max={value.revenueRange.max}
          bounds={{ min: 0, max: 100000000000 }}
          step={1000}
          errors={errorsFor('companyProfile.revenueRange')}
          minErrors={errorsFor('companyProfile.revenueRange.min')}
          maxErrors={errorsFor('companyProfile.revenueRange.max')}
          disabled={disabled}
          onChange={(range) => onChange({ revenueRange: { ...value.revenueRange, ...range } })}
        />
        <Select
          path="companyProfile.revenueRange.currency"
          label="Revenue currency"
          value={value.revenueRange.currency}
          options={CURRENCY_OPTIONS}
          errors={errorsFor('companyProfile.revenueRange.currency')}
          disabled={disabled}
          onChange={(currency) => onChange({ revenueRange: { ...value.revenueRange, currency } })}
        />
      </div>

      <MultiSelect
        path="companyProfile.businessModels"
        label="Business models"
        required
        values={value.businessModels}
        options={BUSINESS_MODEL_OPTIONS}
        errors={errorsFor('companyProfile.businessModels')}
        disabled={disabled}
        onChange={(businessModels) => onChange({ businessModels })}
      />

      <MultiSelect
        path="companyProfile.companyTypes"
        label="Company types"
        values={value.companyTypes}
        options={COMPANY_TYPE_OPTIONS}
        errors={errorsFor('companyProfile.companyTypes')}
        disabled={disabled}
        onChange={(companyTypes) => onChange({ companyTypes })}
      />

      <MultiSelect
        path="companyProfile.maturityStages"
        label="Maturity stages"
        values={value.maturityStages}
        options={MATURITY_STAGE_OPTIONS}
        errors={errorsFor('companyProfile.maturityStages')}
        disabled={disabled}
        onChange={(maturityStages) => onChange({ maturityStages })}
      />
    </FieldGrid>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const CompanyProfileSection = memo(CompanyProfileSectionImpl);
