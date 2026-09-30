import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { SOURCE_TYPES } from '../icp/catalogs/evidence.js';
import { ICP_SCHEMA_VERSION, icpConfigSchema, type IcpConfig } from '../icp/schema.js';

/**
 * ICP analysis contract - the intelligence layer between an ICP configuration
 * and prospect discovery.
 *
 * The model does not summarize the ICP. It reasons *across* it and produces the
 * things a discovery stage cannot derive from the configuration on its own:
 * what kind of company to look for, why that company is likely to need the
 * service, what would prove it, what to search for, and who to talk to.
 *
 * That distinction is the whole point of `v2`. The `v1` contract had one array
 * per ICP section - `industrySignals`, `technologySignals`, `mustHaveSignals` -
 * and a schema shaped like the input gets an answer shaped like the input: the
 * model reliably produced entries such as `{ label: "Node.js", rationale:
 * "technology.requiredTechnologies includes NODEJS" }`. No prompt fixes that,
 * because the schema itself was asking for a field-by-field restatement. `v2`
 * asks a different set of questions, none of which can be answered by echoing a
 * field:
 *
 *   icpInterpretation      what this configuration means as a targeting strategy
 *   idealCompanyProfile    the inferred shape of a strong account
 *   painHypotheses         why the configured problems are likely, and what they cost
 *   intentSignals          what makes a need current, and how it can be observed
 *   technologyIntelligence what *combinations* of technologies imply
 *   serviceFit             why such a company would buy each service
 *   discoveryStrategy      how to find these accounts
 *   searchQueryStrategy    the concrete queries a search provider would run
 *   evidenceStrategy       what must be proven before an account qualifies
 *   buyerStrategy          who to approach and what they care about
 *   fitModel               what separates a strong, a weak and a disqualified account
 *   opportunityHypotheses  the commercial bets worth investigating
 *
 * Everything here is a *hypothesis about a class of company*, never a claim
 * about a named one: no section may contain a prospect, a company fact or a
 * score. Those belong to discovery and to deterministic scoring, downstream.
 *
 * Two schemas live in this file:
 *   icpModelInputSchema     - the normalized payload handed to the provider
 *   icpAnalysisOutputSchema - the only shape the API will persist
 */

/**
 * Version of the analysis output contract, stored with every analysis row.
 *
 * Bumped from `icp-analysis.v1` because the sections, not just their wording,
 * changed. A stored v1 row keeps its own version and stays readable as the
 * thing it always was; nothing rewrites it into v2, and `readAnalysisOutput`
 * refuses to interpret it as v2 intelligence.
 */
export const ICP_ANALYSIS_SCHEMA_VERSION = 'icp-analysis.v2';

/** The previous contract. Kept so a stored row can still be recognised. */
export const ICP_ANALYSIS_SCHEMA_VERSION_V1 = 'icp-analysis.v1';

/**
 * Strength scale, shared by every graded section (pain severity, intent
 * strength, service fit, evidence importance). One scale rather than four so a
 * discovery stage can order work across sections without a translation table.
 */
export const ANALYSIS_IMPORTANCES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type AnalysisImportance = (typeof ANALYSIS_IMPORTANCES)[number];

/** How a buyer role ranks in an outreach sequence. */
export const BUYER_PRIORITIES = ['PRIMARY', 'SECONDARY', 'TERTIARY'] as const;
export type BuyerPriority = (typeof BUYER_PRIORITIES)[number];

// ---------------------------------------------------------------------------
// Model input
// ---------------------------------------------------------------------------

/**
 * What the provider receives. The whole normalized configuration is included
 * because the analysis has to reason across sections; the ICP itself is never
 * mutated by this stage, and this exact object is stored as the analysis input
 * snapshot so a result stays reproducible after the ICP is edited.
 */
export const icpModelInputSchema = z
  .object({
    icpId: z.string().uuid(),
    icpVersion: z.number().int().min(1),
    schemaVersion: z.literal(ICP_SCHEMA_VERSION),
    icp: icpConfigSchema,
  })
  .strict();

