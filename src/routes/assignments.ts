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
 * Liste des assignations pour l'écran "mes tâches".
 *
 * - Administrateur / approbateur : voient toutes les assignations.
 * - Superviseur : voit uniquement les assignations de ses groupes.
 *
 * L'assignation contient également le superviseur auquel elle
 * est nominativement affectée.
 */
assignmentsRouter.get("/", async (req, res) => {
  const user = req.user!;

  const groupFilter =
    user.role === "administrateur" || user.role === "approbateur"
      ? undefined
      : user.groupIds;

  const assignments = await prisma.assignment.findMany({
    where: groupFilter
      ? {
          groupId: {
            in: groupFilter,
          },
        }
      : undefined,

    include: {
      formType: {
        select: {
          id: true,
          code: true,
          name: true,
          module: true,
        },
      },

      group: {
        select: {
          id: true,
          name: true,
        },
      },

      assignedTo: {
        select: {
          id: true,
          displayName: true,
        },
      },

      inspections: {
        select: {
          id: true,
          status: true,
          _count: {
            select: {
              values: true,
            },
          },
        },
        take: 1,
      },
    },

    orderBy: [
      {
        dueDate: "asc",
      },
      {
        createdAt: "desc",
      },
    ],
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

/**
 * Numéro de semaine ISO-8601.
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

/**
 * Corps attendu pour la création d'une assignation.
 *
 * Une fiche est créée par zone et affectée à un superviseur précis.
 */
const createAssignmentsBody = z.object({
  formTypeId: z.string().uuid(),
  zones: z.array(z.string().min(1)).min(1),
  assignedToId: z.string().uuid(),
  dueDate: z.string().min(1),
  notes: z.string().optional(),
});

/**
 * Création en lot :
 *
 * Une assignation est créée pour chaque zone.
 *
 * L'assignation est affectée nominativement au superviseur choisi.
 * Le groupId est récupéré automatiquement depuis le groupe du superviseur.
 *
 * Réservé administrateur / approbateur.
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

    /**
     * Vérification du formulaire.
     */
    const formType = await prisma.formType.findUnique({
      where: {
        id: formTypeId,
      },
    });

    if (!formType) {
      throw new ApiError(404, "not_found", "Fiche introuvable.");
    }

    /**
     * Récupération du superviseur et de ses groupes.
     */
    const supervisor = await prisma.user.findUnique({
      where: {
        id: assignedToId,
      },

      include: {
        userGroups: {
          select: {
            groupId: true,
          },
        },
      },
    });

    if (!supervisor) {
      throw new ApiError(404, "not_found", "Superviseur introuvable.");
    }

    /**
     * L'utilisateur sélectionné doit être un superviseur.
     */
    if (supervisor.role !== "superviseur") {
      throw new ApiError(
        422,
        "invalid_supervisor",
        "L'utilisateur sélectionné n'est pas un superviseur.",
      );
    }

    /**
     * Le superviseur doit appartenir à au moins un groupe.
     *
     * Assignment.groupId est obligatoire dans le schéma Prisma,
     * donc nous devons déterminer le groupe à utiliser.
     */
    if (supervisor.userGroups.length === 0) {
      throw new ApiError(
        422,
        "no_group",
        "Ce superviseur n'est associé à aucun groupe.",
      );
    }

    /**
     * Pour le fonctionnement actuel, on utilise le premier groupe
     * auquel le superviseur est rattaché.
     *
     * Si un superviseur peut appartenir à plusieurs groupes et que
     * l'utilisateur doit pouvoir choisir le groupe, il faudra
     * ajouter cette sélection au Front.
     */
    const groupId = supervisor.userGroups[0].groupId;

    /**
     * Validation de la date.
     */
    const due = new Date(`${dueDate.slice(0, 10)}T00:00:00Z`);

    if (Number.isNaN(due.getTime())) {
      throw new ApiError(422, "invalid_date", "Date limite invalide.");
    }

    const year = due.getUTCFullYear();

    const bimonthlyPeriod = Math.floor(due.getUTCMonth() / 2) + 1;

    const weekNumber = isoWeekNumber(due);

    /**
     * Création d'une assignation par zone.
     */
    const created = await prisma.$transaction(
      zones.map((zone) =>
        prisma.assignment.create({
          data: {
            formTypeId,

            groupId,

            assignedToId,

            zoneNotes: notes ? `${zone} — ${notes}` : zone,

            year,

            bimonthlyPeriod,

            weekNumber,

            dueDate: due,

            createdById: req.user!.id,
          },

          include: {
            formType: {
              select: {
                id: true,
                code: true,
                name: true,
                module: true,
              },
            },

            group: {
              select: {
                id: true,
                name: true,
              },
            },

            assignedTo: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        }),
      ),
    );

    res.status(201).json({
      assignments: created,
    });
  },
);

/**
 * Suppression d'une assignation.
 *
 * Bloquée si une inspection existe déjà.
 */
assignmentsRouter.delete(
  "/:id",
  requireRole("administrateur", "approbateur"),
  async (req, res) => {
    const assignment = await prisma.assignment.findUnique({
      where: {
        id: req.params.id,
      },
    });

    if (!assignment) {
      throw new ApiError(404, "not_found", "Assignation introuvable.");
    }

    const inspection = await prisma.inspection.findFirst({
      where: {
        assignmentId: assignment.id,
      },
    });

    if (inspection) {
      throw new ApiError(
        409,
        "has_inspection",
        "Impossible de supprimer : une inspection existe déjà pour cette assignation.",
      );
    }

    await prisma.assignment.delete({
      where: {
        id: assignment.id,
      },
    });

    res.status(204).end();
  },
);

/**
 * Création idempotente d'une inspection pour une assignation.
 *
 * Si l'inspection existe déjà, elle est retournée telle quelle.
 */
assignmentsRouter.post("/:assignmentId/inspection", async (req, res) => {
  const assignment = await prisma.assignment.findUnique({
    where: {
      id: req.params.assignmentId,
    },
  });

  if (!assignment) {
    throw new ApiError(404, "not_found", "Assignation introuvable.");
  }

  /**
   * Vérification de l'accès au groupe.
   */
  assertGroupAccess(req.user!, assignment.groupId);

  /**
   * Vérifier si une inspection existe déjà.
   */
  const existing = await prisma.inspection.findFirst({
    where: {
      assignmentId: assignment.id,
    },
  });

  if (existing) {
    return res.status(200).json(existing);
  }

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
    /**
     * Gestion d'une éventuelle création concurrente.
     */
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const raced = await prisma.inspection.findFirst({
        where: {
          assignmentId: assignment.id,
        },
      });

      if (raced) {
        return res.status(200).json(raced);
      }
    }

    throw err;
  }
});
