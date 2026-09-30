import {
  describeRule,
  operandKindForOperator,
  type CanonicalCompany,
  type IcpRule,
  type PersonCandidate,
  type RuleField,
  type RuleOperator,
} from '@pursuit/shared';

/**
 * Deterministic evaluation of one ICP rule against one candidate.
 *
 * The ICP's `mustHave` bucket is the criteria contract's own declaration of
 * what the hard filters are ("must-have rules are the hard filters", as the
 * schema tells the user), and `exclusions` is its declaration of what
 * disqualifies. This file is the only thing that reads them, and it is
 * deliberately small and dull: a field lookup, an operator, a verdict. No
 * model, no scoring, no heuristics, no partial credit.
 *
 * ## Four verdicts, not two
 *
 * `PASS`/`FAIL` are not enough, and collapsing the other two into either one is
 * exactly how a filtering stage starts deleting real prospects:
 *
 *  - **UNKNOWN** - the field is one we can evaluate, but this candidate has no
 *    value for it. Provider coverage is uneven; a company with no reported
 *    headcount is not a company with zero employees. What happens next is the
 *    rule author's choice, carried on the rule as `unknownHandling`, which the
 *    criteria contract already defaults to `TREAT_AS_UNKNOWN`.
 *  - **UNSUPPORTED** - the *field* has no source in this system at all. No
 *    evidence has been collected, no CRM is connected, no signal has been
 *    stored. This can never reject anybody, whatever `unknownHandling` says:
 *    the data is not missing for this candidate, it is missing for everyone,
 *    and applying the rule would reject the entire result set on the strength
 *    of a feature that has not been built. It is reported by name instead.
 */

export const RULE_VERDICTS = ['PASS', 'FAIL', 'UNKNOWN', 'UNSUPPORTED'] as const;
export type RuleVerdict = (typeof RULE_VERDICTS)[number];

/** Everything a rule may read about one candidate. */
export interface CandidateFacts {
  readonly person: PersonCandidate;
  /** Absent when the provider reported no employer. */
  readonly company?: CanonicalCompany;
}

/**
 * A field's value, in the three shapes a rule has to reason about.
 *
 * `set` is the interesting one. It means *one* value whose reading is
 * ambiguous - Apollo's `manager` seniority is our MANAGER or our LEAD and there
 * is no way to tell which - rather than a genuine multi-valued attribute. That
 * distinction drives the operator semantics below.
 */
type FieldValue =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'single'; readonly value: string | number | boolean }
  | { readonly kind: 'set'; readonly values: readonly string[] };

const UNKNOWN: FieldValue = { kind: 'unknown' };

function single(value: string | number | boolean | undefined): FieldValue {
  return value === undefined ? UNKNOWN : { kind: 'single', value };
}

function set(values: readonly string[] | undefined): FieldValue {
  return values === undefined || values.length === 0 ? UNKNOWN : { kind: 'set', values };
}

/**
 * Rule fields this stage can answer, and what it answers them from.
 *
 * Everything absent from this map is UNSUPPORTED - and the absences are the
 * honest part of the file, so they are listed rather than left to be inferred:
 *
 *  - `company.region`, `companyType`, `businessModel`, `maturityStage`,
 *    `language`, `description`, `annualRevenue`, `foundedYear` - no source. The
 *    people search returns none of them and nothing else populates them yet.
 *  - `technology.*` - no technology source. The people query does not carry
 *    technologies (the provider's technology filter needs opaque vendor uids
 *    this key cannot resolve) and no enrichment provider is connected.
 *  - `problem.*`, `signal.*`, `evidence.*` - these are the *output* of the
 *    qualification stage that comes after this one. Evaluating them here would
 *    mean filtering on evidence that has not been gathered.
 *  - `account.*` - existing customer, open deal, do-not-contact, active
 *    sequence. Real suppression inputs with no CRM behind them; see
 *    `SuppressionService` for where they will land.
 *  - `buyer.title` - the criteria hold catalog titles, the provider returns
 *    free-text job titles, and there is no deterministic mapping between them
 *    that does not produce false negatives. Titles already widen the *search*,
 *    which is the right place for an approximate match.
 *  - `buyer.contactCount` - an account-level count, and this stage evaluates
 *    one person at a time against one page of results.
 */
