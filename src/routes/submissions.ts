import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { isImageDataUrl, savePhotoFromDataUrl, type StoredPhoto } from "../lib/photo-storage";

export const submissionsRouter = Router();

submissionsRouter.use(requireAuth);

const defectSchema = z
  .object({
    segment: z.string().optional(),
    category: z.string().optional(),
    zone: z.string().optional(),
    point: z.string().optional(),
    item: z.string().optional(),
    severity: z.enum(["minor", "major", "yes"]).nullable().optional(),
    qualitatif: z.string().optional(),
    comment: z.string().optional(),
    localisation: z.string().optional(),
    action: z.string().optional(),
    actionCorrective: z.string().optional(),
    photos: z.array(z.string()).optional(),
  })
  .passthrough();

const submissionSchema = z.object({
  taskId: z.string().min(1),
  form: z.string().min(1),
  zone: z.string().optional(),
  notes: z.string().optional(),
  group: z.string().optional(),
  attestedSegments: z.array(z.string()).optional(),
  sector: z.string().nullable().optional(),
  compliance: z.string().nullable().optional(),
  defects: z.array(defectSchema).default([]),
  comment: z.string().default(""),
  // submittedBy / submittedAt reçus du client sont volontairement ignorés
  // (voir plus bas) — l'AC "date/heure serveur fiables" (sprint 12) et
  // l'auteur = utilisateur connecté sont maintenant garantis côté serveur,
  // plus par le client.
  modelVersion: z.record(z.number()).default({}),
});

/**
 * POST /submissions — remplace enqueueSubmission("/api/public/inspections"
 * | "/api/public/building-inspections", ...) côté frontend.
 *
 * - Décode et stocke chaque photo (data URL) via photo-storage.ts, et
 *   remplace les data URLs par de vraies URLs stables dans les constats
 *   enregistrés (sprint "stockage objets fiable").
 * - `submittedBy` = utilisateur authentifié (jamais la valeur envoyée par le
 *   client), `submittedAt` = horloge serveur (jamais celle du client) —
 *   résout enfin la limite documentée côté frontend (task-status.ts).
 * - Fait passer la tâche liée en statut "pending" (Not Submitted/En cours →
 *   En attente de vérification).
 */
submissionsRouter.post("/", async (req, res) => {
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const body = parsed.data;

  const task = await prisma.task.findUnique({ where: { id: body.taskId } });
  if (!task) return res.status(404).json({ error: "task_not_found" });
  if (req.user!.role === "supervisor" && !req.user!.groups.includes(task.group)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const photoRecords: (StoredPhoto & { constatKey: string })[] = [];

  const defects = await Promise.all(
    body.defects.map(async (d, i) => {
      const constatKey = d.point ?? d.item ?? `constat-${i}`;
      const resolvedPhotos: string[] = [];
      for (const p of d.photos ?? []) {
        if (isImageDataUrl(p)) {
          const stored = await savePhotoFromDataUrl(p);
          photoRecords.push({ constatKey, ...stored });
          resolvedPhotos.push(stored.url);
        } else if (p.length) {
          // Déjà une URL stable (ex. re-soumission) — on la garde telle quelle.
          resolvedPhotos.push(p);
        }
      }
      return { ...d, photos: resolvedPhotos };
    }),
  );

  const submission = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.submission.create({
      data: {
        taskId: task.id,
        kind: task.kind,
        form: body.form,
        zone: body.zone ?? task.zone,
        notes: body.notes ?? task.notes,
        group: body.group ?? task.group,
        sector: body.sector ?? null,
        compliance: body.compliance ?? null,
        comment: body.comment,
        defects,
        modelVersion: body.modelVersion,
        submittedById: req.user!.id,
        submittedAt: new Date(),
      },
    });
    if (photoRecords.length) {
      await tx.photo.createMany({
        data: photoRecords.map((p) => ({ submissionId: created.id, ...p })),
      });
    }
    await tx.task.update({ where: { id: task.id }, data: { status: "pending" } });
    return created;
  });

  res.status(201).json({ submission });
});

/** GET /submissions?taskId=... — historique des soumissions d'une tâche, photos incluses. */
submissionsRouter.get("/", async (req, res) => {
  const taskId = req.query.taskId as string | undefined;
  if (!taskId) return res.status(400).json({ error: "missing_task_id" });

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return res.status(404).json({ error: "task_not_found" });
  if (req.user!.role === "supervisor" && !req.user!.groups.includes(task.group)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const submissions = await prisma.submission.findMany({
    where: { taskId },
    include: { photos: true, submittedBy: { select: { id: true, name: true } } },
    orderBy: { submittedAt: "desc" },
  });
  res.json({ submissions });
});

/** GET /submissions/:id — détail d'une soumission (pour export PDF / galerie). */
submissionsRouter.get("/:id", async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.id },
    include: { photos: true, submittedBy: { select: { id: true, name: true } }, task: true },
  });
  if (!submission) return res.status(404).json({ error: "not_found" });
  if (req.user!.role === "supervisor" && !req.user!.groups.includes(submission.task.group)) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json({ submission });
});
