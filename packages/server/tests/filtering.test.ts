import { describe, expect, it } from 'vitest';
import type { CanonicalCompany, IcpConfig, IcpRule } from '@pursuit/shared';
import { FilteringService } from '../src/modules/filtering/filtering-service.js';
import { checkReachability } from '../src/modules/filtering/reachability.js';
import { exampleConfig } from './helpers.js';
import { person } from './candidate-fixtures.js';

/**
 * `FilteringService` and the reachability sanity check.
 *
 * Every test here is really one of three questions:
 *
 *  - does a hard criterion the ICP actually declared reject what it should?
 *  - does a *preference* stay a preference?
 *  - does missing data leave the candidate alone?
 *
 * The third is the one worth most of the file. A filtering stage that treats
 * "not reported" as "does not match" deletes thin records rather than wrong
 * ones, and it does it invisibly.
 */

function canonical(overrides: Partial<CanonicalCompany> = {}): CanonicalCompany {
  return {
    id: 'domain:voorbeeld-software.nl',
    identityBasis: 'DOMAIN',
    name: 'Voorbeeld Software B.V.',
    normalizedName: 'voorbeeld software',
    domain: 'voorbeeld-software.nl',
    country: 'NL',
    industry: 'financial services',
    industryCodes: ['FINANCIAL_SERVICES'],
    employeeCount: 900,
    providerRefs: [{ provider: 'apollo', externalId: 'org-voorbeeld' }],
    sourceRefs: ['apollo:person:p1'],
    ...overrides,
  };
}

/**
 * The example ICP, which is the one this suite filters against throughout.
 *
 * Its relevant criteria: NL/BE/LU with US excluded, HEADQUARTERS_ONLY;
 * financial services / logistics / manufacturing with nonprofit excluded;
 * 200-5000 employees; C-level and director; IT and engineering.
 */
function config(mutate: (config: IcpConfig) => void = () => undefined): IcpConfig {
  const value = exampleConfig();
  mutate(value);
  return value;
}

const check = (icp: IcpConfig, company: CanonicalCompany | undefined, candidate = person('p1')) =>
  new FilteringService(icp).check({
    person: candidate,
    ...(company !== undefined ? { company } : {}),
  });

describe('hard filters - a candidate that matches', () => {
  it('passes when every supported hard criterion is satisfied', () => {
    const outcome = check(config(), canonical());

    expect(outcome.passed).toBe(true);
    expect(outcome.rejections).toEqual([]);
  });
});

describe('hard filters - geography', () => {
  it('rejects a company outside the target countries', () => {
    const outcome = check(config(), canonical({ country: 'DE' }));

    expect(outcome.rejections.map((entry) => entry.reason)).toContain('HARD_LOCATION_MISMATCH');
    expect(outcome.rejections[0]?.detail).toContain('DE');
  });

  it('rejects a company in an excluded country', () => {
    const outcome = check(config(), canonical({ country: 'US' }));

    const rejection = outcome.rejections.find(
      (entry) => entry.reason === 'HARD_LOCATION_MISMATCH',
    );
    expect(rejection?.detail).toContain('excluded country');
  });

  it('does not apply the inclusion list when the scope is not headquarters', () => {
    // A people search reports one company location. Under ANY_LOCATION the
    // criteria ask about *all* of them, so rejecting on the single known one
    // would reject firms that do have an office in the target market.
    const icp = config((value) => {
      value.geography.locationScope = 'ANY_LOCATION';
      // The example ICP also carries an explicit `company.country IN` must-have
      // rule, which is a statement the author wrote themselves and applies
      // under every scope. It is cleared here so this test is about the
      // *section* criterion and nothing else.
      value.mustNiceExclude.mustHave = [
        {
          id: 'must-size',
          field: 'company.employeeCount',
          operator: 'GREATER_THAN_OR_EQUAL',
          value: 200,
          unknownHandling: 'TREAT_AS_UNKNOWN',
        } satisfies IcpRule,
      ];
    });
    const service = new FilteringService(icp);
    const outcome = service.check({ person: person('p1'), company: canonical({ country: 'DE' }) });

    expect(outcome.passed).toBe(true);
    expect(service.unsupportedCriteria().join(' ')).toContain('geography.includedCountries');
  });

  it('still applies the exclusion list under a wider scope', () => {
    // The asymmetry is deliberate: a location the company genuinely has, found
    // on the excluded list, is a true match under any scope.
    const icp = config((value) => {
      value.geography.locationScope = 'ANY_LOCATION';
    });
    const outcome = check(icp, canonical({ country: 'US' }));

    expect(outcome.passed).toBe(false);
  });
});

