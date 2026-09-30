import type { IcpConfig } from '@pursuit/shared';
import type { ErrorLookup } from '../../../components/form/RuleBuilder.js';
import type { SectionKey } from '../useIcpForm.js';

export interface SectionProps<K extends SectionKey> {
  value: IcpConfig[K];
  onChange: (patch: Partial<IcpConfig[K]>) => void;
  errorsFor: ErrorLookup;
  disabled: boolean;
}

/** Ordered section metadata, used for the form navigation and headings. */
export interface SectionMeta {
  id: string;
  /** Two-digit ordinal shown as a quiet index next to the title. */
  number: string;
  /** Heading text, without the ordinal - the number is a visual element. */
  title: string;
  description: string;
  /** Config key this section edits; drives the per-section completeness check. */
  configKey: SectionKey;
}

export const SECTION_ORDER: readonly SectionMeta[] = [
  {
    id: 'basic-profile',
    number: '01',
    title: 'Basic Profile',
    configKey: 'basicProfile',
    description: 'Identity of the ICP and the commercial objective it serves.',
  },
  {
    id: 'geography',
    number: '02',
    title: 'Geography',
    configKey: 'geography',
    description: 'Target markets and the company location the rules apply to.',
  },
  {
    id: 'company-profile',
    number: '03',
    title: 'Company Profile',
    configKey: 'companyProfile',
    description: 'Firmographics used by the ICP Fit dimension.',
  },
  {
    id: 'technology',
    number: '04',
    title: 'Technology',
    configKey: 'technology',
    description: 'Stack, maturity and legacy markers used by Business Fit and Need.',
  },
  {
    id: 'services-fit',
    number: '05',
    title: 'Services & Fit',
    configKey: 'servicesFit',
    description: 'What we sell into this ICP and the expected opportunity size.',
  },
  {
    id: 'business-problems',
    number: '06',
    title: 'Business Problems',
    configKey: 'businessProblems',
    description: 'The problems that make an account a real prospect.',
  },
  {
    id: 'must-nice-exclude',
    number: '07',
    title: 'Must / Nice / Exclude',
    configKey: 'mustNiceExclude',
    description:
      'Must-have rules are hard filters. Nice-to-have rules only add score. Exclusions suppress.',
  },
  {
    id: 'triggers-intent',
    number: '08',
    title: 'Triggers & Intent',
    configKey: 'triggersIntent',
    description: 'Dated signals that indicate intent, with polarity, decay and lookback.',
  },
  {
    id: 'target-buyer',
    number: '09',
    title: 'Target Buyer',
    configKey: 'targetBuyer',
    description: 'Who we need to reach for the account to be actionable.',
  },
  {
    id: 'evidence-discovery',
    number: '10',
    title: 'Evidence & Discovery',
    configKey: 'evidenceDiscovery',
    description: 'How candidates are found and what counts as acceptable evidence.',
  },
];
