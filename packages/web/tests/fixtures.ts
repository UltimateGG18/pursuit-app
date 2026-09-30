import {
  CANDIDATE_PROCESSING_VERSION,
  ICP_ANALYSIS_SCHEMA_VERSION,
  PROSPECT_ENRICHMENT_VERSION,
  countEnrichment,
  countReachability,
  createExampleAnalysisOutput,
  createExampleIcpConfig,
  reachabilityFor,
  type IcpAnalysisDto,
  type IcpAnalysisOutput,
  type IcpProfileDto,
  type IcpProfileListDto,
  type IcpProfileSummaryDto,
  type CandidateProcessingResult,
  type CanonicalCompany,
  type EnrichedProspect,
  type ProspectEnrichmentResult,
  type PersonCandidate,
  type ProcessedCandidate,
  type ProspectRunDto,
} from '@pursuit/shared';

export const ICP_ID = '11111111-1111-4111-8111-111111111111';
export const ICP_NAME = 'Benelux mid-market platform modernization';
export const OTHER_ICP_ID = '33333333-3333-4333-8333-333333333333';

export function profileDto(overrides?: Partial<IcpProfileDto>): IcpProfileDto {
  const config = createExampleIcpConfig();
  return {
    id: ICP_ID,
    name: config.basicProfile.name,
    slug: 'benelux-mid-market-platform-modernization',
    description: config.basicProfile.description ?? null,
    version: 1,
    status: 'ACTIVE',
    schemaVersion: 'icp.v1',
    config,
    submittedConfig: config,
    scoringWeights: config.scoringWeights,
    createdBy: null,
    changeReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function summaryDto(overrides?: Partial<IcpProfileSummaryDto>): IcpProfileSummaryDto {
  return {
    id: ICP_ID,
    name: ICP_NAME,
    slug: 'benelux-mid-market-platform-modernization',
    description: null,
    version: 1,
    status: 'ACTIVE',
    objective: 'NEW_LOGO_ACQUISITION',
    priority: 'P0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function listOf(items: IcpProfileSummaryDto[]): { ok: true; data: IcpProfileListDto } {
  return { ok: true, data: { items, total: items.length, limit: 25, offset: 0 } };
}

export function emptyList(): { ok: true; data: IcpProfileListDto } {
  return listOf([]);
}

export function analysisOutput(overrides?: Partial<IcpAnalysisOutput>): IcpAnalysisOutput {
  return { ...createExampleAnalysisOutput(), ...overrides };
}

export function analysisDto(overrides?: Partial<IcpAnalysisDto>): IcpAnalysisDto {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    icpId: ICP_ID,
    icpVersion: 1,
    status: 'COMPLETED',
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    promptVersion: 'v3',
    analysisSchemaVersion: ICP_ANALYSIS_SCHEMA_VERSION,
    inputSnapshot: {},
    output: analysisOutput(),
    error: null,
    durationMs: 41200,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:41.000Z',
    ...overrides,
  };
}

export function noAnalyses() {
  return { ok: true as const, data: { items: [], total: 0 } };
}

export const ANALYSIS_ID = '22222222-2222-4222-8222-222222222222';

export function personCandidate(overrides?: Partial<PersonCandidate>): PersonCandidate {
  return {
    providerRefs: [{ provider: 'apollo', externalId: '6a1b2c3d4e5f60718293a4b5' }],
    name: 'Sanne de Vries',
    firstName: 'Sanne',
    lastName: 'de Vries',
    title: 'Chief Technology Officer',
    seniority: 'c_suite',
    department: 'information_technology',
    location: 'Utrecht, Utrecht, Netherlands',
    linkedinUrl: 'https://www.linkedin.com/in/sanne-de-vries',
    emailStatus: 'verified',
    company: {
      externalId: '5f2a1b3c4d5e6f7a8b9c0d1e',
      name: 'Voorbeeld Software B.V.',
      domain: 'voorbeeld-software.nl',
      industry: 'information technology & services',
      employeeCount: 240,
      location: 'Amsterdam, North Holland, Netherlands',
    },
    rawSourceRef: 'apollo:person:6a1b2c3d4e5f60718293a4b5',
    ...overrides,
  };
}

/** The canonical company `personCandidate()`'s employer resolves to. */
export function canonicalCompany(overrides?: Partial<CanonicalCompany>): CanonicalCompany {
  return {
    id: 'domain:voorbeeld-software.nl',
    identityBasis: 'DOMAIN',
    name: 'Voorbeeld Software B.V.',
    normalizedName: 'voorbeeld software',
    domain: 'voorbeeld-software.nl',
    industry: 'information technology & services',
    industryCodes: ['IT_SERVICES'],
    employeeCount: 240,
    location: 'Amsterdam, North Holland, Netherlands',
    providerRefs: [{ provider: 'apollo', externalId: '5f2a1b3c4d5e6f7a8b9c0d1e' }],
    sourceRefs: ['apollo:person:6a1b2c3d4e5f60718293a4b5'],
    ...overrides,
  };
}

/**
 * A processing block in which every person survived.
 *
 * The default the existing prospect fixtures use, so a test that is about
 * paging or provider errors is not silently also a test about filtering.
 */
export function allSurvived(
  people: PersonCandidate[],
  overrides?: Partial<CandidateProcessingResult>,
): CandidateProcessingResult {
  const survivors: ProcessedCandidate[] = people.map((person) => ({
    personRef: person.rawSourceRef,
    providerRefs: person.providerRefs,
    companyId: 'domain:voorbeeld-software.nl',
    state: 'SURVIVOR',
    rejections: [],
  }));

  return {
    version: CANDIDATE_PROCESSING_VERSION,
    companies: people.length > 0 ? [canonicalCompany()] : [],
    survivors,
    rejected: [],
    counts: {
      received: people.length,
      duplicatesRemoved: 0,
      companiesResolved: people.length > 0 ? 1 : 0,
      suppressed: 0,
      hardFilterRejected: 0,
      unreachable: 0,
      survivors: survivors.length,
      cold: 0,
    },
    persistence: { persisted: true, searchRunId: '44444444-4444-4444-8444-444444444444' },
    ...overrides,
  };
}

export function prospectRun(
  people: PersonCandidate[] = [personCandidate()],
  overrides?: {
    pagination?: Partial<ProspectRunDto['pagination']>;
    meta?: Partial<ProspectRunDto['meta']>;
    processing?: Partial<CandidateProcessingResult>;
  },
): { ok: true; data: ProspectRunDto } {
  return {
    ok: true,
    data: {
      people,
      pagination: {
        page: 1,
        perPage: 25,
        totalEntries: people.length,
        totalPages: 1,
        hasMore: false,
        ...overrides?.pagination,
      },
      meta: {
        icpId: ICP_ID,
        icpVersion: 1,
        provider: 'apollo',
        providerVersion: 'v1',
        queryVersion: 'people-query.v1',
        query: { page: 1, perPage: 25 },
        returned: people.length,
        duplicatesRemoved: 0,
        startedAt: '2026-01-01T10:05:00.000Z',
        completedAt: '2026-01-01T10:05:02.000Z',
        durationMs: 2000,
        ...overrides?.meta,
      },
      processing: allSurvived(people, overrides?.processing),
    },
  };
}

/**
 * One enriched prospect, carrying exactly the channels named.
 *
 * Built at the domain contract rather than from a provider payload, for the
 * reason every other fixture here is: the UI renders `EnrichedProspect` and has
 * no idea which provider answered, so a fixture that started as Apollo JSON
 * would quietly make these tests depend on the adapter.
 *
 * The address is on `example.com`, which RFC 2606 reserves so it can never
 * reach a real mailbox, and the number is in the `555-01xx` fiction range.
 */
export function enrichedProspect(
  personRef: string,
  channels: { linkedin?: boolean; email?: boolean; phone?: boolean } = {},
  overrides?: Partial<EnrichedProspect>,
): EnrichedProspect {
  const linkedinUrl =
    channels.linkedin === true ? 'https://www.linkedin.com/in/sanne-de-vries' : undefined;
  const workEmail = channels.email === true ? 'sanne.de.vries@example.com' : undefined;
  const phoneNumbers =
    channels.phone === true
      ? [{ number: '+31205550142', type: 'mobile', status: 'valid_number' }]
      : [];

  return {
    personRef,
    provider: 'apollo',
    externalPersonId: '6a1b2c3d4e5f60718293a4b5',
    externalOrganizationId: '5f2a1b3c4d5e6f7a8b9c0d1e',
    person: {
      fullName: 'Sanne de Vries',
      title: 'Chief Technology Officer',
      ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
    },
    company: { name: 'Voorbeeld Software B.V.', domain: 'voorbeeld-software.nl' },
    contact: {
      ...(workEmail !== undefined ? { workEmail, emailStatus: 'verified' } : {}),
      phoneNumbers,
      phoneState: phoneNumbers.length > 0 ? 'AVAILABLE' : 'NONE',
    },
    enrichment: {
      status: 'ENRICHED',
      matchConfidence: 'high',
      provider: 'apollo',
      enrichedAt: '2026-01-01T10:05:02.000Z',
    },
    reachability: reachabilityFor({
      ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
      ...(workEmail !== undefined ? { workEmail } : {}),
      phoneNumbers,
    }),
    ...overrides,
  };
}

/** An enrichment block whose counts are derived from the prospects it holds. */
export function enrichmentResult(
  prospects: EnrichedProspect[],
  overrides?: Partial<ProspectEnrichmentResult>,
): ProspectEnrichmentResult {
  return {
    version: PROSPECT_ENRICHMENT_VERSION,
    provider: 'apollo',
    prospects,
    // Derived rather than passed in, so a fixture can never claim two enriched
    // records while carrying one.
    counts: countEnrichment(prospects, 0),
    reachability: countReachability(prospects),
    phoneRevealRequested: true,
    ...overrides,
  };
}
