import { memo } from 'react';
import {
  BUYER_ROLE_OPTIONS,
  DEPARTMENT_OPTIONS,
  MIN_CONTACTS_PER_ACCOUNT_MAX,
  MIN_CONTACTS_PER_ACCOUNT_MIN,
  REACHABILITY_REQUIREMENT_OPTIONS,
  SENIORITY_OPTIONS,
  TARGET_TITLE_OPTIONS,
} from '@pursuit/shared';
import { MultiSelect, Select, Slider } from '../../../components/form/controls.js';
import { FieldGrid } from '../../../components/ui/index.js';
import type { SectionProps } from './section-types.js';

function TargetBuyerSectionImpl({
  value,
  onChange,
  errorsFor,
  disabled,
}: SectionProps<'targetBuyer'>) {
  return (
    <FieldGrid>
      <MultiSelect
        path="targetBuyer.seniorities"
        label="Seniorities"
        required
        values={value.seniorities}
        options={SENIORITY_OPTIONS}
        errors={errorsFor('targetBuyer.seniorities')}
        disabled={disabled}
        columns={1}
        onChange={(seniorities) => onChange({ seniorities })}
      />

      <MultiSelect
        path="targetBuyer.departments"
        label="Departments"
        required
        values={value.departments}
        options={DEPARTMENT_OPTIONS}
        errors={errorsFor('targetBuyer.departments')}
        disabled={disabled}
        onChange={(departments) => onChange({ departments })}
      />

      <MultiSelect
        path="targetBuyer.titles"
        label="Target titles"
        hint="Picked from the curated title catalog so titles stay comparable across ICPs."
        values={value.titles}
        options={TARGET_TITLE_OPTIONS}
        errors={errorsFor('targetBuyer.titles')}
        disabled={disabled}
        onChange={(titles) => onChange({ titles })}
      />

      <MultiSelect
        path="targetBuyer.buyerRoles"
        label="Buying roles"
        values={value.buyerRoles}
        options={BUYER_ROLE_OPTIONS}
        errors={errorsFor('targetBuyer.buyerRoles')}
        disabled={disabled}
        columns={1}
        onChange={(buyerRoles) => onChange({ buyerRoles })}
      />

      <Select
        path="targetBuyer.reachabilityRequirement"
        label="Reachability requirement"
        hint="Feeds the reachable-decision-maker part of the Opportunity dimension."
        value={value.reachabilityRequirement}
        options={REACHABILITY_REQUIREMENT_OPTIONS}
        errors={errorsFor('targetBuyer.reachabilityRequirement')}
        disabled={disabled}
        onChange={(reachabilityRequirement) => onChange({ reachabilityRequirement })}
      />

      <Slider
        path="targetBuyer.minimumContactsPerAccount"
        label="Minimum contacts per account"
        min={MIN_CONTACTS_PER_ACCOUNT_MIN}
        max={MIN_CONTACTS_PER_ACCOUNT_MAX}
        value={value.minimumContactsPerAccount}
        errors={errorsFor('targetBuyer.minimumContactsPerAccount')}
        disabled={disabled}
        onChange={(minimumContactsPerAccount) => onChange({ minimumContactsPerAccount })}
      />
    </FieldGrid>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const TargetBuyerSection = memo(TargetBuyerSectionImpl);
