-- CreateTable
CREATE TABLE "evaluations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supervisor_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "bimonthly_period" INTEGER NOT NULL,
    "group_id" UUID,
    "respect_delais" INTEGER,
    "qualite_inspections" INTEGER,
    "qualite_observations" INTEGER,
    "suivi_anomalies" INTEGER,
    "respect_procedures" INTEGER,
    "reactivite" INTEGER,
    "autonomie" INTEGER,
    "strengths" TEXT,
    "weaknesses" TEXT,
    "recommendations" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluations_supervisor_id_idx" ON "evaluations"("supervisor_id");

-- CreateIndex
CREATE INDEX "evaluations_year_bimonthly_period_idx" ON "evaluations"("year", "bimonthly_period");

-- CreateIndex
CREATE INDEX "evaluations_group_id_idx" ON "evaluations"("group_id");

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
