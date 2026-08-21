import { createHash } from "node:crypto";
import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/api-error";

export const formTypesRouter = Router();

formTypesRouter.use(requireAuth);

/**
 * Liste des fiches actives — pour le sélecteur de création d'assignation
 * côté admin. Lecture pure.
 */
formTypesRouter.get("/", async (_req, res) => {
  const formTypes = await prisma.formType.findMany({
    where: { isActive: true },
    orderBy: [{ module: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, module: true, version: true },
  });
  res.json({ formTypes });
});

/**
 * Liste des fiches actives — pour le sélecteur de création d'assignation
 * côté admin. Lecture pure.
 */
formTypesRouter.get("/", async (_req, res) => {
  const formTypes = await prisma.formType.findMany({
    where: { isActive: true },
    orderBy: [{ module: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, module: true, version: true },
  });
  res.json({ formTypes });
});

/**
 * Modèle complet d'une fiche : familles/catégories (form_sections), leurs
 * items de contrôle (form_items), et les segments spatiaux de la fiche
 * (form_segments — vide pour le module bâtiment).
 *
 * Lecture pure (aucune mutation, cf. audit) : le résultat est déterminé par
 * form_types.version, donc sûr à mettre en cache tel quel côté client
 * (IndexedDB / PWA) tant que l'ETag ne change pas.
 */
formTypesRouter.get("/:id/schema", async (req, res) => {
  const formType = await prisma.formType.findUnique({
    where: { id: req.params.id },
    include: {
      sections: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
      segments: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!formType) throw new ApiError(404, "not_found", "Fiche introuvable.");

  const payload = {
    id: formType.id,
    code: formType.code,
    name: formType.name,
    module: formType.module,
    version: formType.version,
    sections: formType.sections.map((s) => ({
      id: s.id,
      code: s.code,
      label: s.label,
      sortOrder: s.sortOrder,
      items: s.items.map((i) => ({
        id: i.id,
        label: i.label,
        sortOrder: i.sortOrder,
      })),
    })),
    segments: formType.segments.map((seg) => ({
      id: seg.id,
      label: seg.label,
      sortOrder: seg.sortOrder,
    })),
  };

  const etag = `"${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}"`;
  res.set("Cache-Control", "private, max-age=3600, must-revalidate");
  res.set("ETag", etag);

  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  res.json(payload);
});
