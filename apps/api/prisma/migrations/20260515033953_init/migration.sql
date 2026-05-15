-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('Discovery', 'Build', 'UAT', 'Launch', 'Hypercare');

-- CreateEnum
CREATE TYPE "ProjectState" AS ENUM ('OnTrack', 'AtRisk', 'Blocked', 'Done');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PM', 'Viewer');

-- CreateEnum
CREATE TYPE "TrackerProvider" AS ENUM ('monday');

-- CreateEnum
CREATE TYPE "TrackerConnectionStatus" AS ENUM ('ok', 'auth_failed', 'rate_limited');

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'Viewer',
    "default_capacity_pct" INTEGER NOT NULL DEFAULT 100,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phase" "Phase" NOT NULL DEFAULT 'Discovery',
    "state" "ProjectState" NOT NULL DEFAULT 'OnTrack',
    "key_dates" JSONB NOT NULL DEFAULT '{}',
    "owner_id" TEXT,
    "tracker_ref" JSONB,
    "field_mapping" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "pct" INTEGER NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracker_connections" (
    "id" TEXT NOT NULL,
    "provider" "TrackerProvider" NOT NULL,
    "workspace" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "status" "TrackerConnectionStatus" NOT NULL DEFAULT 'ok',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracker_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phase_audit_log" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "from_phase" "Phase" NOT NULL,
    "to_phase" "Phase" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phase_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "people_email_key" ON "people"("email");

-- CreateIndex
CREATE INDEX "allocations_person_id_start_end_idx" ON "allocations"("person_id", "start", "end");

-- CreateIndex
CREATE INDEX "allocations_project_id_start_end_idx" ON "allocations"("project_id", "start", "end");

-- CreateIndex
CREATE UNIQUE INDEX "tracker_connections_provider_workspace_key" ON "tracker_connections"("provider", "workspace");

-- CreateIndex
CREATE INDEX "phase_audit_log_project_id_at_idx" ON "phase_audit_log"("project_id", "at");

-- CreateIndex
CREATE INDEX "sessions_person_id_idx" ON "sessions"("person_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_audit_log" ADD CONSTRAINT "phase_audit_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_audit_log" ADD CONSTRAINT "phase_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