export type IcpModelInput = z.output<typeof icpModelInputSchema>;

export function buildIcpModelInput(args: {
  icpId: string;
  icpVersion: number;
  config: IcpConfig;
}): IcpModelInput {
  return {
    icpId: args.icpId,
    icpVersion: args.icpVersion,
    schemaVersion: ICP_SCHEMA_VERSION,
    // Cloned so the stored configuration cannot be reached, let alone
    // rewritten, through the object handed to a provider.
    icp: structuredClone(args.config),
  };
}

// ---------------------------------------------------------------------------
// Output primitives
// ---------------------------------------------------------------------------

/** A name: a service, a technology pattern, a claim, a role. */
const name = z.string().trim().min(3, 'Too short to name anything').max(200);

/**
 * A reasoned explanation.
 *
 * The 40-character floor is a deliberate quality gate rather than a formatting
 * rule. Every failure mode this contract exists to prevent is short - "includes
 * NODEJS", "configured industry", "is required" - and a length floor is the one
 * part of "explain your reasoning" that a schema can actually enforce. The
 * prompt asks for a full sentence; this makes a bare field echo fail validation
 * instead of being stored as intelligence.
 */
const reasoning = z
  .string()
  .trim()
  .min(40, 'An explanation must be a full sentence, not a restated field')
  .max(700);

/**
 * A stated intent, rather than a reasoned inference.
 *
 * Distinct from `reasoning` on purpose. "Narrow the search space to companies
 * of the right size before any per-company work" is a complete answer to *what
 * is this step for*, and holding it to the explanation floor would be asking
 * for padding. The floor is still high enough to reject a bare label.
 */
const statement = z.string().trim().min(20, 'Say what this is for, not just what it is').max(400);

/** One item in a list of observable things: an evidence type, a signal, a fact. */
const bullet = z.string().trim().min(3).max(160);

const bullets = (min: number, max: number) => z.array(bullet).min(min).max(max);

const importance = z.enum(ANALYSIS_IMPORTANCES);

/** Freshness window for a signal, in days. Up to three years. */
const lookbackDays = z.number().int().min(1).max(1095);

// ---------------------------------------------------------------------------
// Output sections
// ---------------------------------------------------------------------------

/**
 * A. What the ICP means as a targeting strategy.
 *
 * Three questions the configuration does not answer by itself: who is actually
 * being targeted, what the commercial opening is, and what would make such a
 * company engage an external partner at all.
 */
export const icpInterpretationSchema = z.object({
  targetProfile: reasoning,
  primaryOpportunity: reasoning,
  buyingContext: reasoning,
});

/**
 * B. The inferred shape of a strong account.
 *
 * Every field is an inference about a *class* of company, so the wording is
 * hedged by construction ("likely..."). Nothing here has been observed yet.
 */
export const idealCompanyProfileSchema = z.object({
  /**
   * A stage name - "Established", "Late-stage scale-up". Bounded short for the
   * same reason as `discoveryApproach.strategy`: given room, a model fills this
   * with the employee and revenue bands read back out, which is precisely the
   * restatement the contract exists to stop.
   */
  companyStage: z.string().trim().min(3).max(60, 'A stage is a name, not a restated size band'),
  likelyTechnologyEnvironment: reasoning,
  likelyEngineeringSituation: reasoning,
  likelyTransformationStage: reasoning,
  likelyBuyingSituation: reasoning,
});

/** C. Why a configured problem is likely, what it costs, and what shows it. */
export const painHypothesisSchema = z.object({
  problem: name,
  severity: importance,
  whyLikely: reasoning,
  businessImpact: bullets(1, 6),
  observableEvidence: bullets(1, 8),
});

/** D. What makes the need current, and how that can be seen from outside. */
export const intentSignalSchema = z.object({
  signal: name,
  intentStrength: importance,
  whyItMatters: reasoning,
  /** How far back the signal still counts as current. */
  lookbackDays,
  evidenceToFind: bullets(1, 8),
});

