import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAuth, assertGroupAccess } from "../middleware/auth";
import { ApiError } from "../lib/api-error";
import {
  isImageDataUrl,
  savePhotoFromDataUrl,
  deletePhoto,
} from "../lib/photo-storage";

export const inspectionsRouter = Router();

inspectionsRouter.use(requireAuth);

async function loadInspectionOrThrow(id: string) {
  const inspection = await prisma.inspection.findUnique({ where: { id } });
  if (!inspection)
    throw new ApiError(404, "not_found", "Inspection introuvable.");
  return inspection;
}

/**
 * Lecture pure — ajoutée en complément d'Epic 3 (non listée dans les 5
 * endpoints de mutation/schéma, mais nécessaire au frontend pour afficher
 * l'état déjà saisi lors d'une reprise de brouillon). Aucun effet de bord.
 */
inspectionsRouter.get("/:id", async (req, res) => {
  const inspection = await loadInspectionOrThrow(req.params.id);
  assertGroupAccess(req.user!, inspection.groupId);

  const [values, submittedBy] = await Promise.all([
    prisma.inspectionValue.findMany({
      where: { inspectionId: inspection.id },
      include: { photos: true, correctiveActions: true },
    }),
    inspection.submittedById
      ? prisma.user.findUnique({
          where: { id: inspection.submittedById },
          select: { displayName: true },
        })
      : null,
  ]);

  res.json({ ...inspection, values, submittedBy });
});

const patchHeaderBody = z.object({
  sector: z.enum(["landside", "airside"]).nullable().optional(),
  acceptance: z.enum(["conforme", "non_conforme"]).nullable().optional(),
  headerComment: z.string().nullable().optional(),
});

/**
 * Champs d'en-tête (module bâtiment) : secteur, conformité, commentaire
 * général. Distincts des constats (inspection_values) — non listés dans
 * Epic 3, ajoutés pour couvrir ce que gérait l'écran existant.
 */
inspectionsRouter.patch("/:id", async (req, res) => {
  const inspection = await loadInspectionOrThrow(req.params.id);
  assertGroupAccess(req.user!, inspection.groupId);
  assertNotSubmitted(inspection.status);

  const parsed = patchHeaderBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }

  const updated = await prisma.inspection.update({
    where: { id: inspection.id },
    data: parsed.data,
  });

  res.json(updated);
});

function assertNotSubmitted(status: string) {
  // Hors périmètre exact du §5.4 (non fourni en intégralité) : une fiche déjà
  // soumise ne se modifie plus depuis cette API. À ajuster si le §5.4 prévoit
  // un autre comportement (ex. correction post-soumission par un approbateur).
  if (status !== "non_soumis") {
    throw new ApiError(
      409,
      "already_submitted",
      "Cette inspection est déjà soumise et ne peut plus être modifiée depuis cette route.",
    );
  }
}

// ========= PATCH /:id/values =========

const valueInput = z.object({
  itemId: z.string().uuid(),
  segmentId: z.string().uuid().nullable().optional(),
  state: z.enum(["non_inspecte", "ras", "minor", "major", "yes", "na"]),
  severity: z.enum(["leger", "moyen", "eleve"]).nullable().optional(),
  revealQualitative: z.string().nullable().optional(),
  // Fiche de Suivi (FS) — "revélé quantitatif". Légende : S = Surface (m²),
  // long = longueur (m), h ou p = hauteur ou profondeur (m).
  measurementSurfaceM2: z.number().nullable().optional(),
  measurementLengthM: z.number().nullable().optional(),
  measurementHeightOrDepthM: z.number().nullable().optional(),
  locationAction: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});

const patchValuesBody = z.object({
  values: z.array(valueInput).min(1, "Au moins un constat est requis."),
});

/**
 * Upsert par lot, idempotent : rejouer deux fois le même PATCH ne crée
 * qu'une seule ligne par (inspection_id, item_id, segment_id). S'appuie sur
 * INSERT ... ON CONFLICT plutôt que sur un SELECT préalable, pour rester
 * correct sous tentatives concurrentes (retry hors-ligne PWA notamment).
 * Deux variantes de conflit car segment_id est nullable et NULL <> NULL en
 * SQL (cf. migration idx_inspection_values_no_segment).
 */
