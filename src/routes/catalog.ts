import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { ApiError } from "../lib/api-error";

export const catalogRouter = Router();

catalogRouter.use(requireAuth, requireRole("administrateur"));

/**
 * Traduit les erreurs Prisma courantes (contrainte unique, clé étrangère)
 * en réponses HTTP explicites plutôt que de laisser remonter une 500 brute.
 */
function rethrowAsApiError(err: unknown, conflictMessage: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      throw new ApiError(409, "conflict", conflictMessage);
    }
    if (err.code === "P2003" || err.code === "P2014") {
      throw new ApiError(
        409,
        "in_use",
        "Impossible de supprimer : des données existantes en dépendent (constats déjà saisis).",
      );
    }
  }
  throw err;
}

// ========= FORM TYPES =========

/**
 * Liste complète (actives + inactives) — distincte de GET /api/form-types
 * (public, filtré aux actives) car l'éditeur admin doit pouvoir retrouver
 * et réactiver une fiche désactivée.
 */
catalogRouter.get("/form-types", async (_req, res) => {
  const formTypes = await prisma.formType.findMany({
    orderBy: [{ module: "asc" }, { name: "asc" }],
  });
  res.json({ formTypes });
});

const createFormTypeBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  module: z.enum(["horizontal", "vertical"]),
});

catalogRouter.post("/form-types", async (req, res) => {
  const parsed = createFormTypeBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }
  try {
    const formType = await prisma.formType.create({
      data: { ...parsed.data, version: 1 },
    });
    res.status(201).json(formType);
  } catch (err) {
    rethrowAsApiError(err, "Ce code de fiche existe déjà pour cette version.");
  }
});

const patchFormTypeBody = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

catalogRouter.patch("/form-types/:id", async (req, res) => {
  const parsed = patchFormTypeBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }
  const formType = await prisma.formType.findUnique({
    where: { id: req.params.id },
  });
  if (!formType) throw new ApiError(404, "not_found", "Fiche introuvable.");

  const updated = await prisma.formType.update({
    where: { id: formType.id },
    data: parsed.data,
  });
  res.json(updated);
});

catalogRouter.delete("/form-types/:id", async (req, res) => {
  const formType = await prisma.formType.findUnique({
    where: { id: req.params.id },
  });
  if (!formType) throw new ApiError(404, "not_found", "Fiche introuvable.");

  const inUse = await prisma.assignment.findFirst({
    where: { formTypeId: formType.id },
  });
  if (inUse) {
    throw new ApiError(
      409,
      "in_use",
      "Impossible de supprimer : des assignations existent déjà pour cette fiche.",
    );
  }

  await prisma.formType.delete({ where: { id: formType.id } });
  res.status(204).end();
});

// ========= SECTIONS (familles / catégories) =========

const createSectionBody = z.object({
  code: z.string().nullable().optional(),
  label: z.string().min(1),
  sortOrder: z.number().int().default(0),
});

catalogRouter.post("/form-types/:formTypeId/sections", async (req, res) => {
  const formType = await prisma.formType.findUnique({
    where: { id: req.params.formTypeId },
  });
  if (!formType) throw new ApiError(404, "not_found", "Fiche introuvable.");

  const parsed = createSectionBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }

  const section = await prisma.formSection.create({
    data: { formTypeId: formType.id, ...parsed.data },
  });
  res.status(201).json(section);
});

const patchSectionBody = z.object({
  code: z.string().nullable().optional(),
  label: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
});

catalogRouter.patch("/sections/:id", async (req, res) => {
  const section = await prisma.formSection.findUnique({
    where: { id: req.params.id },
  });
  if (!section)
    throw new ApiError(404, "not_found", "Famille/catégorie introuvable.");

  const parsed = patchSectionBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }

  const updated = await prisma.formSection.update({
    where: { id: section.id },
    data: parsed.data,
  });
  res.json(updated);
});

catalogRouter.delete("/sections/:id", async (req, res) => {
  const section = await prisma.formSection.findUnique({
    where: { id: req.params.id },
  });
  if (!section)
    throw new ApiError(404, "not_found", "Famille/catégorie introuvable.");

  try {
    // onDelete: Cascade sur form_items — mais un item déjà référencé par un
    // constat (inspection_values.item_id, sans cascade) fera échouer la
    // suppression avec une contrainte FK, capturée ci-dessous.
    await prisma.formSection.delete({ where: { id: section.id } });
    res.status(204).end();
  } catch (err) {
    rethrowAsApiError(err, "Conflit de contrainte.");
  }
});

