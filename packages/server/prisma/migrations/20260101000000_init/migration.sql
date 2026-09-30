-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IcpStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "icp_profiles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "IcpStatus" NOT NULL DEFAULT 'ACTIVE',
    "schema_version" VARCHAR(32) NOT NULL,
    "config" JSONB NOT NULL,
    "submitted_config" JSONB NOT NULL,
    "scoring_weights" JSONB NOT NULL,
    "created_by" VARCHAR(120),
    "change_reason" VARCHAR(280),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "icp_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icp_profile_versions" (
    "id" UUID NOT NULL,
    "icp_profile_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "IcpStatus" NOT NULL,
    "schema_version" VARCHAR(32) NOT NULL,
    "config" JSONB NOT NULL,
    "submitted_config" JSONB NOT NULL,
    "scoring_weights" JSONB NOT NULL,
    "created_by" VARCHAR(120),
    "change_reason" VARCHAR(280),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "icp_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "icp_profiles_slug_idx" ON "icp_profiles"("slug");

-- CreateIndex
CREATE INDEX "icp_profiles_status_idx" ON "icp_profiles"("status");

-- CreateIndex
CREATE INDEX "icp_profiles_deleted_at_idx" ON "icp_profiles"("deleted_at");

-- CreateIndex
CREATE INDEX "icp_profile_versions_icp_profile_id_idx" ON "icp_profile_versions"("icp_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "icp_profile_versions_icp_profile_id_version_key" ON "icp_profile_versions"("icp_profile_id", "version");

-- AddForeignKey
ALTER TABLE "icp_profile_versions" ADD CONSTRAINT "icp_profile_versions_icp_profile_id_fkey" FOREIGN KEY ("icp_profile_id") REFERENCES "icp_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

