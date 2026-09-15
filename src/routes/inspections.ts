import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import {
  requireAuth,
  requireRole,
  assertGroupAccess,
} from "../middleware/auth";
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

// ========= GET / (liste des fiches soumises — admin tous groupes, superviseur ses propres fiches) =========
//
// Filtres : q (recherche libre), year, bimester, week, formTypeId, status.
// Admin/approbateur : toutes les fiches soumises+ (tous groupes).
// Superviseur : uniquement celles qu'il a lui-même soumises.
//
// À insérer dans inspections.ts, AVANT `inspectionsRouter.get("/:id", ...)`
// (sinon Express matcherait "/" à "/:id" en premier — l'ordre des routes
// compte). Import supplémentaire nécessaire en haut du fichier :
// import { z } from "zod"; (déjà présent) — rien d'autre à ajouter.

inspectionsRouter.get("/", async (req, res) => {
  const user = req.user!;
  const isAdmin = user.role === "administrateur" || user.role === "approbateur";

  const { q, year, bimester, week, formTypeId, status } = req.query as Record<
    string,
    string | undefined
  >;

  const where: Prisma.InspectionWhereInput = {
    status: { not: "non_soumis" }, // "soumis"/"vérifié"/"rejeté" uniquement — jamais les brouillons
  };

  if (!isAdmin) {
    where.submittedById = user.id;
  }
  if (formTypeId) where.formTypeId = formTypeId;
  if (status && status !== "all") {
    where.status = status as "soumis" | "verifie" | "rejete";
  }
  const assignmentFilter: { year?: number; bimonthlyPeriod?: number } = {};
  if (year && year !== "all") assignmentFilter.year = Number(year);
  if (bimester && bimester !== "all")
    assignmentFilter.bimonthlyPeriod = Number(bimester);
  if (Object.keys(assignmentFilter).length > 0) {
    where.assignment = assignmentFilter;
  }
  if (week && week !== "all") {
    where.weekNumber = Number(week);
  }
  if (q) {
    where.OR = [
      { formType: { name: { contains: q, mode: "insensitive" } } },
      { assignment: { zoneNotes: { contains: q, mode: "insensitive" } } },
      { submittedBy: { displayName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const inspections = await prisma.inspection.findMany({
    where,
    include: {
      formType: { select: { id: true, code: true, name: true, module: true } },
      group: { select: { id: true, name: true } },
      assignment: {
        select: { zoneNotes: true, year: true, bimonthlyPeriod: true },
      },
      submittedBy: { select: { id: true, displayName: true } },
      verifiedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { submittedAt: "desc" },
  });

  res.json({ inspections });
});

// ========= POST /:id/verify =========

/**
 * Validation admin : une fiche soumise devient "vérifiée". Réservé
 * admin/approbateur. Trace qui a vérifié et quand (déjà prévu au schéma).
 */
inspectionsRouter.post(
  "/:id/verify",
  requireRole("administrateur", "approbateur"),
  async (req, res) => {
    const inspection = await loadInspectionOrThrow(req.params.id);
    if (inspection.status !== "soumis") {
      throw new ApiError(
        409,
        "invalid_status",
        "Seule une fiche soumise peut être vérifiée.",
      );
    }
    const updated = await prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        status: "verifie",
        verifiedById: req.user!.id,
        verifiedAt: new Date(),
      },
    });
    res.json(updated);
  },
);

// ========= POST /:id/reject =========

// const rejectBody = z.object({ reason: z.string().min(1) });

inspectionsRouter.post(
  "/:id/reject",
  requireRole("administrateur", "approbateur"),
  async (req, res) => {
    const inspection = await loadInspectionOrThrow(req.params.id);
    if (inspection.status !== "soumis") {
      throw new ApiError(
        409,
        "invalid_status",
        "Seule une fiche soumise peut être rejetée.",
      );
    }
    const parsed = rejectBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(422, "invalid_body", "Un motif de rejet est requis.");
    }
    const updated = await prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        status: "rejete",
        verifiedById: req.user!.id,
        verifiedAt: new Date(),
        rejectionReason: parsed.data.reason,
      },
    });
    res.json(updated);
  },
);