/**
 * E. What a *combination* of technologies implies.
 *
 * `technologies` lists the stack elements the pattern is read from, and
 * `interpretation` is the reading. A single-technology entry is not the
 * intent - the value is in the relationship, e.g. a modern application stack
 * running next to a legacy ERP meaning an organization mid-transition.
 */
export const technologyIntelligenceSchema = z.object({
  pattern: name,
  technologies: bullets(1, 12),
  interpretation: reasoning,
  discoveryImplication: reasoning,
  evidenceToFind: bullets(1, 8),
});

/** F. Why a company in this situation would buy each configured service. */
export const serviceFitSchema = z.object({
  service: name,
  fitStrength: importance,
  whyFit: reasoning,
  likelyBusinessNeed: reasoning,
  evidenceToFind: bullets(1, 8),
});

/**
 * One way of finding accounts, and what it is for.
 *
 * `strategy` is bounded to a label length rather than reusing `name`, because
 * an 80-character ceiling is what stops the two fields being filled in the
 * wrong order - a sentence no longer fits in the slot that wants
 * "Firmographic filtering", so a swap fails validation instead of being stored
 * as a strategy called "Use employee count and revenue to narrow the universe".
 */
export const discoveryApproachSchema = z.object({
  strategy: z.string().trim().min(3).max(80, 'A strategy is a short label, not a sentence'),
  purpose: statement,
});

/**
 * G. How to find these accounts.
 *
 * The blueprint the discovery engine will be built against: which approaches to
 * run, and in what order to run them so the expensive steps only ever see
 * candidates that already passed the cheap ones.
 */
export const discoveryStrategySchema = z.object({
  primaryApproaches: z.array(discoveryApproachSchema).min(1).max(6),
  /** Two steps is the least that can express an ordering at all. */
  recommendedSequence: bullets(2, 10),
});

/**
 * H. Query families for a future search provider.
 *
 * Grouped by purpose rather than emitted as a flat keyword list, because a
 * query only makes sense next to what it is trying to surface - and because the
 * group is the unit a discovery run would schedule and rate-limit.
 */
export const searchQueryGroupSchema = z.object({
  purpose: name,
  queries: z.array(z.string().trim().min(3).max(200)).min(1).max(8),
});

/**
 * I. What must be proven before an account qualifies.
 *
 * `evidenceTypes` is constrained to the ICP's own source catalog rather than
 * free text, so the discovery stage can consume it directly. The ICP's allowed
 * source types, freshness and corroboration settings are the ceiling the model
 * is told to respect; this schema enforces the vocabulary, and the prompt
 * carries the ICP's actual limits.
 */
export const evidenceStrategySchema = z.object({
  claim: name,
  importance,
  evidenceTypes: z.array(z.enum(SOURCE_TYPES)).min(1).max(SOURCE_TYPES.length),
  /** What, concretely, would appear in such a source. */
  signals: bullets(1, 8),
  freshnessDays: z.number().int().min(1).max(1825),
  /** How many independent sources must agree before the claim counts. */
  minimumCorroboration: z.number().int().min(1).max(5),
});

/** J. Who to approach, and what they are likely to care about. */
export const buyerStrategySchema = z.object({
  role: name,
  priority: z.enum(BUYER_PRIORITIES),
  whyTarget: reasoning,
  painTopics: bullets(1, 8),
  relevantSignals: bullets(1, 8),
});

/**
 * K. What separates a strong account from a weak or disqualified one.
 *
 * Deliberately three lists of criteria rather than a score: scoring is
 * deterministic and lives downstream of the model, so the analysis supplies the
 * criteria and never the arithmetic.
 */
export const fitModelSchema = z.object({
  /** Two, because one criterion does not separate anything from anything. */
  strongFit: bullets(2, 10),
  weakFit: bullets(1, 10),
  disqualifiers: bullets(1, 10),
});

/**
 * L. A commercial bet worth investigating.
 *
 * A hypothesis, not a finding: `supportingSignals` is what would make it
 * plausible and `evidenceRequired` is what would make it true. Discovery is
 * expected to try to falsify these.
 */
