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

export const assignmentsRouter = Router();

assignmentsRouter.use(requireAuth);

/**
 * Liste des assignations pour l'écran "mes tâches" — non listée dans Epic 3
 * (qui ne couvrait que la création d'inspection) mais nécessaire pour migrer
 * supervisor.tasks.tsx. Lecture pure ; un superviseur ne voit que ses
 * groupes, administrateur/approbateur voient tout (mêmes règles que
 * assertGroupAccess, appliquées ici en filtre plutôt qu'en rejet 403).
 */
assignmentsRouter.get("/", async (req, res) => {
  const user = req.user!;
  const groupFilter =
    user.role === "administrateur" || user.role === "approbateur"
      ? undefined
      : user.groupIds;

  const assignments = await prisma.assignment.findMany({
    where: groupFilter ? { groupId: { in: groupFilter } } : undefined,
    include: {
      formType: { select: { id: true, code: true, name: true, module: true } },
      group: { select: { id: true, name: true } },
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

/**
 * Numéro de semaine ISO-8601 — reproduit côté serveur le calcul jusqu'ici
 * fait uniquement côté front (mock-data.ts) pour l'affichage.
 */
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
  groupIds: z.array(z.string().uuid()).min(1),
  dueDate: z.string().min(1),
  notes: z.string().optional(),
});

/**
 * Création en lot : une assignation par combinaison zone × groupe —
 * reproduit le comportement de l'ancien écran de planification
 * ("assignation individuelle ou en lot"). Réservé admin/approbateur.
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
    const { formTypeId, zones, groupIds, dueDate, notes } = parsed.data;

    const formType = await prisma.formType.findUnique({
      where: { id: formTypeId },
    });
    if (!formType) throw new ApiError(404, "not_found", "Fiche introuvable.");

    const groups = await prisma.group.findMany({
      where: { id: { in: groupIds } },
    });
    if (groups.length !== groupIds.length) {
      throw new ApiError(
        404,
        "not_found",
        "Un ou plusieurs groupes sont introuvables.",
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
      zones.flatMap((zone) =>
        groupIds.map((groupId) =>
          prisma.assignment.create({
            data: {
              formTypeId,
              groupId,
              zoneNotes: notes ? `${zone} — ${notes}` : zone,
              year,
              bimonthlyPeriod,
              weekNumber,
              dueDate: due,
              createdById: req.user!.id,
            },
            include: {
              formType: {
                select: { id: true, code: true, name: true, module: true },
              },
              group: { select: { id: true, name: true } },
            },
          }),
        ),
      ),
    );

    res.status(201).json({ assignments: created });
  },
);

/**
 * Suppression d'une assignation. Bloquée si une inspection y est déjà liée
 * (FK RESTRICT côté base — on transforme l'erreur brute en 409 explicite
 * plutôt que de laisser remonter une 500).
 */
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
 * Si l'inspection existe déjà (reprise de brouillon après reconnexion, retry
 * réseau côté PWA...), elle est retournée telle quelle (200) plutôt que
 * dupliquée. L'unicité est garantie côté base par l'index partiel
 * idx_inspections_assignment_unique (assignment_id) — le catch P2002 gère
 * la course entre le SELECT et l'INSERT.
 */
assignmentsRouter.post("/:assignmentId/inspection", async (req, res) => {
  const assignment = await prisma.assignment.findUnique({
    where: { id: req.params.assignmentId },
  });
  if (!assignment)
    throw new ApiError(404, "not_found", "Assignation introuvable.");

  assertGroupAccess(req.user!, assignment.groupId);

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
