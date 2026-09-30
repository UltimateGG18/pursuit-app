import {
  type CandidateRejection,
  type CandidateRejectionReason,
  type IcpConfig,
  type IcpRule,
} from '@pursuit/shared';
import {
  applyUnknownHandling,
  evaluateRule,
  ruleDetail,
  type CandidateFacts,
} from './rule-evaluation.js';

/**
 * `FilteringService` - suppression's sibling, and the only place a candidate is
 * rejected for not matching the ICP.
 *
 * The plan's boundary for it (section 4) is one sentence: hard must-have rules
 * and nothing expensive. Made concrete, this stage:
 *
 *  - applies **only** criteria the ICP declares as hard - the `mustHave` and
 *    `exclusions` rule buckets, and the include/exclude criteria of the
 *    geography, company-profile and technology sections;
 *  - never touches `niceToHave`. Those carry a `weight`, which is what makes
 *    them scoring inputs; treating a weighted preference as a gate would
 *    silently turn "we'd like a legacy ERP" into "must have a legacy ERP";
 *  - never scores, ranks, or asks a model anything;
 *  - never rejects on a value it could not see.
 *
 * ## Why both rules *and* section criteria
 *
 * They are two different statements in the same contract and both are hard.
 * `mustNiceExclude.mustHave` is the ICP's explicit hard-filter bucket - the
 * schema tells the user exactly that. The section lists are the criteria
 * envelope, and the discovery mapper pushes their *positive* half to the
 * provider as a recall filter; but a provider filter is approximate by design
 * (industry goes out as loose keyword tags, precisely so this stage can cut),
 * and `excludedIndustries` and the technology lists are never sent at all.
 * Enforcing only one of the two would leave whichever half the user happened to
 * use unenforced.
 *
 * Overlap between the two is harmless: a candidate that fails both the country
 * section and a country must-have rule collects both reasons and is rejected
 * once.
 *
 * ## Missing data
 *
 * Every check abstains when it cannot see its field. That is the plan's rule
 * and it is also the only defensible one: provider coverage is uneven, and a
 * filter that treats "not reported" as "does not match" rejects thin records
 * rather than wrong ones. The one place the ICP author can override it is
 * `unknownHandling` on their own rules, which the criteria contract already
 * defaults to `TREAT_AS_UNKNOWN`.
 */

export interface FilterOutcome {
  readonly passed: boolean;
  /** Every hard criterion that rejected this candidate, not just the first. */
  readonly rejections: readonly CandidateRejection[];
}

export interface FilteringResult extends FilterOutcome {
  /**
   * Hard criteria in this ICP that could not be evaluated, named.
   *
   * Accumulated across the whole run rather than per candidate, because it is a
   * property of the ICP and the available sources, not of any one person.
   */
  readonly unsupported: readonly string[];
}

function reject(reason: CandidateRejectionReason, detail: string): CandidateRejection {
  return { reason, detail };
}

/**
 * Membership over a criteria list, widened to plain strings.
 *
 * The catalogs are narrow literal unions and a candidate's mapped values are
 * `string` by contract - the adapter produced them, and nothing has validated
 * them into a catalog type. Casting one into the other would assert something
 * untrue; a set of strings compares the two honestly, and a value outside the
 * catalog simply never matches, which is exactly the intended outcome.
 */
function memberOf(values: readonly string[]): (value: string) => boolean {
  const set = new Set<string>(values);
  return (value) => set.has(value);
}

/**
 * The geography check.
 *
 * Exclusion applies under every location scope: the one company location the
 * people search reports is a location the company genuinely has, so finding it
 * on the excluded list is a true match whether the scope is headquarters or
 * any-location.
 *
 * Inclusion is only applied under HEADQUARTERS_ONLY, and the asymmetry is
 * deliberate. Under ANY_LOCATION or OPERATING_LOCATION the criteria ask whether
 * *any* of the company's locations is in the target set, and a people search
 * reports exactly one - so rejecting a company whose single known location sits
 * outside the target set would reject firms that do have an office there,
 * purely because the provider did not list it. That is a false negative
 * invented by missing data, so the check abstains and says so instead.
 */
