import type { IcpAnalysisOutput } from './analysis.js';

/**
 * A complete, contract-valid `icp-analysis.v2` analysis.
 *
 * This is the worked example of the output contract, and it earns a place in
 * the shipped package for two reasons.
 *
 * It is the *specification by example*. `icpAnalysisOutputSchema` says what
 * shape an analysis has; it cannot say what a good one contains. The difference
 * between `"Node.js is a required technology"` and the technology reading below
 * is the entire point of this contract and is invisible in a schema, so it is
 * written down here where a reader - or a prompt author checking their work -
 * can see the standard being aimed at.
 *
 * And it is one fixture instead of three. The schema tests, the API tests and
 * the UI tests all need a valid analysis; keeping a copy in each package is how
 * a contract change turns into three subtly different notions of "valid".
 *
 * It is deliberately *not* wired to any product surface: nothing renders this,
 * and no endpoint returns it. An analysis a person can read must have come from
 * a model run, never from a fixture.
 *
 * The content matches the mid-market Indian platform-modernization ICP the
 * contract was designed against, so the two can be read side by side.
 */
export function createExampleAnalysisOutput(): IcpAnalysisOutput {
  return {
    icpInterpretation: {
      targetProfile:
        'Established mid-market Indian technology and manufacturing organisations that already run substantial engineering teams while still depending on older core systems.',
      primaryOpportunity:
        'Modernisation and cloud migration programmes where the architectural complexity of moving off a legacy core exceeds what the internal engineering organisation can absorb alongside its existing roadmap.',
      buyingContext:
        'Such organisations tend to look for an external delivery partner once a migration has been committed to publicly or budgeted for, because the work is time-boxed and needs skills the permanent team was not hired for.',
    },
    idealCompanyProfile: {
      companyStage: 'Established or late-stage scale-up',
      likelyTechnologyEnvironment:
        'A hybrid estate in which cloud-native services and a modern application stack run alongside an older ERP and a monolithic core that still owns critical business processes.',
      likelyEngineeringSituation:
        'A growing engineering organisation that is absorbing platform and cloud responsibilities faster than it is adding senior people able to lead an architectural migration.',
      likelyTransformationStage:
        'Either early into a modernisation programme or actively planning one, rather than having completed the move or never having started it.',
      likelyBuyingSituation:
        'Likely to be evaluating external delivery capacity for a defined migration scope while keeping product development running on the existing team.',
    },
    painHypotheses: [
      {
        problem: 'Legacy core blocking delivery speed',
        severity: 'HIGH',
        whyLikely:
          'A monolithic architecture and an older ERP sitting underneath a modern application stack usually means every customer-facing change still has to be coordinated through the parts that cannot be released independently.',
        businessImpact: [
          'Feature delivery slows as release coordination costs grow',
          'Maintenance consumes a rising share of engineering time',
          'Scaling the engineering organisation stops producing more output',
        ],
        observableEvidence: [
          'Platform modernisation or re-architecture initiatives described publicly',
          'ERP replacement or upgrade programmes',
          'Job postings referencing migration away from a monolith',
        ],
      },
      {
        problem: 'Engineering capacity absorbed by the migration itself',
        severity: 'HIGH',
        whyLikely:
          'Where a modernisation programme is under way and hiring is accelerating at the same time, the existing team is usually being asked to run the migration and the roadmap simultaneously.',
        businessImpact: [
          'Roadmap commitments slip while the migration is in flight',
          'Senior engineers are pulled away from product work',
          'Delivery risk concentrates in a small number of people',
        ],
        observableEvidence: [
          'Sustained volume of open platform and cloud engineering roles',
          'Roles that stay open for unusually long periods',
          'Contractor or partner-sourced engineering mentioned in postings',
        ],
      },
    ],
    intentSignals: [
      {
        signal: 'Platform and cloud engineering hiring acceleration',
        intentStrength: 'HIGH',
        whyItMatters:
          'A cluster of platform, cloud and reliability roles opening at once suggests an organisation staffing for an infrastructure change rather than simply replacing attrition.',
        lookbackDays: 90,
        evidenceToFind: [
          'Multiple concurrent platform engineering vacancies',
          'Kubernetes or Azure named in engineering job requirements',
          'Newly created engineering leadership positions',
        ],
      },
      {
        signal: 'Publicly committed migration programme',
        intentStrength: 'CRITICAL',
        whyItMatters:
          'An announced migration converts a latent architectural problem into a funded programme with a deadline, which is the point at which external delivery capacity is usually bought.',
        lookbackDays: 365,
        evidenceToFind: [
          'Cloud migration or modernisation announcements',
          'Case studies describing a move off an older core system',
          'Conference talks about an in-progress re-architecture',
        ],
      },
    ],
    technologyIntelligence: [
      {
        pattern: 'Modern application stack over a legacy core',
        technologies: [
          'Node.js',
          'Python',
          'React',
          'Kubernetes',
          'Microsoft Azure',
          'Legacy ERP',
          'Monolithic architecture',
        ],
        interpretation:
          'The coexistence of container orchestration and a current web stack with an older ERP and a monolithic core points to an organisation part-way through a transition rather than one that is purely legacy or already cloud-native.',
        discoveryImplication:
          'Prioritise companies showing evidence of movement between those two states, because a purely legacy estate has not started and a fully cloud-native one no longer needs this work.',
        evidenceToFind: [
          'Kubernetes or container platform adoption',
          'Azure landing zone or migration work',
          'Microservices extraction from an existing monolith',
          'ERP replacement or integration programmes',
        ],
      },
    ],
    serviceFit: [
      {
        service: 'Platform modernization',
        fitStrength: 'HIGH',
        whyFit:
          'An organisation whose modern surface is constrained by an older core has a scoped, defensible reason to bring in outside architectural help rather than a general interest in modernising.',
        likelyBusinessNeed:
          'Moving critical business processes onto a new platform without interrupting the operations that currently depend on the old one.',
        evidenceToFind: [
          'Re-architecture or modernisation programmes described publicly',
          'Platform engineering roles created recently',
          'Statements about decoupling or replacing a core system',
        ],
      },
      {
        service: 'Cloud migration',
        fitStrength: 'HIGH',
        whyFit:
          'A hybrid estate with an existing Azure footprint suggests migration is already policy, which makes additional delivery capacity an extension of a decision rather than a new one.',
        likelyBusinessNeed:
          'Completing a migration whose remaining workloads are the hardest ones, typically those closest to the legacy core.',
        evidenceToFind: [
          'Cloud migration initiatives named on the company website',
          'Cloud infrastructure roles referencing a specific provider',
          'Partner or marketplace listings for a cloud platform',
        ],
      },
    ],
    discoveryStrategy: {
      primaryApproaches: [
        {
          strategy: 'Firmographic filtering',
          purpose:
            'Reduce the search space to companies of the right size, geography and industry before any expensive per-company work is done.',
        },
        {
          strategy: 'Technology-transition detection',
          purpose:
            'Identify the companies whose technology footprint shows both older and modern elements, which is the signature this ICP is actually selecting for.',
        },
        {
          strategy: 'Intent-first prioritisation',
          purpose:
            'Order the qualified set by whether a modernisation or hiring signal appeared recently, so outreach reaches the accounts where the need is current.',
        },
      ],
      recommendedSequence: [
        'Filter to companies headquartered in the target countries within the employee and revenue bands',
        'Restrict to the target industries and drop the excluded ones',
        'Detect legacy core indicators such as an older ERP or a monolithic architecture',
        'Detect modern stack and cloud platform indicators on the same company',
        'Look for recent hiring or migration activity within the configured freshness window',
        'Corroborate each qualifying claim against the allowed source types',
        'Rank by evidence strength and signal recency for outreach',
      ],
    },
    searchQueryStrategy: [
      {
        purpose: 'Modernisation programmes',
        queries: [
          '"platform modernization" India engineering',
          '"legacy modernization" India "case study"',
          '"monolith" "microservices" migration India',
          '"ERP migration" India manufacturing',
        ],
      },
      {
        purpose: 'Engineering hiring intent',
        queries: [
          '"platform engineer" hiring India SaaS',
          '"Kubernetes" "Azure" engineering roles India',
          '"site reliability engineer" India "we are hiring"',
        ],
      },
      {
        purpose: 'Transformation announcements',
        queries: [
          '"cloud migration" announcement India company',
          '"technology transformation" India IT services',
          '"digital transformation" programme India manufacturing',
        ],
      },
    ],
    evidenceStrategy: [
      {
        claim: 'The company is undergoing a modernisation or migration programme',
        importance: 'CRITICAL',
        evidenceTypes: ['JOB_POSTING', 'NEWS_ARTICLE', 'COMPANY_WEBSITE'],
        signals: [
          'cloud migration',
          'platform modernisation',
          'microservices extraction',
          'ERP replacement',
        ],
        freshnessDays: 365,
        minimumCorroboration: 2,
      },
      {
        claim: 'The company still depends on a legacy core system',
        importance: 'HIGH',
        evidenceTypes: ['JOB_POSTING', 'COMPANY_WEBSITE'],
        signals: [
          'older ERP named in a job requirement',
          'monolith mentioned in an engineering description',
          'on-premise deployment referenced',
        ],
        freshnessDays: 365,
        minimumCorroboration: 2,
      },
    ],
    buyerStrategy: [
      {
        role: 'CTO',
        priority: 'PRIMARY',
        whyTarget:
          'Usually owns the architectural decision and carries the delivery risk of a migration, so a modernisation conversation reaches its natural owner first.',
        painTopics: [
          'Migrating off a legacy core without interrupting operations',
          'Engineering capacity during a transition',
          'Architectural risk in a time-boxed programme',
        ],
        relevantSignals: [
          'Recent appointment to the role',
          'Public statements about re-architecture',
          'Engineering organisation growing quickly',
        ],
      },
      {
        role: 'Director of IT',
        priority: 'SECONDARY',
        whyTarget:
          'Typically accountable for the older systems that a modernisation touches, which makes them both a source of requirements and a source of resistance worth understanding early.',
        painTopics: [
          'Integration between old and new platforms',
          'Operational continuity during cutover',
          'Support burden of an ageing estate',
        ],
        relevantSignals: [
          'ERP or infrastructure programmes underway',
          'Vendor changes in the core systems estate',
        ],
      },
    ],
    fitModel: {
      strongFit: [
        'Headquartered in a target country within the configured employee band',
        'Revenue inside the configured range',
        'Evidence of a legacy core still in operational use',
        'Evidence of modern platform or cloud adoption on the same company',
        'A modernisation or hiring signal inside the freshness window',
      ],
      weakFit: [
        'No observable evidence of any transition, in either direction',
        'Engineering organisation too small to run a migration programme',
        'Technology footprint entirely cloud-native, so the work is already done',
      ],
      disqualifiers: [
        'Already an existing customer',
        'Marked do-not-contact',
        'Headquartered in an excluded country',
        'Operating in an excluded industry',
      ],
    },
    opportunityHypotheses: [
      {
        hypothesis:
          'The company may need external engineering capacity to execute a modernisation programme it has already committed to internally.',
        supportingSignals: [
          'Sustained platform engineering hiring',
          'Legacy core still in operational use',
          'Modernisation activity described publicly',
        ],
        evidenceRequired: [
          'A recent modernisation or migration announcement',
          'Concurrent platform or cloud job postings',
          'Confirmation that the legacy system is still central',
        ],
      },
      {
        hypothesis:
          'A recent change in engineering leadership could indicate a re-evaluation of the platform roadmap, which may open a window for an external architecture partner.',
        supportingSignals: [
          'New engineering or technology leadership appointment',
          'Hiring pattern shifting toward platform roles',
        ],
        evidenceRequired: [
          'Confirmed leadership change inside the lookback window',
          'A public statement of technology direction from the new leader',
        ],
      },
    ],
  };
}
