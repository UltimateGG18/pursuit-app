-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('NOT_REQUESTED', 'ENRICHED', 'PARTIAL', 'NO_MATCH', 'UNAVAILABLE', 'FAILED');

-- CreateTable
CREATE TABLE "prospect_enrichments" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "status" "EnrichmentStatus" NOT NULL,
    "match_confidence" VARCHAR(16),
    "external_person_id" VARCHAR(128),
    "external_organization_id" VARCHAR(128),
    "linkedin_url" VARCHAR(2048),
    "work_email" VARCHAR(320),
    "email_status" VARCHAR(32),
    "phone_numbers" JSONB NOT NULL,
    "phone_state" VARCHAR(16) NOT NULL,
    "detail" TEXT,
    "enriched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospect_enrichments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prospect_enrichments_candidate_id_key" ON "prospect_enrichments"("candidate_id");

-- CreateIndex
CREATE INDEX "prospect_enrichments_provider_external_person_id_idx" ON "prospect_enrichments"("provider", "external_person_id");

-- CreateIndex
CREATE INDEX "prospect_enrichments_status_idx" ON "prospect_enrichments"("status");

-- AddForeignKey
ALTER TABLE "prospect_enrichments" ADD CONSTRAINT "prospect_enrichments_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "prospect_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