function checkGeography(config: IcpConfig, facts: CandidateFacts, unsupported: Set<string>): CandidateRejection[] {
  const { includedCountries, excludedCountries, locationScope } = config.geography;
  const country = facts.company?.country;

  if (locationScope !== 'HEADQUARTERS_ONLY' && includedCountries.length > 0) {
    unsupported.add(
      `geography.includedCountries (location scope ${locationScope} needs every company location; the contact data provider reports one)`,
    );
  }

  if (country === undefined) return [];

  if (memberOf(excludedCountries)(country)) {
    return [
      reject(
        'HARD_LOCATION_MISMATCH',
        `Company country ${country} is an excluded country`,
      ),
    ];
  }

  if (
    locationScope === 'HEADQUARTERS_ONLY' &&
    includedCountries.length > 0 &&
    !memberOf(includedCountries)(country)
  ) {
    return [
      reject(
        'HARD_LOCATION_MISMATCH',
        `Company country ${country} is not in the target countries ${includedCountries.join(', ')}`,
      ),
    ];
  }
  return [];
}

/**
 * The industry check, over the *catalog* readings of the provider's label.
 *
 * Both halves are optimistic in the same direction the set operators are: a
 * label that reads as two of our industries is excluded only when every reading
 * is excluded, and included as soon as one reading is targeted. A label the
 * catalog does not recognise yields no readings at all and is left alone.
 */
function checkIndustry(config: IcpConfig, facts: CandidateFacts): CandidateRejection[] {
  const { industries, excludedIndustries } = config.companyProfile;
  const codes = facts.company?.industryCodes ?? [];
  if (codes.length === 0) return [];

  if (excludedIndustries.length > 0 && codes.every(memberOf(excludedIndustries))) {
    return [
      reject(
        'HARD_INDUSTRY_MISMATCH',
        `Company industry ${codes.join(' / ')} is an excluded industry`,
      ),
    ];
  }

  if (industries.length > 0 && !codes.some(memberOf(industries))) {
    return [
      reject(
        'HARD_INDUSTRY_MISMATCH',
        `Company industry ${codes.join(' / ')} is not in the target industries ${industries.join(', ')}`,
      ),
    ];
  }
  return [];
}

function checkEmployeeRange(config: IcpConfig, facts: CandidateFacts): CandidateRejection[] {
  const { min, max } = config.companyProfile.employeeRange;
  const count = facts.company?.employeeCount;
  // Absent, not zero. The normalizer never defaults a headcount, so an unknown
  // one arrives as undefined and is left alone here.
  if (count === undefined) return [];

  if (min !== undefined && count < min) {
    return [
      reject(
        'HARD_EMPLOYEE_RANGE_MISMATCH',
        `Company has ${String(count)} employees, below the required minimum of ${String(min)}`,
      ),
    ];
  }
  if (max !== undefined && count > max) {
    return [
      reject(
        'HARD_EMPLOYEE_RANGE_MISMATCH',
        `Company has ${String(count)} employees, above the allowed maximum of ${String(max)}`,
      ),
    ];
  }
  return [];
}

/**
 * The technology check, which currently cannot run.
 *
 * No source in this system reports a company's technology stack: the people
 * query does not carry technologies, the provider's technology filter needs
 * opaque vendor uids this credential cannot resolve, and no enrichment provider
 * is connected. So the requirement is *named as unevaluated* rather than
 * applied to a field that is empty for every candidate - which would either
 * reject the entire result set or, worse, look like it had been checked.
 *
 * It stays a function rather than being deleted so the requirement has one
 * place to be enforced the day a technology source exists.
 */
function checkTechnology(config: IcpConfig, unsupported: Set<string>): CandidateRejection[] {
  const { requiredTechnologies, excludedTechnologies } = config.technology;
  if (requiredTechnologies.length > 0) {
    unsupported.add('technology.requiredTechnologies (no source reports a company technology stack)');
  }
  if (excludedTechnologies.length > 0) {
    unsupported.add('technology.excludedTechnologies (no source reports a company technology stack)');
  }
  return [];
}

/**
 * Buyer seniority and department, against the catalog readings of the
 * provider's own tiers.
 *
 * Both are required sections of the criteria contract, so they are genuine
 * requirements rather than preferences, and both already narrow the search.
 * They are re-checked here because the provider's own filters are approximate -
 * a department filter that covers only half our catalog is reported as
 * unsupported one stage earlier, and this is the stage that was promised would
 * enforce it.
 *
 * A person whose tier maps to nothing in the catalog - a founder, an intern, a
 * sub-department the taxonomy does not name - is kept. The vocabulary gap is
 * ours, and rejecting a founder because our catalog has no word for one would
 * be a false negative we manufactured.
 */