// ========= GET /gallery =========
/**
 * Galerie des photos d'inspection.
 *
 * Administrateur / approbateur :
 *   - toutes les photos de toutes les inspections.
 *
 * Superviseur :
 *   - uniquement les photos des inspections qu'il a soumises.
 */
inspectionsRouter.get("/gallery", async (req, res) => {
  const user = req.user!;

  const isGlobalRole =
    user.role === "administrateur" || user.role === "approbateur";

  const inspections = await prisma.inspection.findMany({
    where: {
      ...(isGlobalRole
        ? {}
        : {
            submittedById: user.id,
          }),

      // On ne veut pas afficher les brouillons
      status: {
        not: "non_soumis",
      },
    },

    select: {
      id: true,
      status: true,
      submittedAt: true,
      createdAt: true,
      ouvrage: true,
      group: {
        select: {
          id: true,
          name: true,
        },
      },
      formType: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      submittedBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
      values: {
        where: {
          photos: {
            some: {},
          },
        },
        select: {
          id: true,
          item: {
            select: {
              id: true,
              label: true,
            },
          },
          segment: {
            select: {
              id: true,
              label: true,
            },
          },
          photos: {
            select: {
              id: true,
              url: true,
              thumbUrl: true,
              storageKey: true,
              clientRef: true,
              createdAt: true,
            },
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      },
    },

    orderBy: [
      {
        submittedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });

  const photos = inspections.flatMap((inspection) =>
    inspection.values.flatMap((value) =>
      value.photos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        thumbUrl: photo.thumbUrl,
        storageKey: photo.storageKey,
        clientRef: photo.clientRef,
        createdAt: photo.createdAt,

        inspectionId: inspection.id,
        inspectionStatus: inspection.status,
        submittedAt: inspection.submittedAt,

        formType: inspection.formType,
        group: inspection.group,
        submittedBy: inspection.submittedBy,

        item: value.item,
        segment: value.segment,

        ouvrage: inspection.ouvrage,
      })),
    ),
  );

  return res.json({
    photos,
    total: photos.length,
  });
});

// ========= GET /:id =========
/**
 * Lecture détaillée d'une inspection.
 *
 * Administrateur / approbateur :
 *   - peuvent consulter les fiches de tous les groupes.
 *
 * Superviseur :
 *   - peut uniquement consulter les fiches de son groupe.
 */
inspectionsRouter.get("/:id", async (req, res) => {
  const inspection = await loadInspectionOrThrow(req.params.id);

  // Les administrateurs et approbateurs peuvent consulter
  // les fiches de tous les groupes.
  //
  // Le superviseur reste limité à son propre groupe.
  if (req.user!.role !== "administrateur" && req.user!.role !== "approbateur") {
    assertGroupAccess(req.user!, inspection.groupId);
  }

  const [values, submittedBy, verifiedBy] = await Promise.all([
    prisma.inspectionValue.findMany({
      where: { inspectionId: inspection.id },
      include: {
        photos: true,
        correctiveActions: true,
      },
    }),

    inspection.submittedById
      ? prisma.user.findUnique({
          where: { id: inspection.submittedById },
          select: {
            id: true,
            displayName: true,
          },
        })
      : null,

    inspection.verifiedById
      ? prisma.user.findUnique({
          where: { id: inspection.verifiedById },
          select: {
            id: true,
            displayName: true,
          },
        })
      : null,
  ]);

  res.json({
    ...inspection,
    values,
    submittedBy,
    verifiedBy,
    rejectionReason: inspection.rejectionReason ?? null,
  });
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
    if (photo.storageKey) {
      try {
        await deletePhoto(photo.storageKey);
      } catch (err) {
        console.error(
          "Échec de suppression de l'objet S3",
          photo.storageKey,
          err,
        );
      }
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

export const assignmentsRouter = Router();

assignmentsRouter.use(requireAuth);

const ASSIGNMENT_INCLUDE = {
  formType: { select: { id: true, code: true, name: true, module: true } },
  group: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, displayName: true } },
} as const;

/**
 * Liste des assignations. Un superviseur ne voit que celles de ses groupes
 * ET, si une affectation nominative existe (assignedToId), seulement les
 * siennes — les autres membres du groupe ne voient pas une fiche affectée
 * nominativement à quelqu'un d'autre. Admin/approbateur voient tout.
 */
assignmentsRouter.get("/", async (req, res) => {
  const user = req.user!;
  const isAdmin = user.role === "administrateur" || user.role === "approbateur";

  const assignments = await prisma.assignment.findMany({
    where: isAdmin
      ? undefined
      : {
          groupId: { in: user.groupIds },
          OR: [{ assignedToId: null }, { assignedToId: user.id }],
        },
    include: {
      ...ASSIGNMENT_INCLUDE,
      inspections: {
        select: {
          id: true,
          status: true,
          _count: { select: { values: true } },
        },
        take: 1,
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });

  res.json({
    assignments: assignments.map((a) => ({
      id: a.id,
      formType: a.formType,
      group: a.group,
      assignedTo: a.assignedTo,
      zoneNotes: a.zoneNotes,
      year: a.year,
      bimonthlyPeriod: a.bimonthlyPeriod,
      weekNumber: a.weekNumber,
      dueDate: a.dueDate,
      inspection: a.inspections[0]
        ? {
            id: a.inspections[0].id,
            status: a.inspections[0].status,
            hasValues: a.inspections[0]._count.values > 0,
          }
        : null,
    })),
  });
});

function isoWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

const createAssignmentsBody = z.object({
  formTypeId: z.string().uuid(),
  zones: z.array(z.string().min(1)).min(1),
  assignedToId: z.string().uuid(),
  dueDate: z.string().min(1),
  notes: z.string().optional(),
});

/**
 * Création nominative : l'admin choisit une fiche, une ou plusieurs zones
 * et UN superviseur précis (pas un groupe entier). Le groupe est dérivé de
 * l'appartenance du superviseur (premier groupe trouvé) — reflète "l'admin
 * affecte à un superviseur de son choix". Réservé admin/approbateur.
 */
assignmentsRouter.post(
  "/",
  requireRole("administrateur", "approbateur"),
  async (req, res) => {
    const parsed = createAssignmentsBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(
        422,
        "invalid_body",
        "Corps de requête invalide.",
        parsed.error.flatten(),
      );
    }
    const { formTypeId, zones, assignedToId, dueDate, notes } = parsed.data;

    const formType = await prisma.formType.findUnique({
      where: { id: formTypeId },
    });
    if (!formType) throw new ApiError(404, "not_found", "Fiche introuvable.");

    const supervisor = await prisma.user.findUnique({
      where: { id: assignedToId },
    });
    if (!supervisor)
      throw new ApiError(404, "not_found", "Superviseur introuvable.");

    const membership = await prisma.userGroup.findFirst({
      where: { userId: assignedToId },
    });
    if (!membership) {
      throw new ApiError(
        422,
        "no_group",
        "Ce superviseur n'appartient à aucun groupe — affectez-le à un groupe avant de lui assigner une fiche.",
      );
    }

    const due = new Date(`${dueDate.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(due.getTime())) {
      throw new ApiError(422, "invalid_date", "Date limite invalide.");
    }
    const year = due.getUTCFullYear();
    const bimonthlyPeriod = Math.floor(due.getUTCMonth() / 2) + 1;
    const weekNumber = isoWeekNumber(due);

    const created = await prisma.$transaction(
      zones.map((zone) =>
        prisma.assignment.create({
          data: {
            formTypeId,
            groupId: membership.groupId,
            assignedToId,
            zoneNotes: notes ? `${zone} — ${notes}` : zone,
            year,
            bimonthlyPeriod,
            weekNumber,
            dueDate: due,
            createdById: req.user!.id,
          },
          include: ASSIGNMENT_INCLUDE,
        }),
      ),
    );

    res.status(201).json({ assignments: created });
  },
);

assignmentsRouter.delete(
  "/:id",
  requireRole("administrateur", "approbateur"),
  async (req, res) => {
    const assignment = await prisma.assignment.findUnique({
      where: { id: req.params.id },
    });
    if (!assignment)
      throw new ApiError(404, "not_found", "Assignation introuvable.");

    const inspection = await prisma.inspection.findFirst({
      where: { assignmentId: assignment.id },
    });
    if (inspection) {
      throw new ApiError(
        409,
        "has_inspection",
        "Impossible de supprimer : une inspection existe déjà pour cette assignation.",
      );
    }

    await prisma.assignment.delete({ where: { id: assignment.id } });
    res.status(204).end();
  },
);

/**
 * Création idempotente d'une inspection pour une assignation.
 */
assignmentsRouter.post("/:assignmentId/inspection", async (req, res) => {
  const assignment = await prisma.assignment.findUnique({
    where: { id: req.params.assignmentId },
  });
  if (!assignment)
    throw new ApiError(404, "not_found", "Assignation introuvable.");

  assertGroupAccess(req.user!, assignment.groupId);
  // Une affectation nominative est réservée à cette personne, même au sein
  // du groupe (sauf admin/approbateur, déjà couverts par assertGroupAccess).
  if (
    assignment.assignedToId &&
    assignment.assignedToId !== req.user!.id &&
    req.user!.role !== "administrateur" &&
    req.user!.role !== "approbateur"
  ) {
    throw new ApiError(
      403,
      "forbidden",
      "Cette fiche est affectée à un autre superviseur.",
    );
  }

  const existing = await prisma.inspection.findFirst({
    where: { assignmentId: assignment.id },
  });
  if (existing) return res.status(200).json(existing);

  try {
    const created = await prisma.inspection.create({
      data: {
        assignmentId: assignment.id,
        formTypeId: assignment.formTypeId,
        groupId: assignment.groupId,
        weekNumber: assignment.weekNumber,
        dueDate: assignment.dueDate,
      },
    });
    return res.status(201).json(created);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const raced = await prisma.inspection.findFirst({
        where: { assignmentId: assignment.id },
      });
      if (raced) return res.status(200).json(raced);
    }
    throw err;
  }
});

// ========= POST /:id/verify =========

/**
 * Validation admin : une fiche soumise devient "vérifiée". Réservé
 * admin/approbateur. Trace qui a vérifié et quand (déjà prévu au schéma).
 */
inspectionsRouter.post(
  "/:id/verify",
  requireRole("administrateur", "approbateur"),
  async (req, res) => {
    const inspection = await loadInspectionOrThrow(req.params.id);
    if (inspection.status !== "soumis") {
      throw new ApiError(
        409,
        "invalid_status",
        "Seule une fiche soumise peut être vérifiée.",
      );
    }
    const updated = await prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        status: "verifie",
        verifiedById: req.user!.id,
        verifiedAt: new Date(),
      },
    });
    res.json(updated);
  },
);

// ========= POST /:id/reject =========

const rejectBody = z.object({ reason: z.string().min(1) });

inspectionsRouter.post(
  "/:id/reject",
  requireRole("administrateur", "approbateur"),
  async (req, res) => {
    const inspection = await loadInspectionOrThrow(req.params.id);
    if (inspection.status !== "soumis") {
      throw new ApiError(
        409,
        "invalid_status",
        "Seule une fiche soumise peut être rejetée.",
      );
    }
    const parsed = rejectBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(422, "invalid_body", "Un motif de rejet est requis.");
    }
    const updated = await prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        status: "rejete",
        verifiedById: req.user!.id,
        verifiedAt: new Date(),
        rejectionReason: parsed.data.reason,
      },
    });
    res.json(updated);
  },
);