inspectionsRouter.patch("/:id/values", async (req, res) => {
  const inspection = await loadInspectionOrThrow(req.params.id);
  assertGroupAccess(req.user!, inspection.groupId);
  assertNotSubmitted(inspection.status);

  const parsed = patchValuesBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }
  const { values } = parsed.data;

  // Valide que chaque item/segment appartient bien au form_type de l'inspection.
  const validItems = await prisma.formItem.findMany({
    where: { section: { formTypeId: inspection.formTypeId } },
    select: { id: true },
  });
  const validItemIds = new Set(validItems.map((i) => i.id));
  const validSegments = await prisma.formSegment.findMany({
    where: { formTypeId: inspection.formTypeId },
    select: { id: true },
  });
  const validSegmentIds = new Set(validSegments.map((s) => s.id));

  const invalid = values.filter(
    (v) =>
      !validItemIds.has(v.itemId) ||
      (v.segmentId != null && !validSegmentIds.has(v.segmentId)),
  );
  if (invalid.length > 0) {
    throw new ApiError(
      422,
      "unknown_item_or_segment",
      "Item ou segment hors du modèle de la fiche.",
      {
        invalid,
      },
    );
  }

  const exclusions = await prisma.formItemSegmentExclusion.findMany({
    where: { itemId: { in: values.map((v) => v.itemId) } },
  });
  const excludedPairs = new Set(
    exclusions.map((e) => `${e.itemId}:${e.segmentId}`),
  );
  const excluded = values.filter(
    (v) =>
      v.segmentId != null && excludedPairs.has(`${v.itemId}:${v.segmentId}`),
  );
  if (excluded.length > 0) {
    throw new ApiError(
      422,
      "not_applicable",
      "Ce constat ne s'applique pas à ce segment pour cette fiche.",
      { excluded },
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const v of values) {
      const severity = v.severity ?? null;
      const reveal = v.revealQualitative ?? null;
      const location = v.locationAction ?? null;
      const comment = v.comment ?? null;
      const surface = v.measurementSurfaceM2 ?? null;
      const length = v.measurementLengthM ?? null;
      const heightOrDepth = v.measurementHeightOrDepthM ?? null;

      if (v.segmentId) {
        await tx.$executeRaw`
          INSERT INTO inspection_values
            (inspection_id, item_id, segment_id, state, severity, reveal_qualitative,
             measurement_surface_m2, measurement_length_m, measurement_height_or_depth_m,
             location_action, comment, updated_at)
          VALUES
            (${inspection.id}::uuid, ${v.itemId}::uuid, ${v.segmentId}::uuid, ${v.state}::finding_state,
             ${severity}::severity_level, ${reveal}, ${surface}, ${length}, ${heightOrDepth},
             ${location}, ${comment}, now())
          ON CONFLICT (inspection_id, item_id, segment_id)
          DO UPDATE SET
            state = EXCLUDED.state,
            severity = EXCLUDED.severity,
            reveal_qualitative = EXCLUDED.reveal_qualitative,
            measurement_surface_m2 = EXCLUDED.measurement_surface_m2,
            measurement_length_m = EXCLUDED.measurement_length_m,
            measurement_height_or_depth_m = EXCLUDED.measurement_height_or_depth_m,
            location_action = EXCLUDED.location_action,
            comment = EXCLUDED.comment,
            updated_at = now()
        `;
      } else {
        await tx.$executeRaw`
          INSERT INTO inspection_values
            (inspection_id, item_id, segment_id, state, severity, reveal_qualitative,
             measurement_surface_m2, measurement_length_m, measurement_height_or_depth_m,
             location_action, comment, updated_at)
          VALUES
            (${inspection.id}::uuid, ${v.itemId}::uuid, NULL, ${v.state}::finding_state,
             ${severity}::severity_level, ${reveal}, ${surface}, ${length}, ${heightOrDepth},
             ${location}, ${comment}, now())
          ON CONFLICT (inspection_id, item_id) WHERE segment_id IS NULL
          DO UPDATE SET
            state = EXCLUDED.state,
            severity = EXCLUDED.severity,
            reveal_qualitative = EXCLUDED.reveal_qualitative,
            measurement_surface_m2 = EXCLUDED.measurement_surface_m2,
            measurement_length_m = EXCLUDED.measurement_length_m,
            measurement_height_or_depth_m = EXCLUDED.measurement_height_or_depth_m,
            location_action = EXCLUDED.location_action,
            comment = EXCLUDED.comment,
            updated_at = now()
        `;
      }
    }
    await tx.inspection.update({
      where: { id: inspection.id },
      data: { updatedAt: new Date() },
    });
  });

  const refreshed = await prisma.inspectionValue.findMany({
    where: {
      inspectionId: inspection.id,
      OR: values.map((v) => ({
        itemId: v.itemId,
        segmentId: v.segmentId ?? null,
      })),
    },
  });
  res.json({ values: refreshed });
});

// ========= POST /:id/sections/:sectionId/mark-all-ras =========

/**
 * "Tout RAS" [D4][D5] : passe à `ras` uniquement les constats encore
 * `non_inspecte` (créés à la volée s'ils n'existent pas encore) — n'écrase
 * jamais un défaut déjà saisi. La condition `WHERE state = 'non_inspecte'`
 * dans le ON CONFLICT rend l'opération atomique et sûre en concurrence.
 */
