import { describe, expect, it } from 'vitest';
import {
  buildIcpBriefing,
  createEmptyIcpConfig,
  createExampleIcpConfig,
  type IcpConfig,
} from '../src/index.js';

function briefing(mutate?: (config: IcpConfig) => void): string {
  const config = createExampleIcpConfig();
  mutate?.(config);
  return buildIcpBriefing(config);
}

/**
 * The briefing exists to fix a measured failure: handed `"NODEJS"`, the model
 * answered `NODEJS`. These tests are about the one property that fix depends
 * on - that no raw catalog code reaches the model where a human word exists -
 * and about the reproducibility the input snapshot relies on.
 */
describe('buildIcpBriefing - decoding codes into language', () => {
  it('writes technology, industry and legacy values as words', () => {
    const text = briefing();

    expect(text).toContain('.NET');
    expect(text).toContain('SQL Server');
    expect(text).toContain('Legacy ERP');
    expect(text).toContain('Monolithic architecture');
    expect(text).toContain('Financial services');
    expect(text).toContain('Microsoft Azure');
  });

  it('writes geography as country names rather than ISO codes', () => {
    const text = briefing();

    expect(text).toContain('Netherlands');
    expect(text).toContain('Belgium');
    expect(text).toContain('Headquarters only');
  });

  it('writes the services, problems and buyer catalogs as words', () => {
    const text = briefing();

    expect(text).toContain('Platform modernization');
    expect(text).toContain('Cloud migration');
    expect(text).toContain('Legacy modernization');
    expect(text).toContain('Scaling engineering capacity');
    expect(text).toContain('Director of IT');
    expect(text).toContain('Decision maker required');
  });

  /**
   * The guard on the actual regression. Any of these appearing means a value
   * reached the model as an opaque token, which is the input condition that
   * produced "technology.requiredTechnologies includes NODEJS".
   */
  it('leaks no screaming-snake-case catalog code except the source types', () => {
    const text = briefing();

    for (const code of [
      'DOTNET',
      'SQL_SERVER',
      'LEGACY_ERP',
      'MONOLITHIC_ARCHITECTURE',
      'FINANCIAL_SERVICES',
      'PLATFORM_MODERNIZATION',
      'LEGACY_MODERNIZATION',
      'DIRECTOR_OF_IT',
      'RECENT_HIRING',
      'HEADQUARTERS_ONLY',
      'FROM_150K_TO_500K',
      'DECISION_MAKER_REQUIRED',
    ]) {
      expect(text).not.toContain(code);
    }
  });

  /**
   * The one exception, and it is deliberate: `evidenceStrategy.evidenceTypes` is
   * an enum in the output contract, so the model has to be told the codes it is
   * allowed to answer with. They are labelled as such rather than smuggled in.
   */
  it('supplies the allowed evidence source codes verbatim, because the output needs them back', () => {
    const text = briefing();

    expect(text).toContain('use these verbatim');
    expect(text).toContain('JOB_POSTING');
    // Alongside the human wording, so the model can reason and answer.
    expect(text).toContain('Job posting');
  });

  it('names the ICP-level evidence limits the analysis has to work inside', () => {
    const text = briefing();

    expect(text).toContain('Maximum evidence age: 365 days');
    expect(text).toContain('Independent sources required per claim: 2');
    expect(text).toContain('Minimum source reliability: Medium');
  });
});

describe('buildIcpBriefing - readability of numbers and rules', () => {
  it('renders employee and revenue bands rather than raw integers', () => {
    const text = briefing();

    expect(text).toContain('200 to 5,000');
    expect(text).toContain('25M EUR to 750M EUR');
  });

  it('says "not restricted" for an unset range instead of implying zero', () => {
    const text = briefing((config) => {
      config.companyProfile.employeeRange = {};
    });

    expect(text).toContain('Employees: not restricted');
  });

  it('renders a stored rule as a sentence', () => {
    const text = briefing();

    expect(text).toContain('Country is any of Netherlands, Belgium, Luxembourg');
    expect(text).toContain('Employee count is at least 200');
  });

  it('describes a trigger with its polarity, decay and lookback', () => {
    const text = briefing();

    expect(text).toContain('Recent hiring (Positive, Transient (decays fast), relevance 8/10, counts for 90 days)');
  });
});

describe('buildIcpBriefing - structure', () => {
  /**
   * Empty headings are worse than absent ones: a section with nothing under it
   * reads to a model as a dimension it is expected to fill in.
   */
  it('omits a section the ICP says nothing about', () => {
    const text = briefing((config) => {
      config.technology = {
        requiredTechnologies: [],
        preferredTechnologies: [],
        excludedTechnologies: [],
        technologyMaturities: [],
        cloudProviders: [],
        legacyIndicators: [],
      };
    });

    expect(text).not.toContain('TECHNOLOGY ENVIRONMENT');
    // The rest of the briefing is unaffected.
    expect(text).toContain('COMPANY PROFILE');
  });

  it('keeps the modern stack and the legacy estate in one section, so they read together', () => {
    const text = briefing();
    const technologySection = text
      .split('\n\n')
      .find((section) => section.startsWith('TECHNOLOGY ENVIRONMENT'));

    expect(technologySection).toBeDefined();
    expect(technologySection).toContain('.NET');
    expect(technologySection).toContain('Legacy ERP');
  });

  /**
   * The stored `inputSnapshot` is the normalized ICP, not the briefing, so a
   * result only stays reproducible if the same snapshot always renders the same
   * text.
   */
  it('is a deterministic function of the configuration', () => {
    expect(buildIcpBriefing(createExampleIcpConfig())).toBe(
      buildIcpBriefing(createExampleIcpConfig()),
    );
  });

  it('does not fall over on a structurally complete but empty draft', () => {
    // Not a valid ICP - `icpConfigSchema` rejects it - but the renderer must
    // not be the thing that throws if one ever reaches it.
    expect(() => buildIcpBriefing(createEmptyIcpConfig())).not.toThrow();
  });
});