const FIELD_READERS: Partial<Record<RuleField, (facts: CandidateFacts) => FieldValue>> = {
  'company.country': (facts) => single(facts.company?.country),
  'company.industry': (facts) => set(facts.company?.industryCodes),
  'company.employeeCount': (facts) => single(facts.company?.employeeCount),
  'company.domain': (facts) => single(facts.company?.domain),
  /**
   * Known-true when a website or a domain was reported, unknown otherwise.
   *
   * Never false. "The provider did not give us a website" is not the same claim
   * as "this company has no website", and only the second one would justify
   * rejecting a company on a `hasWebsite` rule.
   */
  'company.hasWebsite': (facts) => {
    const company = facts.company;
    if (!company) return UNKNOWN;
    if (company.website !== undefined || company.domain !== undefined) {
      return { kind: 'single', value: true };
    }
    return UNKNOWN;
  },
  'buyer.seniority': (facts) => set(facts.person.seniorityCodes),
  'buyer.department': (facts) => set(facts.person.departmentCodes),
};

function asNumber(value: string | number | boolean): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function equalsScalar(actual: string | number | boolean, expected: unknown): boolean {
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual.toLowerCase() === expected.toLowerCase();
  }
  return actual === expected;
}

function compareNumeric(operator: RuleOperator, actual: number, operand: unknown): RuleVerdict {
  const expected = typeof operand === 'number' ? operand : undefined;
  if (expected === undefined) return 'UNSUPPORTED';
  switch (operator) {
    case 'GREATER_THAN':
      return actual > expected ? 'PASS' : 'FAIL';
    case 'GREATER_THAN_OR_EQUAL':
      return actual >= expected ? 'PASS' : 'FAIL';
    case 'LESS_THAN':
      return actual < expected ? 'PASS' : 'FAIL';
    case 'LESS_THAN_OR_EQUAL':
      return actual <= expected ? 'PASS' : 'FAIL';
    default:
      return 'UNSUPPORTED';
  }
}

/**
 * A set-valued field against an operator.
 *
 * The rule is *optimistic for positive operators and conservative for negative
 * ones*, and it is the same rule in both directions: a candidate is only
 * rejected when every possible reading of its value rejects it.
 *
 * A person whose provider seniority reads as MANAGER-or-LEAD satisfies
 * "seniority is any of [LEAD]" - one true reading is enough - and fails
 * "seniority is none of [LEAD]" only if *both* readings are excluded. The
 * alternative, picking one reading, would reject real buyers on an ambiguity
 * that is the vocabulary's fault rather than theirs.
 */
function evaluateSet(operator: RuleOperator, values: readonly string[], rule: IcpRule): RuleVerdict {
  const list = (rule.values ?? []).map(String);
  switch (operator) {
    case 'EQUALS':
      return values.some((value) => equalsScalar(value, rule.value)) ? 'PASS' : 'FAIL';
    case 'NOT_EQUALS':
      return values.every((value) => equalsScalar(value, rule.value)) ? 'FAIL' : 'PASS';
    case 'IN':
      return values.some((value) => list.some((entry) => equalsScalar(value, entry)))
        ? 'PASS'
        : 'FAIL';
    case 'NOT_IN':
      return values.every((value) => list.some((entry) => equalsScalar(value, entry)))
        ? 'FAIL'
        : 'PASS';
    case 'EXISTS':
      return 'PASS';
    case 'NOT_EXISTS':
      return 'FAIL';
    default:
      return 'UNSUPPORTED';
  }
}

