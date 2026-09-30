import type { ReactNode } from 'react';
import {
  SOURCE_TYPE_OPTIONS,
  type AnalysisImportance,
  type BuyerPriority,
  type IcpAnalysisOutput,
} from '@pursuit/shared';
import { Badge, cn, type BadgeTone } from '../../components/ui/index.js';

/**
 * The rendered ICP intelligence.
 *
 * Split out of `IcpAnalysisPanel` because the panel's job is the run lifecycle -
 * idle, analyzing, completed, failed - and this file's job is reading twelve
 * sections of derived reasoning. They change for different reasons.
 *
 * Two decisions shape the layout.
 *
 * The sections are grouped into four bands, in the order a person actually
 * needs them: *who* we are looking for, *why* they would buy, *how* to find
 * them, and *who* to talk to. Rendering all twelve as one flat stack is
 * technically faithful to the contract and useless to read - the interpretation
 * and the search queries are not the same kind of thing and should not look
 * alike.
 *
 * And prose is rendered as prose. This is the one screen in the application
 * whose content is argument rather than data: the reasoning fields are where
 * the value is, so they get measure and line-height instead of being squeezed
 * into the muted caption treatment the v1 one-clause rationales used.
 */

const IMPORTANCE_TONE: Record<AnalysisImportance, BadgeTone> = {
  CRITICAL: 'critical',
  HIGH: 'brand',
  MEDIUM: 'neutral',
  LOW: 'outline',
};

const BUYER_PRIORITY_TONE: Record<BuyerPriority, BadgeTone> = {
  PRIMARY: 'brand',
  SECONDARY: 'neutral',
  TERTIARY: 'outline',
};

/**
 * Source types come back as catalog codes, because that is what the discovery
 * stage consumes. A person should still read "Job posting".
 */
const SOURCE_TYPE_LABEL = new Map(
  SOURCE_TYPE_OPTIONS.map((option) => [option.value as string, option.label]),
);

// ---------------------------------------------------------------------------
// Layout primitives, local to the intelligence view
// ---------------------------------------------------------------------------