describe('hard filters - industry', () => {
  it('rejects a company outside the target industries', () => {
    const outcome = check(config(), canonical({ industryCodes: ['TELECOM_MEDIA'] }));

    expect(outcome.rejections.map((entry) => entry.reason)).toContain('HARD_INDUSTRY_MISMATCH');
  });

  it('rejects a company in an excluded industry', () => {
    const outcome = check(config(), canonical({ industryCodes: ['NONPROFIT'] }));

    expect(outcome.rejections[0]?.detail).toContain('excluded industry');
  });

  it('accepts an ambiguous label as soon as one reading is targeted', () => {
    // A provider label that reads as two of our categories is not grounds to
    // reject: one true reading is enough, and picking the other arbitrarily
    // would lose a company the ICP actually wants.
    const outcome = check(
      config(),
      canonical({ industryCodes: ['TELECOM_MEDIA', 'FINANCIAL_SERVICES'] }),
    );

    expect(outcome.passed).toBe(true);
  });
});

describe('hard filters - company size', () => {
  it('rejects a company below the minimum', () => {
    const outcome = check(config(), canonical({ employeeCount: 12 }));

    const rejection = outcome.rejections.find(
      (entry) => entry.reason === 'HARD_EMPLOYEE_RANGE_MISMATCH',
    );
    expect(rejection?.detail).toContain('below the required minimum');
  });

  it('rejects a company above the maximum', () => {
    const outcome = check(config(), canonical({ employeeCount: 90000 }));

    expect(outcome.rejections.map((entry) => entry.reason)).toContain(
      'HARD_EMPLOYEE_RANGE_MISMATCH',
    );
  });
});

describe('hard filters - buyer', () => {
  it('rejects a person whose seniority is outside the target tiers', () => {
    const outcome = check(config(), canonical(), person('p1', { seniorityCodes: ['MANAGER'] }));

    expect(outcome.rejections.map((entry) => entry.reason)).toContain('HARD_SENIORITY_MISMATCH');
  });

  it('accepts an ambiguous seniority when one reading is targeted', () => {
    // The provider's `manager` tier covers our MANAGER and our LEAD; an ICP
    // targeting LEAD must not lose these people to the ambiguity.
    const icp = config((value) => {
      value.targetBuyer.seniorities = ['LEAD'];
    });
    const outcome = check(icp, canonical(), person('p1', { seniorityCodes: ['MANAGER', 'LEAD'] }));

    expect(outcome.passed).toBe(true);
  });

  it('rejects a person in a department the ICP does not target', () => {
    const outcome = check(config(), canonical(), person('p1', { departmentCodes: ['SALES'] }));

    expect(outcome.rejections.map((entry) => entry.reason)).toContain('HARD_DEPARTMENT_MISMATCH');
  });
});

describe('hard filters - missing data is unknown, never a rejection', () => {
  it('keeps a company with no reported country', () => {
    expect(check(config(), canonical({ country: undefined })).passed).toBe(true);
  });

  it('keeps a company with no recognisable industry', () => {
    // An industry label the catalog does not know maps to nothing, and nothing
    // is unknown - not "some industry we do not target".
    expect(check(config(), canonical({ industryCodes: undefined })).passed).toBe(true);
  });

  it('keeps a company with no reported headcount, rather than treating it as zero', () => {
    const outcome = check(config(), canonical({ employeeCount: undefined }));

    expect(outcome.passed).toBe(true);
    expect(outcome.rejections).toEqual([]);
  });

  it('keeps a person whose seniority is outside our vocabulary entirely', () => {
    // A founder. The provider has a tier for it and our catalog does not, so
    // the gap is ours and the candidate is not punished for it.
    expect(check(config(), canonical(), person('p1', { seniorityCodes: undefined })).passed).toBe(
      true,
    );
  });

  it('keeps a person whose employer was not reported at all', () => {
    expect(check(config(), undefined, person('p1', { company: null })).passed).toBe(true);
  });
});

