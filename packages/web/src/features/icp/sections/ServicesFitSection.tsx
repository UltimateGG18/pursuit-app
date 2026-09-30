import { memo } from 'react';
import {
  BUYING_INDICATOR_OPTIONS,
  DEAL_SIZE_BAND_OPTIONS,
  ENGAGEMENT_MODEL_OPTIONS,
  OUTSOURCING_POSTURE_OPTIONS,
  SERVICE_OFFERING_OPTIONS,
} from '@pursuit/shared';
import { MultiSelect, Select } from '../../../components/form/controls.js';
import { FieldGrid } from '../../../components/ui/index.js';
import type { SectionProps } from './section-types.js';

function ServicesFitSectionImpl({
  value,
  onChange,
  errorsFor,
  disabled,
}: SectionProps<'servicesFit'>) {
  return (
    <FieldGrid>
      <MultiSelect
        path="servicesFit.serviceOfferings"
        label="Service offerings"
        hint="Drives the service-fit part of the Opportunity dimension."
        required
        values={value.serviceOfferings}
        options={SERVICE_OFFERING_OPTIONS}
        errors={errorsFor('servicesFit.serviceOfferings')}
        disabled={disabled}
        onChange={(serviceOfferings) => onChange({ serviceOfferings })}
      />

      <MultiSelect
        path="servicesFit.engagementModels"
        label="Engagement models"
        required
        values={value.engagementModels}
        options={ENGAGEMENT_MODEL_OPTIONS}
        errors={errorsFor('servicesFit.engagementModels')}
        disabled={disabled}
        columns={1}
        onChange={(engagementModels) => onChange({ engagementModels })}
      />

      <Select
        path="servicesFit.dealSizeBand"
        label="Expected deal size"
        required
        value={value.dealSizeBand}
        options={DEAL_SIZE_BAND_OPTIONS}
        errors={errorsFor('servicesFit.dealSizeBand')}
        disabled={disabled}
        onChange={(dealSizeBand) => onChange({ dealSizeBand })}
      />

      <Select
        path="servicesFit.outsourcingPosture"
        label="Outsourcing posture"
        hint="Business Fit input. UNKNOWN is a valid answer and is not penalised."
        value={value.outsourcingPosture}
        options={OUTSOURCING_POSTURE_OPTIONS}
        errors={errorsFor('servicesFit.outsourcingPosture')}
        disabled={disabled}
        onChange={(outsourcingPosture) => onChange({ outsourcingPosture })}
      />

      <MultiSelect
        path="servicesFit.buyingIndicators"
        label="Buying indicators"
        values={value.buyingIndicators}
        options={BUYING_INDICATOR_OPTIONS}
        errors={errorsFor('servicesFit.buyingIndicators')}
        disabled={disabled}
        onChange={(buyingIndicators) => onChange({ buyingIndicators })}
      />
    </FieldGrid>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const ServicesFitSection = memo(ServicesFitSectionImpl);
