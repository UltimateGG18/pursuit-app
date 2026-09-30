import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_IMPORTANCES,
  BUYER_PRIORITIES,
  ICP_ANALYSIS_SCHEMA_VERSION,
  ICP_ANALYSIS_SCHEMA_VERSION_V1,
  ICP_ANALYSIS_SECTIONS,
  ICP_SCHEMA_VERSION,
  buildIcpModelInput,
  createExampleAnalysisOutput,
  createExampleIcpConfig,
  icpAnalysisOutputJsonSchema,
  icpAnalysisOutputSchema,
  icpModelInputSchema,
  isCurrentAnalysisSchema,
  readAnalysisOutput,
  type IcpAnalysisOutput,
} from '../src/index.js';

const ICP_ID = '11111111-1111-4111-8111-111111111111';

function validOutput(overrides?: Partial<IcpAnalysisOutput>): IcpAnalysisOutput {
  return { ...createExampleAnalysisOutput(), ...overrides };
}

/** Long enough to satisfy the explanation floor, so a test can vary one thing. */
function explanation(text = 'This is a full sentence of reasoning about the target company class.'): string {
  return text;
}

describe('icpModelInputSchema', () => {
  it('accepts a normalized ICP and stamps the contract version', () => {
    const input = buildIcpModelInput({
      icpId: ICP_ID,
      icpVersion: 3,
      config: createExampleIcpConfig(),
    });

    const parsed = icpModelInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect(input.schemaVersion).toBe(ICP_SCHEMA_VERSION);
  });

  it('clones the configuration, so an analysis cannot reach the stored ICP', () => {
    const config = createExampleIcpConfig();
    const input = buildIcpModelInput({ icpId: ICP_ID, icpVersion: 1, config });

    input.icp.basicProfile.name = 'Rewritten by the model layer';

    expect(config.basicProfile.name).not.toBe('Rewritten by the model layer');
  });

  it('rejects an input carrying an unknown field', () => {
    const input = {
      ...buildIcpModelInput({ icpId: ICP_ID, icpVersion: 1, config: createExampleIcpConfig() }),
      prospects: [],
    };
    expect(icpModelInputSchema.safeParse(input).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The contract is the deliverable: it has to carry every kind of intelligence
// the discovery stage is being promised, not just be internally consistent.
// ---------------------------------------------------------------------------

describe('icpAnalysisOutputSchema - the intelligence contract', () => {
  it('accepts a complete analysis', () => {
    const parsed = icpAnalysisOutputSchema.safeParse(validOutput());
    expect(parsed.success).toBe(true);
  });

  it('requires all twelve intelligence sections and nothing less', () => {
    expect([...ICP_ANALYSIS_SECTIONS]).toEqual([
      'icpInterpretation',
      'idealCompanyProfile',
      'painHypotheses',
      'intentSignals',
      'technologyIntelligence',
      'serviceFit',
      'discoveryStrategy',
      'searchQueryStrategy',
      'evidenceStrategy',
      'buyerStrategy',
      'fitModel',
      'opportunityHypotheses',
    ]);
  });

  it.each(ICP_ANALYSIS_SECTIONS)('rejects an analysis missing %s', (section) => {
    const { [section]: _dropped, ...incomplete } = validOutput();

    const parsed = icpAnalysisOutputSchema.safeParse(incomplete);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path[0] === section)).toBe(true);
  });

  /**
   * These assertions are about *what the contract promises downstream*, not
   * about the example fixture. Prospect discovery is being built against these
   * fields, so a rename that silently drops one has to fail here.
   */
  it('carries the interpretation, the ideal profile and the buying context', () => {
    const output = validOutput();

    expect(Object.keys(output.icpInterpretation).sort()).toEqual([
      'buyingContext',
      'primaryOpportunity',
      'targetProfile',
    ]);
    expect(Object.keys(output.idealCompanyProfile).sort()).toEqual([
      'companyStage',
      'likelyBuyingSituation',
      'likelyEngineeringSituation',
      'likelyTechnologyEnvironment',
      'likelyTransformationStage',
    ]);
  });

  it('carries pain hypotheses with impact and observable evidence', () => {
    const [pain] = validOutput().painHypotheses;

    expect(pain?.problem.length).toBeGreaterThan(0);
    expect(ANALYSIS_IMPORTANCES).toContain(pain?.severity);
    expect(pain?.businessImpact.length).toBeGreaterThan(0);
    expect(pain?.observableEvidence.length).toBeGreaterThan(0);
  });

  it('carries intent signals with a freshness window', () => {
    const [signal] = validOutput().intentSignals;

    expect(signal?.lookbackDays).toBeGreaterThan(0);
    expect(signal?.evidenceToFind.length).toBeGreaterThan(0);
  });

  /** The whole point of this section is the relationship between technologies. */
  it('carries technology patterns spanning several technologies', () => {
    const [pattern] = validOutput().technologyIntelligence;

    expect(pattern?.technologies.length).toBeGreaterThan(1);
    expect(pattern?.interpretation.length).toBeGreaterThan(0);
    expect(pattern?.discoveryImplication.length).toBeGreaterThan(0);
  });

  it('carries a discovery strategy with an ordered sequence', () => {
    const { discoveryStrategy } = validOutput();

    expect(discoveryStrategy.primaryApproaches.length).toBeGreaterThanOrEqual(2);
    expect(discoveryStrategy.recommendedSequence.length).toBeGreaterThanOrEqual(3);
  });

  it('carries search query families rather than a flat keyword list', () => {
    const [group] = validOutput().searchQueryStrategy;

    expect(group?.purpose.length).toBeGreaterThan(0);
    expect(group?.queries.length).toBeGreaterThanOrEqual(2);
  });

  it('carries an evidence strategy addressed in the ICP source vocabulary', () => {
    const [requirement] = validOutput().evidenceStrategy;

    expect(requirement?.evidenceTypes).toContain('JOB_POSTING');
    expect(requirement?.freshnessDays).toBeGreaterThan(0);
    expect(requirement?.minimumCorroboration).toBeGreaterThanOrEqual(1);
  });

  it('carries a buyer strategy, a fit model and opportunity hypotheses', () => {
    const output = validOutput();

    const [buyer] = output.buyerStrategy;
    expect(buyer?.role.length).toBeGreaterThan(0);
    expect(BUYER_PRIORITIES).toContain(buyer?.priority);
    expect(buyer?.whyTarget.length).toBeGreaterThan(0);
    expect(output.fitModel.strongFit.length).toBeGreaterThanOrEqual(3);
    expect(output.fitModel.disqualifiers.length).toBeGreaterThanOrEqual(1);
    expect(output.opportunityHypotheses.length).toBeGreaterThanOrEqual(2);
  });

  it('strips an extra key rather than failing the whole analysis', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({ ...validOutput(), finalScore: 87 });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty('finalScore');
  });

  /**
   * A score, a rank or a named prospect is not an extra field to be tolerated -
   * it is the model doing a downstream stage's job. Stripping is the right
   * behaviour, but the point is that nothing of the sort is ever *stored*.
   */
  it('never stores a fabricated prospect or a score, even when one is offered', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      prospects: [{ company: 'Acme Technologies Pvt Ltd', domain: 'acme.example' }],
      icpScore: 92,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty('prospects');
    expect(parsed.data).not.toHaveProperty('icpScore');
  });
});

// ---------------------------------------------------------------------------
// Rejections. The gate is only worth having if it actually closes.
// ---------------------------------------------------------------------------

describe('icpAnalysisOutputSchema - rejected output', () => {
  it('rejects prose in place of the whole analysis', () => {
    expect(icpAnalysisOutputSchema.safeParse('Here is my analysis!').success).toBe(false);
  });

  it('rejects a section that is prose instead of a list', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      painHypotheses: 'They probably have a legacy problem.',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an object where the contract expects a list of objects', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      searchQueryStrategy: { purpose: 'Modernisation', queries: ['"platform modernization"'] },
    });
    expect(parsed.success).toBe(false);
  });

  /**
   * The regression this whole contract exists to prevent, in the exact shape
   * the v1 pipeline used to produce it.
   *
   * The explanation floor is a partial gate, deliberately: it catches the short
   * answers a field echo produces, and it cannot catch a verbose one. A longer
   * restatement is the prompt's job to prevent, not the schema's - so this test
   * asserts what the schema really guarantees rather than implying it can judge
   * content.
   */
  it('rejects the field-echo entry the previous contract used to produce', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      technologyIntelligence: [
        {
          pattern: 'Node.js',
          technologies: ['Node.js'],
          interpretation: 'Node.js is required',
          discoveryImplication: 'Find Node.js companies',
          evidenceToFind: ['Node.js'],
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('technologyIntelligence.0.interpretation');
    expect(paths).toContain('technologyIntelligence.0.discoveryImplication');
  });

  it('rejects an interpretation section whose fields are one-liners', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      icpInterpretation: {
        targetProfile: 'SaaS companies',
        primaryOpportunity: 'Modernization',
        buyingContext: 'They buy',
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unsupported severity value rather than coercing it', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      painHypotheses: validOutput().painHypotheses.map((pain) => ({ ...pain, severity: 'URGENT' })),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unsupported buyer priority', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      buyerStrategy: [
        {
          role: 'CTO',
          priority: 'MOST_IMPORTANT',
          whyTarget: explanation(),
          painTopics: ['Legacy modernisation'],
          relevantSignals: ['New CTO appointment'],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  /**
   * Free-text evidence types would make the evidence strategy unusable by the
   * discovery stage, which matches sources by code.
   */
  it('rejects an evidence type outside the ICP source catalog', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      evidenceStrategy: validOutput().evidenceStrategy.map((requirement) => ({
        ...requirement,
        evidenceTypes: ['Twitter rumour'],
      })),
    });
    expect(parsed.success).toBe(false);
  });

  /**
   * The degenerate case a count minimum is actually good for.
   *
   * The minimums used to be higher - two hypotheses, three fit criteria - and
   * that cost more than it bought: Groq validates after generating, so each
   * count was its own chance of throwing away a good analysis. A section the
   * model simply skipped is still rejected, which is the case that matters.
   */
  it.each(['painHypotheses', 'evidenceStrategy', 'searchQueryStrategy', 'opportunityHypotheses'])(
    'rejects an empty %s',
    (section) => {
      const parsed = icpAnalysisOutputSchema.safeParse({ ...validOutput(), [section]: [] });
      expect(parsed.success).toBe(false);
    },
  );

  it('accepts a single strong entry where the ICP supports only one', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      painHypotheses: [validOutput().painHypotheses[0]],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an intent lookback outside the supported window', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      intentSignals: validOutput().intentSignals.map((signal) => ({
        ...signal,
        lookbackDays: 5000,
      })),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a corroboration count the evidence model cannot express', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      evidenceStrategy: validOutput().evidenceStrategy.map((requirement) => ({
        ...requirement,
        minimumCorroboration: 0,
      })),
    });
    expect(parsed.success).toBe(false);
  });

  /** A single step is not a sequence, whatever else the section contains. */
  it('rejects a discovery strategy whose sequence cannot express an order', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      discoveryStrategy: {
        primaryApproaches: [{ strategy: 'Firmographic', purpose: explanation() }],
        recommendedSequence: ['Find companies'],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a fit model with no disqualifiers', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      fitModel: { ...validOutput().fitModel, disqualifiers: [] },
    });
    expect(parsed.success).toBe(false);
  });

  /** One criterion separates nothing from anything. */
  it('rejects a fit model with a single strong-fit criterion', () => {
    const parsed = icpAnalysisOutputSchema.safeParse({
      ...validOutput(),
      fitModel: { ...validOutput().fitModel, strongFit: ['India headquarters'] },
    });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The decoding constraint, and reading a stored row back
// ---------------------------------------------------------------------------

describe('icpAnalysisOutputJsonSchema', () => {
  /**
   * The JSON Schema is what constrains decoding, so a section missing from it
   * is a section the model is free to omit. Deriving it from the Zod schema is
   * what keeps the two in step; this asserts the derivation actually happened.
   */
  it('requires every section the Zod contract requires', () => {
    const required = icpAnalysisOutputJsonSchema.required as string[];
    expect(required).toEqual(expect.arrayContaining([...ICP_ANALYSIS_SECTIONS]));
  });

  it('pins the analysis contract version used for stored results', () => {
    expect(ICP_ANALYSIS_SCHEMA_VERSION).toBe('icp-analysis.v2');
  });
});

describe('readAnalysisOutput', () => {
  it('reads a row written under the current contract', () => {
    const output = readAnalysisOutput({
      analysisSchemaVersion: ICP_ANALYSIS_SCHEMA_VERSION,
      output: validOutput(),
    });

    expect(output?.icpInterpretation.targetProfile.length).toBeGreaterThan(0);
  });

  /**
   * A `v1` row is a complete, honest analysis of its own contract - it is just
   * not this one. Reporting it as unreadable is what lets the UI offer a re-run
   * instead of rendering twelve empty sections.
   */
  it('refuses to read a row written under the previous contract', () => {
    const legacyRow = {
      analysisSchemaVersion: ICP_ANALYSIS_SCHEMA_VERSION_V1,
      output: { summary: 'A v1 analysis', industrySignals: [] },
    };

    expect(isCurrentAnalysisSchema(legacyRow.analysisSchemaVersion)).toBe(false);
    expect(readAnalysisOutput(legacyRow)).toBeNull();
  });

  it('refuses a row whose stored shape no longer satisfies the contract', () => {
    const output = readAnalysisOutput({
      analysisSchemaVersion: ICP_ANALYSIS_SCHEMA_VERSION,
      output: { icpInterpretation: { targetProfile: 'short' } },
    });

    expect(output).toBeNull();
  });

  it('reports a failed run as having no analysis', () => {
    expect(
      readAnalysisOutput({ analysisSchemaVersion: ICP_ANALYSIS_SCHEMA_VERSION, output: null }),
    ).toBeNull();
  });
});
