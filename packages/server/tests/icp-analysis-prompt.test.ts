import { describe, expect, it } from 'vitest';
import {
  ICP_ANALYSIS_SECTIONS,
  buildIcpModelInput,
  createExampleIcpConfig,
} from '@pursuit/shared';
import {
  ICP_ANALYSIS_PROMPT_VERSION,
  ICP_ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisCorrection,
  buildIcpAnalysisUserPrompt,
} from '../src/modules/model/icp-analysis-prompt.js';

/**
 * The prompt is not decoration, and this file exists because that is easy to
 * forget when reading it.
 *
 * Groq's strict Structured Outputs *validates after generating* rather than
 * constraining the decoder, so the JSON Schema rejects a bad answer instead of
 * preventing one. Every rule asserted below was added after watching a real run
 * fail without it, and each is a plausible casualty of a later tidy-up - the
 * prompt is long, and most of it reads like belt-and-braces next to a schema
 * that is also sent.
 *
 * So these tests are deliberately about *content*, not wording: they pin the
 * rules, name the failure each one prevents, and leave the phrasing free. If
 * one starts failing, the question to ask is whether the failure it guards
 * against can still happen - not how to make the assertion pass.
 */

function modelInput() {
  return buildIcpModelInput({
    icpId: '11111111-1111-4111-8111-111111111111',
    icpVersion: 1,
    config: createExampleIcpConfig(),
  });
}

describe('the analysis prompt states the task', () => {
  it('is versioned, so a stored analysis is traceable to its instructions', () => {
    expect(ICP_ANALYSIS_PROMPT_VERSION).toBe('v3');
  });

  /** The whole reason v2 was replaced. */
  it('forbids restating the configuration and demands cross-field reasoning', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toContain('NOT to repeat, restate or summarize');
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toContain('REASON ACROSS FIELDS');
  });

  /**
   * Rules alone did not stop the enum echoing; a worked contrast did. Keeping
   * both examples matters more than either instruction near them.
   */
  it('shows a rejected answer next to an acceptable one', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toContain('BAD output');
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toContain('GOOD output');
  });

  it('bans invented company facts and requires hedged inference', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/Never invent a company/);
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/hedged language/);
  });

  it('keeps prospects, scores and ranks out of the analysis', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/Do not produce prospects, contacts, scores/);
  });
});

// ---------------------------------------------------------------------------
// Structural rules, each traceable to an observed failure
// ---------------------------------------------------------------------------

describe('the analysis prompt pins the answer shape', () => {
  /**
   * Observed: the model returned a top-level JSON *array*. Nothing had ever
   * said the answer is one object - "matching the supplied schema" was carrying
   * that implicitly, and implicitly was not enough.
   */
  it('states that the answer is one object and forbids an array wrapper', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toContain('Do NOT return an array');
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/top-level KEYS/);
    // The `[]` notation used below it is the reason the wrapper is tempting.
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/arrays INSIDE that object/);
  });

  /** Groq only validates, so the sections have to be asked for by name. */
  it('names every section the contract requires, in contract order', () => {
    for (const section of ICP_ANALYSIS_SECTIONS) {
      expect(ICP_ANALYSIS_SYSTEM_PROMPT).toContain(section);
    }
    const positions = ICP_ANALYSIS_SECTIONS.map((section) =>
      ICP_ANALYSIS_SYSTEM_PROMPT.indexOf(section),
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  /** Observed: `technologyIntelligence[].technologies` went missing. */
  it('lists the required keys, and flags the one that goes missing', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toContain('REQUIRED KEYS');
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/most commonly forgotten key/);
  });

  /**
   * Groq's strict mode requires `additionalProperties: false`, so an extra key
   * is a rejected request even though the Zod contract would strip it. The
   * divergence can only be closed from the prompt side.
   */
  it('forbids volunteering a key of its own', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/NO OTHERS/);
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/do not volunteer/);
  });

  /** Observed: four fit criteria arrived as one comma-separated string. */
  it('requires one idea per array entry', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/one idea per entry/);
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/comma-separated/);
  });

  /** Observed: `strategy` and `purpose` were filled in the wrong order. */
  it('distinguishes the discovery strategy label from its purpose', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/SHORT LABEL/);
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/Do not swap these two fields/);
  });

  /** Observed: `companyStage` came back as the employee and revenue bands. */
  it('restricts companyStage to a stage name', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/companyStage is ONLY a stage name/);
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/must not contain employee counts/);
  });

  /** Observed: every evidence list came back full of raw source-type codes. */
  it('confines source type codes to evidenceTypes', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/ONLY place a source type/);
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toContain('JOB_POSTING');
  });

  /** Observed: hypotheses asserted readiness and attached deal values. */
  it('requires hypotheses to stay hypotheses', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/hypothesis awaiting evidence/);
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/Do not attach a deal value/);
  });

  /**
   * The counts left the Zod contract because ten simultaneous `minItems` were
   * throwing away good analyses. The volume has to be asked for somewhere.
   */
  it('asks for volume, since the contract no longer enforces counts', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toContain('HOW MUCH TO PRODUCE');
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/never return an empty section/);
  });

  /** The explanation floor is enforced by Zod; the model has to be told. */
  it('warns that short explanations are rejected', () => {
    expect(ICP_ANALYSIS_SYSTEM_PROMPT).toMatch(/at least fifteen words/);
  });
});