export const opportunityHypothesisSchema = z.object({
  hypothesis: reasoning,
  supportingSignals: bullets(1, 8),
  evidenceRequired: bullets(1, 8),
});

// ---------------------------------------------------------------------------
// The complete analysis
// ---------------------------------------------------------------------------

/**
 * The complete analysis. Every section is required: the provider asks the model
 * for this exact shape as a decoding constraint, so a missing section means the
 * response is not the thing that was asked for and must not be stored.
 *
 * The objects are intentionally not `.strict()`: an extra key from a model is
 * stripped rather than treated as a failed analysis. Missing or wrongly typed
 * required keys still fail, which is what the validation gate is for.
 *
 * ## Why the array minimums are as low as they are
 *
 * They were higher, and that was a mistake worth recording. Asking for two pain
 * hypotheses, three strong-fit criteria, two query groups of two queries each
 * and so on stacked around ten independent count constraints onto one
 * generation. Groq's strict Structured Outputs *validates after generating*
 * rather than constraining the decoder, so every one of those was its own
 * chance of an HTTP 400 - and on a 20B model they fired often enough that a
 * perfectly good analysis was thrown away because it offered four fit criteria
 * where the schema demanded three in one list and two in another.
 *
 * A count was also the weakest quality signal here. What actually catches a
 * degenerate answer is the *content* gates, and those are all still in force:
 * the explanation floor that rejects a restated field, the enum vocabularies,
 * the short bounds on `companyStage` and `discoveryApproach.strategy` that stop
 * a field being filled with the wrong kind of value, and the required keys. A
 * minimum of one still rejects the genuinely degenerate case - an empty
 * section - which is what a minimum is good for.
 *
 * Volume is asked for in the prompt instead, where falling short costs some
 * richness rather than the whole run. The maximums stay: they keep the answer
 * inside the completion budget, which is a real failure mode.
 */
export const icpAnalysisOutputSchema = z.object({
  icpInterpretation: icpInterpretationSchema,
  idealCompanyProfile: idealCompanyProfileSchema,
  painHypotheses: z.array(painHypothesisSchema).min(1).max(8),
  intentSignals: z.array(intentSignalSchema).min(1).max(10),
  technologyIntelligence: z.array(technologyIntelligenceSchema).min(1).max(6),
  serviceFit: z.array(serviceFitSchema).min(1).max(8),
  discoveryStrategy: discoveryStrategySchema,
  searchQueryStrategy: z.array(searchQueryGroupSchema).min(1).max(8),
  evidenceStrategy: z.array(evidenceStrategySchema).min(1).max(8),
  buyerStrategy: z.array(buyerStrategySchema).min(1).max(8),
  fitModel: fitModelSchema,
  opportunityHypotheses: z.array(opportunityHypothesisSchema).min(1).max(6),
});

/** The sections a complete analysis carries, in the order they are asked for. */
export const ICP_ANALYSIS_SECTIONS = [
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
] as const satisfies readonly (keyof z.output<typeof icpAnalysisOutputSchema>)[];

export type IcpAnalysisSection = (typeof ICP_ANALYSIS_SECTIONS)[number];

export type IcpInterpretation = z.output<typeof icpInterpretationSchema>;
export type IdealCompanyProfile = z.output<typeof idealCompanyProfileSchema>;
export type PainHypothesis = z.output<typeof painHypothesisSchema>;
export type IntentSignal = z.output<typeof intentSignalSchema>;
export type TechnologyIntelligence = z.output<typeof technologyIntelligenceSchema>;
export type ServiceFitIntelligence = z.output<typeof serviceFitSchema>;
export type DiscoveryApproach = z.output<typeof discoveryApproachSchema>;
export type DiscoveryStrategyIntelligence = z.output<typeof discoveryStrategySchema>;
export type SearchQueryGroup = z.output<typeof searchQueryGroupSchema>;
export type EvidenceStrategy = z.output<typeof evidenceStrategySchema>;
export type BuyerStrategy = z.output<typeof buyerStrategySchema>;
export type FitModel = z.output<typeof fitModelSchema>;
export type OpportunityHypothesis = z.output<typeof opportunityHypothesisSchema>;
export type IcpAnalysisOutput = z.output<typeof icpAnalysisOutputSchema>;

