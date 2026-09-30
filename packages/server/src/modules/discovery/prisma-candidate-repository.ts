import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  CandidateRepository,
  PersistCompanyInput,
  PersistSearchRunInput,
  PersistedSearchRun,
} from './candidate-repository.js';

/**
 * PostgreSQL persistence for a processed discovery run.
 *
 * Follows the conventions the ICP repositories already set: Prisma stays behind
 * the port, JSON columns are cast at this boundary because their shape is
 * guaranteed by a validated contract rather than by the ORM, and nothing about
 * the storage leaks upward.
 *
 * ## Why one transaction
 *
 * A run is only meaningful whole. Half a run - the run row with some of its
 * candidates, or candidates pointing at companies that were not written -
 * cannot be read as an audit trail, and the failure it describes never actually
 * happened that way. So the whole thing commits or none of it does, and the
 * caller reports `persisted: false` rather than being handed a fragment.
 *
 * ## Why companies are upserted and candidates are not
 *
 * A company is a *durable entity*: the same firm resolved by tomorrow's run is
 * the same row, updated. A candidate is an *observation by one run*, so it is
 * always an insert - rewriting last week's verdict when the criteria have since
 * changed would destroy exactly the history the cold pool exists to keep.
 */

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Company fields that a later sighting may fill in.
 *
 * Only ever *widening*: a value already stored is kept when the new sighting
 * has nothing to say, which is the same first-non-empty rule entity resolution
 * applies within a run, extended across runs. A provider that stops reporting a
 * headcount must not erase the one we already have.
 */
function companyUpdate(company: PersistCompanyInput): Prisma.CompanyUpdateInput {
  return {
    identityBasis: company.identityBasis,
    name: company.name,
    normalizedName: company.normalizedName,
    ...(company.domain !== undefined ? { domain: company.domain } : {}),
    ...(company.website !== undefined ? { website: company.website } : {}),
    ...(company.country !== undefined ? { country: company.country } : {}),
    ...(company.location !== undefined ? { location: company.location } : {}),
    ...(company.industry !== undefined ? { industry: company.industry } : {}),
    ...(company.industryCodes !== undefined && company.industryCodes.length > 0
      ? { industryCodes: [...company.industryCodes] }
      : {}),
    ...(company.employeeCount !== undefined ? { employeeCount: company.employeeCount } : {}),
    ...(company.linkedinUrl !== undefined ? { linkedinUrl: company.linkedinUrl } : {}),
  };
}

