/*
  Warnings:

  - A unique constraint covering the columns `[inspection_value_id,client_ref]` on the table `inspection_photos` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "inspection_photos" ADD COLUMN     "client_ref" TEXT,
ADD COLUMN     "storage_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "inspection_photos_inspection_value_id_client_ref_key" ON "inspection_photos"("inspection_value_id", "client_ref");
