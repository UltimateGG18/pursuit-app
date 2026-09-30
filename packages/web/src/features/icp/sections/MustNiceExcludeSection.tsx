import { memo } from 'react';
import { RuleBuilder } from '../../../components/form/RuleBuilder.js';
import type { SectionProps } from './section-types.js';

/**
 * Three rule buckets with three different consequences, so each gets its own
 * lane and its own restrained accent: must-have rejects, nice-to-have only
 * scores, exclusions suppress. The tone is carried by a border and a heading,
 * never by a filled red or green panel.
 */
function MustNiceExcludeSectionImpl({
  value,
  onChange,
  errorsFor,
  disabled,
}: SectionProps<'mustNiceExclude'>) {
  return (
    <div className="flex flex-col gap-5">
      <RuleBuilder
        path="mustNiceExclude.mustHave"
        label="Must have"
        hint="Hard filters. A candidate that fails one of these is rejected with a reason and kept in the cold pool."
        rules={value.mustHave}
        errorsFor={errorsFor}
        disabled={disabled}
        addLabel="Add condition"
        tone="positive"
        onChange={(mustHave) => onChange({ mustHave })}
      />

      <RuleBuilder
        path="mustNiceExclude.niceToHave"
        label="Nice to have"
        hint="Weighted preferences. Never disqualifies a candidate; the weight only influences the score."
        rules={value.niceToHave}
        withWeight
        errorsFor={errorsFor}
        disabled={disabled}
        addLabel="Add condition"
        tone="neutral"
        onChange={(niceToHave) => onChange({ niceToHave })}
      />

      <RuleBuilder
        path="mustNiceExclude.exclusions"
        label="Exclude"
        hint="Never target. Explicit suppression for existing customers, open deals and do-not-contact accounts."
        rules={value.exclusions}
        errorsFor={errorsFor}
        disabled={disabled}
        addLabel="Add condition"
        combinator="ANY"
        tone="critical"
        onChange={(exclusions) => onChange({ exclusions })}
      />
    </div>
  );
}

/**
 * Memoized: the form holds ten sections with many option lists, so a keystroke
 * in one section must not re-render the other nine.
 */
export const MustNiceExcludeSection = memo(MustNiceExcludeSectionImpl);