inspectionsRouter.post(
  "/:id/sections/:sectionId/mark-all-ras",
  async (req, res) => {
    const inspection = await loadInspectionOrThrow(req.params.id);
    assertGroupAccess(req.user!, inspection.groupId);
    assertNotSubmitted(inspection.status);

    const section = await prisma.formSection.findUnique({
      where: { id: req.params.sectionId },
    });
    if (!section || section.formTypeId !== inspection.formTypeId) {
      throw new ApiError(
        404,
        "not_found",
        "Famille/catégorie introuvable pour cette fiche.",
      );
    }

    const items = await prisma.formItem.findMany({
      where: { sectionId: section.id },
    });
    const segments = await prisma.formSegment.findMany({
      where: { formTypeId: inspection.formTypeId },
    });
    const segmentIds: (string | null)[] =
      segments.length > 0 ? segments.map((s) => s.id) : [null];

    let touched = 0;
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        for (const segmentId of segmentIds) {
          const result = segmentId
            ? await tx.$executeRaw`
              INSERT INTO inspection_values (inspection_id, item_id, segment_id, state, updated_at)
              VALUES (${inspection.id}::uuid, ${item.id}::uuid, ${segmentId}::uuid, 'ras', now())
              ON CONFLICT (inspection_id, item_id, segment_id)
              DO UPDATE SET state = 'ras', updated_at = now() WHERE inspection_values.state = 'non_inspecte'
            `
            : await tx.$executeRaw`
              INSERT INTO inspection_values (inspection_id, item_id, segment_id, state, updated_at)
              VALUES (${inspection.id}::uuid, ${item.id}::uuid, NULL, 'ras', now())
              ON CONFLICT (inspection_id, item_id) WHERE segment_id IS NULL
              DO UPDATE SET state = 'ras', updated_at = now() WHERE inspection_values.state = 'non_inspecte'
            `;
          touched += Number(result);
        }
      }
      await tx.inspection.update({
        where: { id: inspection.id },
        data: { updatedAt: new Date() },
      });
    });

    res.json({
      sectionId: section.id,
      itemsProcessed: items.length,
      valuesTouched: touched,
    });
  },
);

// ========= POST /:id/submit =========

/**
 * Validations de soumission. Seule règle confirmée en l'état ([acceptance
 * criteria]) : un défaut (minor/major) sans sévérité est rejeté. Le reste
 * du §5.4 (non transmis intégralement) n'est pas encore implémenté — à
 * compléter dès réception du détail complet de la section.
 */
inspectionsRouter.post("/:id/submit", async (req, res) => {
  const inspection = await loadInspectionOrThrow(req.params.id);
  assertGroupAccess(req.user!, inspection.groupId);

  if (inspection.status !== "non_soumis") {
    throw new ApiError(
      409,
      "already_submitted",
      "Cette inspection est déjà soumise.",
    );
  }

  const values = await prisma.inspectionValue.findMany({
    where: { inspectionId: inspection.id },
  });

  const missingSeverity = values.filter(
    (v) => (v.state === "minor" || v.state === "major") && v.severity == null,
  );
  if (missingSeverity.length > 0) {
    throw new ApiError(
      422,
      "missing_severity",
      "Un ou plusieurs défauts n'ont pas de sévérité renseignée.",
      { valueIds: missingSeverity.map((v) => v.id) },
    );
  }

  const updated = await prisma.inspection.update({
    where: { id: inspection.id },
    data: {
      status: "soumis",
      submittedById: req.user!.id,
      submittedAt: new Date(),
    },
  });

  res.json(updated);
});

// ========= POST /:id/values/:valueId/photos =========

async function loadOwnedValueOrThrow(inspectionId: string, valueId: string) {
  const value = await prisma.inspectionValue.findUnique({
    where: { id: valueId },
  });
  if (!value || value.inspectionId !== inspectionId) {
    throw new ApiError(
      404,
      "not_found",
      "Constat introuvable pour cette inspection.",
    );
  }
  return value;
}

const uploadPhotoBody = z.object({
  dataUrl: z.string().min(1),
  idempotencyKey: z.string().optional(),
});

/**
 * Ajout d'une photo à un constat, stockage objets S3-compatible (cf.
 * lib/photo-storage.ts). Idempotent via idempotencyKey : la file
 * hors-ligne (front) peut rejouer cette requête sans risque de doublon si
 * la réponse d'un envoi précédent n'a jamais été reçue.
 */