describe('hard filters - rules', () => {
  it('rejects a candidate that fails a must-have rule', () => {
    const icp = config((value) => {
      value.mustNiceExclude.mustHave = [
        {
          id: 'must-country',
          field: 'company.country',
          operator: 'IN',
          values: ['BE'],
          unknownHandling: 'TREAT_AS_UNKNOWN',
        } satisfies IcpRule,
      ];
    });
    const outcome = check(icp, canonical({ country: 'NL' }));

    const rejection = outcome.rejections.find((entry) => entry.reason === 'HARD_RULE_MISMATCH');
    expect(rejection?.detail).toContain('Must-have rule not met');
  });

  it('rejects a candidate that matches an exclusion rule', () => {
    const icp = config((value) => {
      value.mustNiceExclude.exclusions = [
        {
          id: 'exclude-size',
          field: 'company.employeeCount',
          operator: 'GREATER_THAN',
          value: 500,
          unknownHandling: 'TREAT_AS_UNKNOWN',
        } satisfies IcpRule,
      ];
    });
    const outcome = check(icp, canonical({ employeeCount: 900 }));

    expect(outcome.rejections.map((entry) => entry.reason)).toContain('HARD_EXCLUSION_MATCH');
  });

  it('honours TREAT_AS_FAIL on a rule whose value this candidate is missing', () => {
    const icp = config((value) => {
      value.mustNiceExclude.mustHave = [
        {
          id: 'must-size',
          field: 'company.employeeCount',
          operator: 'GREATER_THAN_OR_EQUAL',
          value: 200,
          unknownHandling: 'TREAT_AS_FAIL',
        } satisfies IcpRule,
      ];
    });

    expect(check(icp, canonical({ employeeCount: undefined })).passed).toBe(false);
    // ...and the default leaves the same candidate alone.
    const lenient = config((value) => {
      value.mustNiceExclude.mustHave = [
        {
          id: 'must-size',
          field: 'company.employeeCount',
          operator: 'GREATER_THAN_OR_EQUAL',
          value: 200,
          unknownHandling: 'TREAT_AS_UNKNOWN',
        } satisfies IcpRule,
      ];
    });
    expect(check(lenient, canonical({ employeeCount: undefined })).passed).toBe(true);
  });

  it('never rejects on a field with no source, whatever unknownHandling says', () => {
    // The worst failure this stage could have: a rule on data that does not
    // exist yet rejecting the entire result set.
    const icp = config((value) => {
      value.mustNiceExclude.mustHave = [
        {
          id: 'must-signal',
          field: 'signal.type',
          operator: 'EQUALS',
          value: 'FUNDING_ROUND',
          unknownHandling: 'TREAT_AS_FAIL',
        } satisfies IcpRule,
      ];
    });
    const service = new FilteringService(icp);
    const outcome = service.check({ person: person('p1'), company: canonical() });

    expect(outcome.passed).toBe(true);
    expect(service.unsupportedCriteria().join(' ')).toContain('mustNiceExclude.mustHave');
  });

  it('collects every failing criterion rather than stopping at the first', () => {
    // A German company of four people, against an ICP that states its geography
    // and its size twice over - once as a section criterion and once as a
    // must-have rule. All four rejections are reported, because "rejected on
    // country" and "rejected on country and size" are different diagnoses and
    // only the second one says that widening the geography alone will not help.
    const outcome = check(config(), canonical({ country: 'DE', employeeCount: 4 }));

    expect(outcome.rejections.map((entry) => entry.reason)).toEqual([
      'HARD_LOCATION_MISMATCH',
      'HARD_EMPLOYEE_RANGE_MISMATCH',
      'HARD_RULE_MISMATCH',
      'HARD_RULE_MISMATCH',
    ]);
    expect(outcome.rejections.map((entry) => entry.detail)).toEqual([
      'Company country DE is not in the target countries NL, BE, LU',
      'Company has 4 employees, below the required minimum of 200',
      'Must-have rule not met: Country is any of Netherlands, Belgium, Luxembourg',
      'Must-have rule not met: Employee count is at least 200',
    ]);
  });
});

describe('hard filters - nice-to-have stays a preference', () => {
  it('does not reject a candidate that fails a weighted nice-to-have rule', () => {
    const icp = config((value) => {
      value.mustNiceExclude.niceToHave = [
        {
          id: 'nice-size',
          field: 'company.employeeCount',
          operator: 'GREATER_THAN',
          value: 100000,
          unknownHandling: 'TREAT_AS_FAIL',
          weight: 9,
        } satisfies IcpRule,
      ];
    });

    // A criterion no candidate can meet, in the bucket that is not a gate.
    expect(check(icp, canonical()).passed).toBe(true);
  });
});

describe('hard filters - technology has no source yet', () => {
  it('names the requirement as unapplied instead of filtering on nothing', () => {
    const service = new FilteringService(config());
    const outcome = service.check({ person: person('p1'), company: canonical() });

    expect(outcome.passed).toBe(true);
    // The example ICP requires .NET and SQL Server and excludes Mendix.
    expect(service.unsupportedCriteria().join(' ')).toContain('technology.requiredTechnologies');
    expect(service.unsupportedCriteria().join(' ')).toContain('technology.excludedTechnologies');
  });
});

describe('reachability sanity', () => {
  it('accepts a candidate with a LinkedIn profile', () => {
    const result = checkReachability({
      person: person('p1', { emailStatus: undefined, company: null }),
    });

    expect(result.reachable).toBe(true);
    expect(result.detail).toContain('LinkedIn');
  });

  it('accepts a candidate known only through their company domain', () => {
    const result = checkReachability({
      person: person('p1', { linkedinUrl: undefined, emailStatus: undefined }),
    });

    expect(result.reachable).toBe(true);
  });

  it('rejects a candidate with no handle of any kind', () => {
    const result = checkReachability({
      person: person('p1', { linkedinUrl: undefined, emailStatus: undefined, company: null }),
    });

    expect(result.reachable).toBe(false);
    expect(result.detail).toContain('no channel');
  });

  it('does not count a provider status that reports an absence as a handle', () => {
    const result = checkReachability({
      person: person('p1', {
        linkedinUrl: undefined,
        emailStatus: 'unavailable',
        company: null,
      }),
    });

    expect(result.reachable).toBe(false);
  });

  it('does not count an unusable LinkedIn value as a handle', () => {
    const result = checkReachability({
      person: person('p1', {
        linkedinUrl: 'https://example.com/not-a-profile',
        emailStatus: undefined,
        company: null,
      }),
    });

    expect(result.reachable).toBe(false);
  });
});