// ---------------------------------------------------------------------------
// The user turn
// ---------------------------------------------------------------------------

describe('the analysis user turn', () => {
  /**
   * The input-side half of v3. Handed `"requiredTechnologies": ["NODEJS"]`, the
   * model's most defensible answer was that NODEJS is required.
   */
  it('sends the decoded briefing, not the raw configuration', () => {
    const prompt = buildIcpAnalysisUserPrompt(modelInput());

    expect(prompt).toContain('=== ICP BRIEFING ===');
    expect(prompt).toContain('Legacy ERP');
    expect(prompt).not.toContain('LEGACY_ERP');
    expect(prompt).not.toContain('requiredTechnologies');
  });

  it('carries no correction on a first attempt', () => {
    expect(buildIcpAnalysisUserPrompt(modelInput())).not.toContain('REJECTED');
  });

  it('appends the correction on a retry, keeping the briefing intact', () => {
    const prompt = buildIcpAnalysisUserPrompt(
      modelInput(),
      buildAnalysisCorrection([
        { path: 'output.fitModel.strongFit', message: 'minimum 2 items required' },
      ]),
    );

    expect(prompt).toContain('=== ICP BRIEFING ===');
    expect(prompt).toContain('was REJECTED');
    expect(prompt).toContain('fitModel.strongFit');
    expect(prompt).toContain('minimum 2 items required');
  });
});

describe('buildAnalysisCorrection', () => {
  /**
   * A retry is worth making only if the model is told what broke: at low
   * temperature the same question produces the same structural mistake.
   */
  it('names the breaches and asks for the whole analysis again', () => {
    const correction = buildAnalysisCorrection([
      { path: 'output', message: 'expected object, but got array' },
    ]);

    expect(correction).toContain('expected object, but got array');
    expect(correction).toMatch(/Produce the analysis again/);
    expect(correction).toMatch(/ONE JSON object/);
  });

  /** A breach on the answer as a whole has no field to name. */
  it('describes a whole-answer breach without inventing a field', () => {
    expect(buildAnalysisCorrection([{ path: 'output', message: 'bad root' }])).toContain(
      '(the whole answer)',
    );
  });

  it('still asks for a valid answer when no breach could be identified', () => {
    const correction = buildAnalysisCorrection([]);

    expect(correction).toMatch(/did not satisfy the required JSON shape/);
    expect(correction).toMatch(/Produce the analysis again/);
  });

  /** A rejected answer is never quoted back: this is a retry, not a patch. */
  it('does not tell the model what to write instead', () => {
    const correction = buildAnalysisCorrection([
      { path: 'output.painHypotheses', message: 'minimum 1 items required' },
    ]);

    expect(correction).not.toMatch(/here is|use this|corrected/i);
  });
});