/**
 * JSON Schema form of the output contract, derived from the Zod schema so the
 * two cannot drift. Providers that support schema-constrained decoding
 * (Groq's `response_format: json_schema`) send this instead of asking for JSON
 * in prose.
 */
export const icpAnalysisOutputJsonSchema: Record<string, unknown> = zodToJsonSchema(
  icpAnalysisOutputSchema,
  { target: 'jsonSchema7', $refStrategy: 'none' },
);

// ---------------------------------------------------------------------------
// Provider result + health
// ---------------------------------------------------------------------------

/** A successful analysis, stamped so a stored result stays reproducible (B4). */
export interface IcpAnalysisModelResult {
  readonly requestId: string;
  /** Provider id, e.g. `groq`. */
  readonly provider: string;
  /** Concrete model, e.g. `openai/gpt-oss-20b`. */
  readonly model: string;
  readonly promptVersion: string;
  readonly output: IcpAnalysisOutput;
  readonly durationMs: number;
}

export interface ModelProviderHealth {
  readonly available: boolean;
  readonly provider: string;
  readonly model: string;
  readonly checkedAt: string;
  /** Why it is unavailable, or which build answered. Never a raw stack trace. */
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

export const ICP_ANALYSIS_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export type IcpAnalysisStatus = (typeof ICP_ANALYSIS_STATUSES)[number];

export interface IcpAnalysisErrorDto {
  readonly code: string;
  readonly message: string;
}

export interface IcpAnalysisDto {
  readonly id: string;
  readonly icpId: string;
  /** ICP version the analysis ran against. */
  readonly icpVersion: number;
  readonly status: IcpAnalysisStatus;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  /** Output contract this row was written under, e.g. `icp-analysis.v2`. */
  readonly analysisSchemaVersion: string;
  /** The exact normalized input handed to the model. */
  readonly inputSnapshot: unknown;
  /**
   * The stored analysis, or null for a failed run.
   *
   * Typed `unknown` rather than `IcpAnalysisOutput` because a row written under
   * an older contract is still served as the thing it was: only
   * `analysisSchemaVersion` says how to read this. Use `readAnalysisOutput`,
   * which checks the version and re-validates before handing back a typed
   * analysis.
   */
  readonly output: unknown;
  readonly error: IcpAnalysisErrorDto | null;
  readonly durationMs: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IcpAnalysisListDto {
  readonly items: IcpAnalysisDto[];
  readonly total: number;
}

/** True when a stored row was written under the contract this build speaks. */
export function isCurrentAnalysisSchema(analysisSchemaVersion: string): boolean {
  return analysisSchemaVersion === ICP_ANALYSIS_SCHEMA_VERSION;
}

/**
 * Reads a stored analysis as current intelligence, or reports that it is not.
 *
 * Two things have to be true before a consumer may treat a JSON column as an
 * `IcpAnalysisOutput`: the row was written under this contract version, and the
 * payload still satisfies it. Both are checked here so no caller has to decide
 * how much to trust the database - a row from `v1`, or one whose shape has
 * drifted, comes back as null and is rendered as "re-run this analysis" rather
 * than as an empty result.
 */
export function readAnalysisOutput(analysis: {
  analysisSchemaVersion: string;
  output: unknown;
}): IcpAnalysisOutput | null {
  if (!isCurrentAnalysisSchema(analysis.analysisSchemaVersion)) return null;
  if (analysis.output === null || analysis.output === undefined) return null;

  const parsed = icpAnalysisOutputSchema.safeParse(analysis.output);
  return parsed.success ? parsed.data : null;
}

export const analysisIdParamsSchema = z
  .object({
    id: z.string().uuid('An ICP id must be a UUID'),
    analysisId: z.string().uuid('An analysis id must be a UUID'),
  })
  .strict();

export type AnalysisIdParams = z.output<typeof analysisIdParamsSchema>;
