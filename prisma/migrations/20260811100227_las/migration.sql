-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'supervisor');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('not_submitted', 'in_progress', 'pending', 'verified');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('horizontal', 'batiment');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'supervisor',
    "groups" TEXT[],
    "initials" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "zone" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "group" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "bimester" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'not_submitted',
    "kind" "TaskKind" NOT NULL DEFAULT 'horizontal',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "form" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "group" TEXT NOT NULL,
    "sector" TEXT,
    "compliance" TEXT,
    "comment" TEXT NOT NULL DEFAULT '',
    "defects" JSONB NOT NULL,
    "modelVersion" JSONB NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "constatKey" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_entries" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dictionary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "tasks_group_status_idx" ON "tasks"("group", "status");

-- CreateIndex
CREATE INDEX "tasks_form_idx" ON "tasks"("form");

-- CreateIndex
CREATE INDEX "submissions_taskId_idx" ON "submissions"("taskId");

-- CreateIndex
CREATE INDEX "submissions_submittedAt_idx" ON "submissions"("submittedAt");

-- CreateIndex
CREATE INDEX "photos_submissionId_idx" ON "photos"("submissionId");

-- CreateIndex
CREATE INDEX "dictionary_entries_key_idx" ON "dictionary_entries"("key");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_entries_key_version_key" ON "dictionary_entries"("key", "version");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