function checkBuyer(config: IcpConfig, facts: CandidateFacts): CandidateRejection[] {
  const rejections: CandidateRejection[] = [];
  const { seniorities, departments } = config.targetBuyer;

  const seniorityCodes = facts.person.seniorityCodes ?? [];
  if (
    seniorities.length > 0 &&
    seniorityCodes.length > 0 &&
    !seniorityCodes.some(memberOf(seniorities))
  ) {
    rejections.push(
      reject(
        'HARD_SENIORITY_MISMATCH',
        `Seniority ${seniorityCodes.join(' / ')} is not in the target seniorities ${seniorities.join(', ')}`,
      ),
    );
  }

  const departmentCodes = facts.person.departmentCodes ?? [];
  if (
    departments.length > 0 &&
    departmentCodes.length > 0 &&
    !departmentCodes.some(memberOf(departments))
  ) {
    rejections.push(
      reject(
        'HARD_DEPARTMENT_MISMATCH',
        `Department ${departmentCodes.join(' / ')} is not in the target departments ${departments.join(', ')}`,
      ),
    );
  }
  return rejections;
}

/**
 * The ICP's own rule buckets.
 *
 * The two buckets read the same verdict in opposite directions, which is why
 * `evaluateRule` reports what it saw and leaves the policy here:
 *
 *  - a **must-have** rule rejects when it FAILs - the candidate does not meet a
 *    stated requirement;
 *  - an **exclusion** rule rejects when it PASSes - the candidate matches a
 *    stated disqualifier.
 *
 * `unknownHandling` is applied before either, so an author who wrote
 * "TREAT_AS_FAIL" gets a rejection on missing data and an author who left the
 * default gets the candidate kept. UNSUPPORTED never rejects in either bucket.
 */
function checkRules(
  rules: readonly IcpRule[],
  bucket: 'mustHave' | 'exclusions',
  facts: CandidateFacts,
  unsupported: Set<string>,
): CandidateRejection[] {
  const rejections: CandidateRejection[] = [];

  for (const rule of rules) {
    const raw = evaluateRule(rule, facts);
    if (raw === 'UNSUPPORTED') {
      unsupported.add(`mustNiceExclude.${bucket}: ${ruleDetail(rule)} (no source for this field)`);
      continue;
    }

    const verdict = applyUnknownHandling(raw, rule);
    if (bucket === 'mustHave' && verdict === 'FAIL') {
      rejections.push(reject('HARD_RULE_MISMATCH', `Must-have rule not met: ${ruleDetail(rule)}`));
    }
    if (bucket === 'exclusions' && verdict === 'PASS') {
      rejections.push(reject('HARD_EXCLUSION_MATCH', `Exclusion rule matched: ${ruleDetail(rule)}`));
    }
  }
  return rejections;
}

export class FilteringService {
  /** Accumulated across every candidate; see `FilteringResult.unsupported`. */
  private readonly unsupported = new Set<string>();

  constructor(private readonly config: IcpConfig) {}

  /** Hard criteria this ICP declares that this stage could not evaluate. */
  unsupportedCriteria(): string[] {
    return [...this.unsupported].sort();
  }

  /**
   * One candidate against every hard criterion.
   *
   * Every criterion is evaluated even after the first rejection. Stopping early
   * would be faster and would make the cold pool less useful: "rejected on
   * country" and "rejected on country, size and industry" are different
   * diagnoses of an ICP, and only the second one tells its author that widening
   * the geography alone will not help.
   */
  check(facts: CandidateFacts): FilterOutcome {
    const { mustHave, exclusions } = this.config.mustNiceExclude;
    const rejections: CandidateRejection[] = [
      ...checkGeography(this.config, facts, this.unsupported),
      ...checkIndustry(this.config, facts),
      ...checkEmployeeRange(this.config, facts),
      ...checkTechnology(this.config, this.unsupported),
      ...checkBuyer(this.config, facts),
      ...checkRules(mustHave, 'mustHave', facts, this.unsupported),
      ...checkRules(exclusions, 'exclusions', facts, this.unsupported),
    ];

    return { passed: rejections.length === 0, rejections };
  }
}