function evaluateSingle(
  operator: RuleOperator,
  actual: string | number | boolean,
  rule: IcpRule,
): RuleVerdict {
  switch (operator) {
    case 'EQUALS':
      return equalsScalar(actual, rule.value) ? 'PASS' : 'FAIL';
    case 'NOT_EQUALS':
      return equalsScalar(actual, rule.value) ? 'FAIL' : 'PASS';
    case 'IN':
      return (rule.values ?? []).some((entry) => equalsScalar(actual, entry)) ? 'PASS' : 'FAIL';
    case 'NOT_IN':
      return (rule.values ?? []).some((entry) => equalsScalar(actual, entry)) ? 'FAIL' : 'PASS';
    case 'CONTAINS':
    case 'NOT_CONTAINS': {
      if (typeof actual !== 'string' || typeof rule.value !== 'string') return 'UNSUPPORTED';
      const hit = actual.toLowerCase().includes(rule.value.toLowerCase());
      return operator === 'CONTAINS' ? (hit ? 'PASS' : 'FAIL') : hit ? 'FAIL' : 'PASS';
    }
    case 'BETWEEN': {
      const value = asNumber(actual);
      if (value === undefined || rule.range === undefined) return 'UNSUPPORTED';
      return value >= rule.range.min && value <= rule.range.max ? 'PASS' : 'FAIL';
    }
    case 'EXISTS':
      return 'PASS';
    case 'NOT_EXISTS':
      return 'FAIL';
    default: {
      const value = asNumber(actual);
      if (value === undefined) return 'UNSUPPORTED';
      return compareNumeric(operator, value, rule.value);
    }
  }
}

/**
 * One rule against one candidate.
 *
 * `unknownHandling` is deliberately *not* applied here. This function reports
 * what it saw; what an UNKNOWN means for a given bucket is a policy the caller
 * owns, and the same UNKNOWN means opposite things for a must-have rule and for
 * an exclusion.
 */
export function evaluateRule(rule: IcpRule, facts: CandidateFacts): RuleVerdict {
  const reader = FIELD_READERS[rule.field];
  if (reader === undefined) return 'UNSUPPORTED';

  const value = reader(facts);
  if (value.kind === 'unknown') {
    // EXISTS/NOT_EXISTS are the two operators whose answer *is* the absence -
    // but only if the absence is a fact about the company rather than about the
    // provider's coverage, and nothing here can tell those apart. So they stay
    // unknown too, rather than turning "not reported" into "does not have".
    return 'UNKNOWN';
  }

  const kind = operandKindForOperator(rule.operator);
  // A rule whose operand slot does not match its operator cannot be stored -
  // the criteria schema rejects it - so this only guards a rule that reached us
  // some other way, and it abstains rather than guessing what was meant.
  if (kind === 'SINGLE' && rule.value === undefined) return 'UNSUPPORTED';
  if (kind === 'LIST' && rule.values === undefined) return 'UNSUPPORTED';
  if (kind === 'RANGE' && rule.range === undefined) return 'UNSUPPORTED';

  return value.kind === 'set'
    ? evaluateSet(rule.operator, value.values, rule)
    : evaluateSingle(rule.operator, value.value, rule);
}

/**
 * The verdict after the rule author's `unknownHandling` has been applied.
 *
 * UNSUPPORTED is passed through untouched on purpose: `unknownHandling` is a
 * statement about *this candidate's missing value*, and a field with no source
 * at all is not that. Letting `TREAT_AS_FAIL` reject every candidate because a
 * feature does not exist yet would be the single worst failure this stage could
 * have.
 */
export function applyUnknownHandling(verdict: RuleVerdict, rule: IcpRule): RuleVerdict {
  if (verdict !== 'UNKNOWN') return verdict;
  switch (rule.unknownHandling) {
    case 'TREAT_AS_FAIL':
      return 'FAIL';
    case 'TREAT_AS_PASS':
      return 'PASS';
    default:
      return 'UNKNOWN';
  }
}

/** Frontend-safe description of a rule, for a rejection detail. */
export function ruleDetail(rule: IcpRule): string {
  return describeRule(rule);
}
