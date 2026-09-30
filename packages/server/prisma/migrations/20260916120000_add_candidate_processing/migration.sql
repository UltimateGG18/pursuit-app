-- CreateEnum
CREATE TYPE "CandidateState" AS ENUM ('SURVIVOR', 'SUPPRESSED', 'COLD');

-- CreateTable
CREATE TABLE "search_runs" (
    "id" UUID NOT NULL,
    "icp_profile_id" UUID NOT NULL,
    "icp_version" INTEGER NOT NULL,
    "analysis_id" UUID,
    "provider" VARCHAR(64) NOT NULL,
    "query_version" VARCHAR(32) NOT NULL,
    "processing_version" VARCHAR(32) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "counts" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "identity_key" VARCHAR(255) NOT NULL,
    "identity_basis" VARCHAR(16) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "normalized_name" VARCHAR(255) NOT NULL,
    "domain" VARCHAR(255),
    "website" VARCHAR(2048),
    "country" VARCHAR(2),
    "location" VARCHAR(255),
    "industry" VARCHAR(160),
    "industry_codes" TEXT[],
    "employee_count" INTEGER,
    "linkedin_url" VARCHAR(2048),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_sources" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_candidates" (
    "id" UUID NOT NULL,
    "search_run_id" UUID NOT NULL,
    "company_id" UUID,
    "provider" VARCHAR(64) NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "person_ref" VARCHAR(255) NOT NULL,
    "state" "CandidateState" NOT NULL,
    "rejections" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_runs_icp_profile_id_created_at_idx" ON "search_runs"("icp_profile_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "companies_identity_key_key" ON "companies"("identity_key");

-- CreateIndex
CREATE INDEX "companies_domain_idx" ON "companies"("domain");

-- CreateIndex
CREATE INDEX "companies_normalized_name_idx" ON "companies"("normalized_name");

-- CreateIndex
CREATE INDEX "company_sources_company_id_idx" ON "company_sources"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_sources_provider_external_id_key" ON "company_sources"("provider", "external_id");

-- CreateIndex
CREATE INDEX "prospect_candidates_company_id_idx" ON "prospect_candidates"("company_id");

-- CreateIndex
CREATE INDEX "prospect_candidates_state_idx" ON "prospect_candidates"("state");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_candidates_search_run_id_person_ref_key" ON "prospect_candidates"("search_run_id", "person_ref");

-- AddForeignKey
ALTER TABLE "search_runs" ADD CONSTRAINT "search_runs_icp_profile_id_fkey" FOREIGN KEY ("icp_profile_id") REFERENCES "icp_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_sources" ADD CONSTRAINT "company_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_candidates" ADD CONSTRAINT "prospect_candidates_search_run_id_fkey" FOREIGN KEY ("search_run_id") REFERENCES "search_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_candidates" ADD CONSTRAINT "prospect_candidates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

