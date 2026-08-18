import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAuth, assertGroupAccess } from "../middleware/auth";
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
