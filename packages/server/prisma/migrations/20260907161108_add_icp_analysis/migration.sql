-- CreateEnum
CREATE TYPE "IcpAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "icp_analyses" (
    "id" UUID NOT NULL,
    "icp_profile_id" UUID NOT NULL,
    "icp_version" INTEGER NOT NULL,
    "status" "IcpAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "prompt_version" VARCHAR(32) NOT NULL,
    "analysis_schema_version" VARCHAR(32) NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "output" JSONB,
    "error_code" VARCHAR(64),
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "icp_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "icp_analyses_icp_profile_id_created_at_idx" ON "icp_analyses"("icp_profile_id", "created_at");

-- CreateIndex
CREATE INDEX "icp_analyses_status_idx" ON "icp_analyses"("status");

-- AddForeignKey
ALTER TABLE "icp_analyses" ADD CONSTRAINT "icp_analyses_icp_profile_id_fkey" FOREIGN KEY ("icp_profile_id") REFERENCES "icp_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