inspectionsRouter.post("/:id/values/:valueId/photos", async (req, res) => {
  const inspection = await loadInspectionOrThrow(req.params.id);
  assertGroupAccess(req.user!, inspection.groupId);
  assertNotSubmitted(inspection.status);
  await loadOwnedValueOrThrow(inspection.id, req.params.valueId);

  const parsed = uploadPhotoBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }
  const { dataUrl, idempotencyKey } = parsed.data;

  if (idempotencyKey) {
    const existing = await prisma.inspectionPhoto.findFirst({
      where: {
        inspectionValueId: req.params.valueId,
        clientRef: idempotencyKey,
      },
    });
    if (existing) return res.status(200).json(existing);
  }

  if (!isImageDataUrl(dataUrl)) {
    throw new ApiError(
      422,
      "invalid_image",
      "Format d'image non supporté (jpeg/png/webp attendus).",
    );
  }

  const stored = await savePhotoFromDataUrl(dataUrl);
  try {
    const photo = await prisma.inspectionPhoto.create({
      data: {
        inspectionValueId: req.params.valueId,
        url: stored.url,
        storageKey: stored.storageKey,
        clientRef: idempotencyKey ?? null,
      },
    });
    return res.status(201).json(photo);
  } catch (err) {
    if (
      idempotencyKey &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const raced = await prisma.inspectionPhoto.findFirst({
        where: {
          inspectionValueId: req.params.valueId,
          clientRef: idempotencyKey,
        },
      });
      if (raced) return res.status(200).json(raced);
    }
    throw err;
  }
});

// ========= DELETE /:id/values/:valueId/photos/:photoId =========

inspectionsRouter.delete(
  "/:id/values/:valueId/photos/:photoId",
  async (req, res) => {
    const inspection = await loadInspectionOrThrow(req.params.id);
    assertGroupAccess(req.user!, inspection.groupId);
    assertNotSubmitted(inspection.status);
    await loadOwnedValueOrThrow(inspection.id, req.params.valueId);

    const photo = await prisma.inspectionPhoto.findUnique({
      where: { id: req.params.photoId },
    });
    if (!photo || photo.inspectionValueId !== req.params.valueId) {
      throw new ApiError(
        404,
        "not_found",
        "Photo introuvable pour ce constat.",
      );
    }

    await prisma.inspectionPhoto.delete({ where: { id: photo.id } });
    try {
      await deletePhoto(photo.storageKey);
    } catch (err) {
      // La ligne DB est supprimée (source de vérité pour l'app) ; un objet
      // orphelin dans le bucket est un coût de stockage, pas une incohérence
      // fonctionnelle — on log plutôt que de faire échouer la requête.
      console.error(
        "Échec de suppression de l'objet S3",
        photo.storageKey,
        err,
      );
    }
    res.status(204).end();
  },
);

// ========= PUT /:id/values/:valueId/corrective-action =========

const correctiveActionBody = z.object({
  reference: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

/**
 * Lien vers une fiche de non-conformité externe (ex. "Ouverture d'une fiche
 * de réparation N°..."), traçable mais non obligatoire — cf. corrective_
 * actions du schéma v1.1. Un seul enregistrement par constat dans cette
 * API (upsert), la table autorise plus mais l'usage existant n'en avait
 * besoin que d'un.
 */
inspectionsRouter.put(
  "/:id/values/:valueId/corrective-action",
  async (req, res) => {
    const inspection = await loadInspectionOrThrow(req.params.id);
    assertGroupAccess(req.user!, inspection.groupId);
    assertNotSubmitted(inspection.status);
    await loadOwnedValueOrThrow(inspection.id, req.params.valueId);

    const parsed = correctiveActionBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(
        422,
        "invalid_body",
        "Corps de requête invalide.",
        parsed.error.flatten(),
      );
    }

    const existing = await prisma.correctiveAction.findFirst({
      where: { inspectionValueId: req.params.valueId },
    });

    const saved = existing
      ? await prisma.correctiveAction.update({
          where: { id: existing.id },
          data: parsed.data,
        })
      : await prisma.correctiveAction.create({
          data: { inspectionValueId: req.params.valueId, ...parsed.data },
        });

    res.status(existing ? 200 : 201).json(saved);
  },
);

// ========= DELETE /:id/values/:valueId/corrective-action =========

inspectionsRouter.delete(
  "/:id/values/:valueId/corrective-action",
  async (req, res) => {
    const inspection = await loadInspectionOrThrow(req.params.id);
    assertGroupAccess(req.user!, inspection.groupId);
    assertNotSubmitted(inspection.status);
    await loadOwnedValueOrThrow(inspection.id, req.params.valueId);

    const existing = await prisma.correctiveAction.findFirst({
      where: { inspectionValueId: req.params.valueId },
    });
    if (existing) {
      await prisma.correctiveAction.delete({ where: { id: existing.id } });
    }
    res.status(204).end();
  },
);