// ========= ITEMS (types de dégradation / items de contrôle) =========

const createItemBody = z.object({
  label: z.string().min(1),
  sortOrder: z.number().int().default(0),
});

catalogRouter.post("/sections/:sectionId/items", async (req, res) => {
  const section = await prisma.formSection.findUnique({
    where: { id: req.params.sectionId },
  });
  if (!section)
    throw new ApiError(404, "not_found", "Famille/catégorie introuvable.");

  const parsed = createItemBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }

  const item = await prisma.formItem.create({
    data: { sectionId: section.id, ...parsed.data },
  });
  res.status(201).json(item);
});

const patchItemBody = z.object({
  label: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
});

catalogRouter.patch("/items/:id", async (req, res) => {
  const item = await prisma.formItem.findUnique({
    where: { id: req.params.id },
  });
  if (!item) throw new ApiError(404, "not_found", "Item introuvable.");

  const parsed = patchItemBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }

  const updated = await prisma.formItem.update({
    where: { id: item.id },
    data: parsed.data,
  });
  res.json(updated);
});

catalogRouter.delete("/items/:id", async (req, res) => {
  const item = await prisma.formItem.findUnique({
    where: { id: req.params.id },
  });
  if (!item) throw new ApiError(404, "not_found", "Item introuvable.");

  try {
    await prisma.formItem.delete({ where: { id: item.id } });
    res.status(204).end();
  } catch (err) {
    rethrowAsApiError(
      err,
      "Impossible de supprimer : des constats existants référencent cet item.",
    );
  }
});

// ========= SEGMENTS (spatiaux, module horizontal uniquement) =========

const createSegmentBody = z.object({
  label: z.string().min(1),
  sortOrder: z.number().int().default(0),
});

catalogRouter.post("/form-types/:formTypeId/segments", async (req, res) => {
  const formType = await prisma.formType.findUnique({
    where: { id: req.params.formTypeId },
  });
  if (!formType) throw new ApiError(404, "not_found", "Fiche introuvable.");

  const parsed = createSegmentBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }

  const segment = await prisma.formSegment.create({
    data: { formTypeId: formType.id, ...parsed.data },
  });
  res.status(201).json(segment);
});

const patchSegmentBody = z.object({
  label: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
});

catalogRouter.patch("/segments/:id", async (req, res) => {
  const segment = await prisma.formSegment.findUnique({
    where: { id: req.params.id },
  });
  if (!segment) throw new ApiError(404, "not_found", "Segment introuvable.");

  const parsed = patchSegmentBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }

  const updated = await prisma.formSegment.update({
    where: { id: segment.id },
    data: parsed.data,
  });
  res.json(updated);
});

catalogRouter.delete("/segments/:id", async (req, res) => {
  const segment = await prisma.formSegment.findUnique({
    where: { id: req.params.id },
  });
  if (!segment) throw new ApiError(404, "not_found", "Segment introuvable.");

  try {
    await prisma.formSegment.delete({ where: { id: segment.id } });
    res.status(204).end();
  } catch (err) {
    rethrowAsApiError(
      err,
      "Impossible de supprimer : des constats existants référencent ce segment.",
    );
  }
});

// ========= EXCLUSIONS (cellules non applicables item × segment) =========
// Ex. FIB Runway : "Marque de seuil de piste" ne s'applique pas à la zone
// 2/3 sur la fiche réelle (cellule grisée).

catalogRouter.put("/items/:itemId/exclusions/:segmentId", async (req, res) => {
  const item = await prisma.formItem.findUnique({
    where: { id: req.params.itemId },
  });
  if (!item) throw new ApiError(404, "not_found", "Item introuvable.");
  const segment = await prisma.formSegment.findUnique({
    where: { id: req.params.segmentId },
  });
  if (!segment) throw new ApiError(404, "not_found", "Segment introuvable.");

  await prisma.formItemSegmentExclusion.upsert({
    where: { itemId_segmentId: { itemId: item.id, segmentId: segment.id } },
    update: {},
    create: { itemId: item.id, segmentId: segment.id },
  });
  res.status(204).end();
});

catalogRouter.delete(
  "/items/:itemId/exclusions/:segmentId",
  async (req, res) => {
    await prisma.formItemSegmentExclusion.deleteMany({
      where: { itemId: req.params.itemId, segmentId: req.params.segmentId },
    });
    res.status(204).end();
  },
);
