-- CreateEnum
CREATE TYPE "RagLevel" AS ENUM ('Red', 'Amber', 'Green');

-- CreateEnum
CREATE TYPE "RiskType" AS ENUM ('Technical', 'Relationship', 'Schedule', 'ExternalDependency', 'Gap', 'Resourcing');

-- CreateEnum
CREATE TYPE "RiskState" AS ENUM ('Blocked', 'Inform');

-- CreateTable
CREATE TABLE "project_risk_updates" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "week_of" DATE NOT NULL,
    "rag_level" "RagLevel" NOT NULL,
    "risk_types" "RiskType"[],
    "state" "RiskState" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "go_to_green_plan" TEXT NOT NULL DEFAULT '',
    "latest_update" TEXT NOT NULL DEFAULT '',
    "next_steps" TEXT NOT NULL DEFAULT '',
    "action_requested" TEXT NOT NULL DEFAULT '',
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_risk_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_risk_updates_project_id_week_of_key" ON "project_risk_updates"("project_id", "week_of");

-- CreateIndex
CREATE INDEX "project_risk_updates_week_of_idx" ON "project_risk_updates"("week_of");

-- AddForeignKey
ALTER TABLE "project_risk_updates" ADD CONSTRAINT "project_risk_updates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risk_updates" ADD CONSTRAINT "project_risk_updates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