export class PrismaCandidateRepository implements CandidateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveRun(input: PersistSearchRunInput): Promise<PersistedSearchRun> {
    const searchRunId = await this.prisma.$transaction(async (tx) => {
      const run = await tx.searchRun.create({
        data: {
          icpProfileId: input.icpProfileId,
          icpVersion: input.icpVersion,
          ...(input.analysisId !== undefined ? { analysisId: input.analysisId } : {}),
          provider: input.provider,
          queryVersion: input.queryVersion,
          processingVersion: input.processingVersion,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
          counts: toJson(input.counts),
        },
      });

      /** Canonical identity key -> the database row id it was stored under. */
      const companyIds = new Map<string, string>();

      for (const company of input.companies) {
        const update = companyUpdate(company);
        const row = await tx.company.upsert({
          where: { identityKey: company.id },
          update,
          create: {
            identityKey: company.id,
            identityBasis: company.identityBasis,
            name: company.name,
            normalizedName: company.normalizedName,
            ...(company.domain !== undefined ? { domain: company.domain } : {}),
            ...(company.website !== undefined ? { website: company.website } : {}),
            ...(company.country !== undefined ? { country: company.country } : {}),
            ...(company.location !== undefined ? { location: company.location } : {}),
            ...(company.industry !== undefined ? { industry: company.industry } : {}),
            industryCodes: [...(company.industryCodes ?? [])],
            ...(company.employeeCount !== undefined ? { employeeCount: company.employeeCount } : {}),
            ...(company.linkedinUrl !== undefined ? { linkedinUrl: company.linkedinUrl } : {}),
          },
        });
        companyIds.set(company.id, row.id);

        // Every provider account that resolved here, kept so the merge stays
        // explainable. `lastSeenAt` moves on each sighting; `firstSeenAt` does
        // not, which is what makes the pair worth storing at all.
        for (const ref of company.providerRefs) {
          await tx.companySource.upsert({
            where: {
              provider_externalId: { provider: ref.provider, externalId: ref.externalId },
            },
            update: { companyId: row.id },
            create: { companyId: row.id, provider: ref.provider, externalId: ref.externalId },
          });
        }
      }

      /** `personRef` -> the candidate row id it was stored under. */
      const candidateIds = new Map<string, string>();

      for (const candidate of input.candidates) {
        const ref = candidate.providerRefs[0];
        // A candidate with no provenance cannot exist by contract, and storing
        // one under an empty provider would break the trail back to the source.
        if (!ref) continue;
        const companyRowId =
          candidate.companyId === undefined ? undefined : companyIds.get(candidate.companyId);

        const row = await tx.prospectCandidate.create({
          data: {
            searchRunId: run.id,
            ...(companyRowId !== undefined ? { companyId: companyRowId } : {}),
            provider: ref.provider,
            externalId: ref.externalId,
            personRef: candidate.personRef,
            state: candidate.state,
            rejections: toJson(candidate.rejections),
          },
        });
        candidateIds.set(candidate.personRef, row.id);
      }

      /**
       * Contact details, against the candidate row each belongs to.
       *
       * Created rather than upserted, and that is not an oversight: the
       * candidate row was created moments ago in this same transaction, so
       * there is nothing to collide with. The `candidate_id` uniqueness
       * constraint is what guarantees a candidate can never accumulate two
       * conflicting sets of contact details, which is the duplicate worth
       * preventing.
       *
       * A prospect whose `personRef` matches no candidate is skipped. It cannot
       * happen through the pipeline - enrichment only ever runs on candidates
       * of this run - and if it ever did, an orphaned contact record is exactly
       * the untraceable row this table set exists to avoid.
       */
      for (const prospect of input.enrichment?.prospects ?? []) {
        const candidateRowId = candidateIds.get(prospect.personRef);
        if (candidateRowId === undefined) continue;

        /**
         * `prospect.company` is deliberately not written back onto the
         * `companies` row. That entity is owned by entity resolution over the
         * *search* results, and letting a second stage edit it would make a
         * company's fields depend on which stage last touched them. The
         * provider's organization id is kept here instead, where it is a fact
         * about this enrichment rather than about the company.
         */
        const { person, contact, enrichment } = prospect;
        await tx.prospectEnrichment.create({
          data: {
            candidateId: candidateRowId,
            provider: prospect.provider,
            status: enrichment.status,
            ...(enrichment.matchConfidence !== undefined
              ? { matchConfidence: enrichment.matchConfidence }
              : {}),
            ...(prospect.externalPersonId !== undefined
              ? { externalPersonId: prospect.externalPersonId }
              : {}),
            ...(prospect.externalOrganizationId !== undefined
              ? { externalOrganizationId: prospect.externalOrganizationId }
              : {}),
            ...(person.linkedinUrl !== undefined ? { linkedinUrl: person.linkedinUrl } : {}),
            ...(contact.workEmail !== undefined ? { workEmail: contact.workEmail } : {}),
            ...(contact.emailStatus !== undefined ? { emailStatus: contact.emailStatus } : {}),
            phoneNumbers: toJson(contact.phoneNumbers),
            phoneState: contact.phoneState,
            ...(enrichment.detail !== undefined ? { detail: enrichment.detail } : {}),
            ...(enrichment.enrichedAt !== undefined
              ? { enrichedAt: new Date(enrichment.enrichedAt) }
              : {}),
          },
        });
      }

      return run.id;
    });

    return { searchRunId };
  }
}
