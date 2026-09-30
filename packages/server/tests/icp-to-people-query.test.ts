import { describe, expect, it } from 'vitest';
import {
  PEOPLE_PER_PAGE_DEFAULT,
  createExampleAnalysisOutput,
  peopleQuerySchema,
  type IcpAnalysisOutput,
} from '@pursuit/shared';
import {
  analysisTitles,
  mapIcpToPeopleQuery,
} from '../src/modules/discovery/icp-to-people-query.js';
import { exampleConfig } from './helpers.js';

/**
 * ICP -> internal people query.
 *
 * The first of the two translation steps, and the one that decides *what the
 * search is for*. Asserted against the neutral contract rather than against
 * Apollo, because nothing in this step is allowed to know which provider will
 * answer.
 */

function analysisWithRoles(roles: string[]): IcpAnalysisOutput {
  const example = createExampleAnalysisOutput();
  return {
    ...example,
    buyerStrategy: roles.map((role, index) => ({
      ...example.buyerStrategy[0]!,
      role,
      priority: index === 0 ? 'PRIMARY' : 'SECONDARY',
    })),
  };
}

describe('mapIcpToPeopleQuery - what it reads from the ICP', () => {
  it('produces a query that satisfies the neutral contract', () => {
    const query = mapIcpToPeopleQuery(exampleConfig());
    expect(peopleQuerySchema.safeParse(query).success).toBe(true);
  });

  it('carries the target buyer: titles, seniorities and departments', () => {
    const config = exampleConfig();
    const query = mapIcpToPeopleQuery(config);

    expect(query.buyer?.titles).toEqual(config.targetBuyer.titles);
    expect(query.buyer?.seniorities).toEqual(config.targetBuyer.seniorities);
    expect(query.buyer?.departments).toEqual(config.targetBuyer.departments);
  });

  it('carries the company envelope: geography, industries and employee bounds', () => {
    const config = exampleConfig();
    const query = mapIcpToPeopleQuery(config);

    expect(query.company?.countries).toEqual(config.geography.includedCountries);
    expect(query.company?.industries).toEqual(config.companyProfile.industries);
    expect(query.company?.employeeMin).toBe(config.companyProfile.employeeRange.min);
    expect(query.company?.employeeMax).toBe(config.companyProfile.employeeRange.max);
  });

  it('leaves an unset employee bound absent rather than inventing one', () => {
    const config = exampleConfig();
    const query = mapIcpToPeopleQuery({
      ...config,
      companyProfile: { ...config.companyProfile, employeeRange: {} },
    });

    // A fabricated 0 or ceiling here would look like the user's own choice, and
    // the adapter is the layer that decides what an open bound means.
    expect(query.company).not.toHaveProperty('employeeMin');
    expect(query.company).not.toHaveProperty('employeeMax');
  });

  it('does not carry anything a provider cannot filter on', () => {
    // Must-have rules, triggers, evidence settings and scoring weights are all
    // qualification, applied after retrieval. Pushing them into a provider
    // query would trade recall for a filter the pipeline applies anyway.
    const query = mapIcpToPeopleQuery(exampleConfig());
    const keys = Object.keys(query);

    expect(keys.sort()).toEqual(['buyer', 'company', 'page', 'perPage']);
  });

  it('defaults to the first page at the default page size', () => {
    const query = mapIcpToPeopleQuery(exampleConfig());
    expect(query.page).toBe(1);
    expect(query.perPage).toBe(PEOPLE_PER_PAGE_DEFAULT);
  });

  it('passes the requested page through', () => {
    const query = mapIcpToPeopleQuery(exampleConfig(), { page: 4, perPage: 10 });
    expect(query).toMatchObject({ page: 4, perPage: 10 });
  });
});

describe('mapIcpToPeopleQuery - the analysis contribution', () => {
  it('adds the analysis buyer roles as free-text titles', () => {
    const query = mapIcpToPeopleQuery(exampleConfig(), {
      analysis: analysisWithRoles(['Head of Digital Transformation', 'VP Engineering']),
    });

    expect(query.buyer?.freeTextTitles).toEqual([
      'Head of Digital Transformation',
      'VP Engineering',
    ]);
  });

  it('keeps them separate from the catalog titles', () => {
    const config = exampleConfig();
    const query = mapIcpToPeopleQuery(config, {
      analysis: analysisWithRoles(['Head of Digital Transformation']),
    });

    // One list is a person's controlled choice and the other is a model's
    // inference. A search that mixes them cannot be audited afterwards.
    expect(query.buyer?.titles).toEqual(config.targetBuyer.titles);
    expect(query.buyer?.titles).not.toContain('Head of Digital Transformation');
  });

  it('never narrows the search: without an analysis the query is a subset', () => {
    const config = exampleConfig();
    const withAnalysis = mapIcpToPeopleQuery(config, { analysis: analysisWithRoles(['CTO']) });
    const without = mapIcpToPeopleQuery(config);

    expect(withAnalysis.buyer?.titles).toEqual(without.buyer?.titles);
    expect(withAnalysis.company).toEqual(without.company);
    expect(without.buyer).not.toHaveProperty('freeTextTitles');
  });

  it('omits the list entirely when there is no analysis', () => {
    const query = mapIcpToPeopleQuery(exampleConfig(), { analysis: null });
    expect(query.buyer).not.toHaveProperty('freeTextTitles');
  });
});

describe('analysisTitles - which model prose survives as a filter', () => {
  it('drops a role too long to be a job title', () => {
    // A provider matches these against a real job title, so a sentence matches
    // nobody - a filter that can only ever return zero is worse than no filter.
    const long = 'VP of Engineering at a mid-market manufacturer undergoing an ERP replacement';
    expect(analysisTitles(analysisWithRoles(['CTO', long]))).toEqual(['CTO']);
  });

  it('de-duplicates roles the model repeated', () => {
    expect(analysisTitles(analysisWithRoles(['CTO', 'CTO', 'CIO']))).toEqual(['CTO', 'CIO']);
  });

  it('caps how many roles may widen one search', () => {
    const roles = Array.from({ length: 12 }, (_, index) => `Head of Area ${String(index)}`);
    expect(analysisTitles(analysisWithRoles(roles))).toHaveLength(8);
  });

  it('returns nothing for no analysis', () => {
    expect(analysisTitles(null)).toEqual([]);
    expect(analysisTitles(undefined)).toEqual([]);
  });
});