/** A band of related sections, introduced by the question it answers. */
function Band({ title, question, children }: { title: string; question: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-5 first:border-t-0 sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h4 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {title}
        </h4>
        <p className="text-xs text-ink-faint">{question}</p>
      </div>
      <div className="mt-3.5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Section({
  title,
  id,
  count,
  children,
}: {
  title: string;
  id?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="scroll-mt-40" id={id}>
      <div className="flex items-center gap-2">
        <h5 className="text-[13px] font-semibold text-ink">{title}</h5>
        {count === undefined ? null : (
          <Badge tone="outline" className="pu-numeric">
            {count}
          </Badge>
        )}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** One reasoned statement: a label, then the argument, at reading width. */
function Statement({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{label}</p>
      <p className="mt-0.5 max-w-3xl text-[13px] leading-6 text-ink-soft">{children}</p>
    </div>
  );
}

/** A bordered entry in a list of hypotheses, patterns or requirements. */
function Entry({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <li
      className={cn(
        'rounded-control border border-line bg-surface-subtle px-3.5 py-3',
        className,
      )}
    >
      {children}
    </li>
  );
}

function EntryHeader({
  title,
  badges,
}: {
  title: string;
  badges?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-[13px] font-semibold text-ink">{title}</span>
      {badges}
    </div>
  );
}

function Reasoning({ children }: { children: ReactNode }) {
  return <p className="mt-1 max-w-3xl text-[13px] leading-6 text-ink-soft">{children}</p>;
}

/** A labelled row of chips: evidence to look for, pain topics, signals. */
function Chips({
  label,
  items,
  tone = 'outline',
}: {
  label: string;
  items: readonly string[];
  tone?: BadgeTone;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <Badge key={`${item}-${index}`} tone={tone}>
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** A labelled bullet list, for impacts and criteria that read as sentences. */
function Bullets({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">{label}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.map((item, index) => (
          <li className="flex gap-2 text-xs leading-5 text-ink-soft" key={`${item}-${index}`}>
            <span aria-hidden className="select-none text-ink-faint">
              &bull;
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

// ---------------------------------------------------------------------------
// Jump targets
// ---------------------------------------------------------------------------

/**
 * One anchor per band rather than per section.
 *
 * Twelve links would be a second table of contents competing with the page's
 * own navigation; four match the way the result is actually structured.
 */
export const INTELLIGENCE_ANCHORS = [
  { id: 'analysis-target', label: 'Target' },
  { id: 'analysis-need', label: 'Need' },
  { id: 'analysis-discovery', label: 'Discovery' },
  { id: 'analysis-buyer', label: 'Buyer' },
] as const;

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export function AnalysisIntelligence({ output }: { output: IcpAnalysisOutput }) {
  const {
    icpInterpretation,
    idealCompanyProfile,
    painHypotheses,
    intentSignals,
    technologyIntelligence,
    serviceFit,
    discoveryStrategy,
    searchQueryStrategy,
    evidenceStrategy,
    buyerStrategy,
    fitModel,
    opportunityHypotheses,
  } = output;

  return (
    <div>
      <Band
        title="Target"
        question="What kind of company are we looking for?"
      >
        <Section id="analysis-target" title="ICP interpretation">
          <div className="flex flex-col gap-2.5">
            <Statement label="Target profile">{icpInterpretation.targetProfile}</Statement>
            <Statement label="Primary opportunity">{icpInterpretation.primaryOpportunity}</Statement>
            <Statement label="Buying context">{icpInterpretation.buyingContext}</Statement>
          </div>
        </Section>

        <Section title="Ideal company profile">
          {/* Inferences, not filters - the heading says so once rather than
              every field repeating "likely". */}
          <p className="mb-2 text-xs text-ink-muted">
            Inferred characteristics of a strong account. None of this has been observed yet.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Statement label="Company stage">{idealCompanyProfile.companyStage}</Statement>
            </div>
            <Statement label="Technology environment">
              {idealCompanyProfile.likelyTechnologyEnvironment}
            </Statement>
            <Statement label="Engineering situation">
              {idealCompanyProfile.likelyEngineeringSituation}
            </Statement>
            <Statement label="Transformation stage">
              {idealCompanyProfile.likelyTransformationStage}
            </Statement>
            <Statement label="Buying situation">
              {idealCompanyProfile.likelyBuyingSituation}
            </Statement>
          </div>
        </Section>

        <Section title="Fit model">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <FitColumn title="Strong fit" tone="positive" items={fitModel.strongFit} />
            <FitColumn title="Weak fit" tone="caution" items={fitModel.weakFit} />
            <FitColumn title="Disqualifiers" tone="critical" items={fitModel.disqualifiers} />
          </div>
        </Section>
      </Band>

      <Band title="Need" question="Why would they buy, and why now?">
        <Section id="analysis-need" title="Pain hypotheses" count={painHypotheses.length}>
          <List>
            {painHypotheses.map((pain, index) => (
              <Entry key={`${pain.problem}-${index}`}>
                <EntryHeader
                  title={pain.problem}
                  badges={<Badge tone={IMPORTANCE_TONE[pain.severity]}>{pain.severity}</Badge>}
                />
                <Reasoning>{pain.whyLikely}</Reasoning>
                <Bullets label="Business impact" items={pain.businessImpact} />
                <Chips label="Observable evidence" items={pain.observableEvidence} />
              </Entry>
            ))}
          </List>
        </Section>

        <Section title="Intent signals" count={intentSignals.length}>
          <List>
            {intentSignals.map((signal, index) => (
              <Entry key={`${signal.signal}-${index}`}>
                <EntryHeader
                  title={signal.signal}
                  badges={
                    <>
                      <Badge tone={IMPORTANCE_TONE[signal.intentStrength]}>
                        {signal.intentStrength}
                      </Badge>
                      <Badge tone="outline" className="pu-numeric">
                        {signal.lookbackDays}d lookback
                      </Badge>
                    </>
                  }
                />
                <Reasoning>{signal.whyItMatters}</Reasoning>
                <Chips label="Evidence to find" items={signal.evidenceToFind} />
              </Entry>
            ))}
          </List>
        </Section>

        <Section
          title="Technology intelligence"
          count={technologyIntelligence.length}
        >
          <List>
            {technologyIntelligence.map((pattern, index) => (
              <Entry key={`${pattern.pattern}-${index}`}>
                <EntryHeader title={pattern.pattern} />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {pattern.technologies.map((technology, position) => (
                    <Badge key={`${technology}-${position}`} tone="neutral">
                      {technology}
                    </Badge>
                  ))}
                </div>
                <Reasoning>{pattern.interpretation}</Reasoning>
                <div className="mt-1.5">
                  <Statement label="Discovery implication">{pattern.discoveryImplication}</Statement>
                </div>
                <Chips label="Evidence to find" items={pattern.evidenceToFind} />
              </Entry>
            ))}
          </List>
        </Section>

        <Section title="Service fit" count={serviceFit.length}>
          <List>
            {serviceFit.map((service, index) => (
              <Entry key={`${service.service}-${index}`}>
                <EntryHeader
                  title={service.service}
                  badges={<Badge tone={IMPORTANCE_TONE[service.fitStrength]}>{service.fitStrength}</Badge>}
                />
                <Reasoning>{service.whyFit}</Reasoning>
                <div className="mt-1.5">
                  <Statement label="Likely business need">{service.likelyBusinessNeed}</Statement>
                </div>
                <Chips label="Evidence to find" items={service.evidenceToFind} />
              </Entry>
            ))}
          </List>
        </Section>

        <Section title="Opportunity hypotheses" count={opportunityHypotheses.length}>
          <p className="mb-2 text-xs text-ink-muted">
            Bets to investigate, not findings. Each needs its evidence before it means anything.
          </p>
          <List>
            {opportunityHypotheses.map((hypothesis, index) => (
              <Entry key={index}>
                <p className="max-w-3xl text-[13px] font-medium leading-6 text-ink">
                  {hypothesis.hypothesis}
                </p>
                <Chips label="Supporting signals" items={hypothesis.supportingSignals} />
                <Chips label="Evidence required" items={hypothesis.evidenceRequired} tone="neutral" />
              </Entry>
            ))}
          </List>
        </Section>
      </Band>

      <Band title="Discovery" question="How do we find them, and what proves the fit?">
        <Section id="analysis-discovery" title="Discovery strategy">
          <List>
            {discoveryStrategy.primaryApproaches.map((approach, index) => (
              <Entry key={`${approach.strategy}-${index}`}>
                <EntryHeader title={approach.strategy} />
                <Reasoning>{approach.purpose}</Reasoning>
              </Entry>
            ))}
          </List>

          {/* The ordering is the substance here, so it is numbered rather than
              bulleted: step four running before step two is a different plan. */}
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              Recommended sequence
            </p>
            <ol className="mt-1.5 flex flex-col gap-1.5">
              {discoveryStrategy.recommendedSequence.map((step, index) => (
                <li className="flex gap-2.5" key={`${step}-${index}`}>
                  <span className="pu-numeric mt-px flex h-4.5 w-4.5 flex-none items-center justify-center rounded-full bg-canvas-deep text-[11px] font-semibold text-ink-muted">
                    {index + 1}
                  </span>
                  <span className="text-[13px] leading-6 text-ink-soft">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </Section>

        <Section title="Search queries" count={searchQueryStrategy.length}>
          <List>
            {searchQueryStrategy.map((group, index) => (
              <Entry key={`${group.purpose}-${index}`}>
                <EntryHeader title={group.purpose} />
                {/* Monospace: these are queries to be copied, not prose. */}
                <ul className="mt-1.5 flex flex-col gap-1">
                  {group.queries.map((query, position) => (
                    <li
                      className="break-words rounded-control border border-line bg-surface px-2.5 py-1 font-mono text-xs leading-5 text-ink-soft"
                      key={`${query}-${position}`}
                    >
                      {query}
                    </li>
                  ))}
                </ul>
              </Entry>
            ))}
          </List>
        </Section>

        <Section title="Evidence strategy" count={evidenceStrategy.length}>
          <List>
            {evidenceStrategy.map((requirement, index) => (
              <Entry key={`${requirement.claim}-${index}`}>
                <EntryHeader
                  title={requirement.claim}
                  badges={
                    <>
                      <Badge tone={IMPORTANCE_TONE[requirement.importance]}>
                        {requirement.importance}
                      </Badge>
                      <Badge tone="outline" className="pu-numeric">
                        max {requirement.freshnessDays}d old
                      </Badge>
                      <Badge tone="outline" className="pu-numeric">
                        {requirement.minimumCorroboration} sources
                      </Badge>
                    </>
                  }
                />
                <Chips
                  label="Acceptable sources"
                  items={requirement.evidenceTypes.map(
                    (type) => SOURCE_TYPE_LABEL.get(type) ?? type,
                  )}
                  tone="neutral"
                />
                <Chips label="Signals that would prove it" items={requirement.signals} />
              </Entry>
            ))}
          </List>
        </Section>
      </Band>

      <Band title="Buyer" question="Who do we approach, and about what?">
        <Section id="analysis-buyer" title="Buyer strategy" count={buyerStrategy.length}>
          <List>
            {buyerStrategy.map((buyer, index) => (
              <Entry key={`${buyer.role}-${index}`}>
                <EntryHeader
                  title={buyer.role}
                  badges={<Badge tone={BUYER_PRIORITY_TONE[buyer.priority]}>{buyer.priority}</Badge>}
                />
                <Reasoning>{buyer.whyTarget}</Reasoning>
                <Chips label="Pain topics" items={buyer.painTopics} tone="neutral" />
                <Chips label="Relevant signals" items={buyer.relevantSignals} />
              </Entry>
            ))}
          </List>
        </Section>
      </Band>
    </div>
  );
}

const FIT_TONE: Record<'positive' | 'caution' | 'critical', string> = {
  positive: 'border-positive-200 bg-positive-50',
  caution: 'border-caution-200 bg-caution-50',
  critical: 'border-critical-200 bg-critical-50',
};

/**
 * One column of the fit model.
 *
 * Coloured by verdict, because "strong", "weak" and "disqualified" are the one
 * place in this result where the reader is scanning for a judgement rather than
 * reading an argument.
 */
function FitColumn({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'positive' | 'caution' | 'critical';
  items: readonly string[];
}) {
  return (
    <div className={cn('rounded-control border px-3.5 py-3', FIT_TONE[tone])}>
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <Badge tone="outline" className="pu-numeric">
          {items.length}
        </Badge>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((item, index) => (
          <li className="text-xs leading-5 text-ink-soft" key={`${item}-${index}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
