import { Router } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const evaluationsRouter = Router();

evaluationsRouter.use(requireAuth);

/**
 * Vérifie que l'utilisateur connecté est administrateur.
 */
function requireAdmin(req: any, res: any): boolean {
  const user = req.user;

  if (!user) {
    res.status(401).json({
      error: "Utilisateur non authentifié",
    });
    return false;
  }

  if (user.role !== "administrateur") {
    res.status(403).json({
      error: "Seul un administrateur peut effectuer cette action",
    });
    return false;
  }

  return true;
}

/**
 * GET /evaluations/supervisors
 *
 * Liste des superviseurs pouvant être évalués.
 */
evaluationsRouter.get("/supervisors", async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
      });
    }

    const supervisors = await prisma.user.findMany({
      where: {
        role: "superviseur",
        isActive: true,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        userGroups: {
          select: {
            group: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        displayName: "asc",
      },
    });

    return res.json(
      supervisors.map((supervisor) => ({
        id: supervisor.id,
        username: supervisor.username,
        displayName: supervisor.displayName,
        email: supervisor.email,
        groups: supervisor.userGroups.map((item) => item.group),
      })),
    );
  } catch (error) {
    console.error("GET /evaluations/supervisors:", error);

    return res.status(500).json({
      error: "Impossible de récupérer les superviseurs",
    });
  }
});

/**
 * GET /evaluations/summary
 *
 * Calcule les performances réelles d'un superviseur
 * pour une période donnée.
 *
 * Query :
 * supervisorId
 * year
 * bimester
 * groupId
 */
evaluationsRouter.get("/summary", async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
      });
    }

    const supervisorId =
      typeof req.query.supervisorId === "string"
        ? req.query.supervisorId
        : undefined;

    const year =
      typeof req.query.year === "string" ? Number(req.query.year) : undefined;

    const bimester =
      typeof req.query.bimester === "string"
        ? Number(req.query.bimester)
        : undefined;

    const groupId =
      typeof req.query.groupId === "string" && req.query.groupId !== "all"
        ? req.query.groupId
        : undefined;

    if (!supervisorId) {
      return res.status(400).json({
        error: "Le superviseur est obligatoire",
      });
    }

    if (!year || !Number.isInteger(year) || year < 2000) {
      return res.status(400).json({
        error: "Année invalide",
      });
    }

    if (
      !bimester ||
      !Number.isInteger(bimester) ||
      bimester < 1 ||
      bimester > 6
    ) {
      return res.status(400).json({
        error: "Bimestre invalide",
      });
    }

    /**
     * Vérifier que le superviseur existe.
     */
    const supervisor = await prisma.user.findFirst({
      where: {
        id: supervisorId,
        role: "superviseur",
        isActive: true,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        userGroups: {
          select: {
            group: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!supervisor) {
      return res.status(404).json({
        error: "Superviseur introuvable",
      });
    }

    const isGlobalRole =
      user.role === "administrateur" || user.role === "approbateur";

    /**
     * Contrôle d'accès aux groupes.
     */
    if (!isGlobalRole && groupId && !user.groupIds.includes(groupId)) {
      return res.status(403).json({
        error: "Vous n'avez pas accès à ce groupe",
      });
    }

    /**
     * Si un groupe est choisi, vérifier également
     * que le superviseur appartient à ce groupe.
     */
    if (
      groupId &&
      !supervisor.userGroups.some((item) => item.group.id === groupId)
    ) {
      return res.status(400).json({
        error: "Le superviseur n'appartient pas à ce groupe",
      });
    }

    /**
     * ---------------------------------------------------------
     * INSPECTIONS DU SUPERVISEUR
     * ---------------------------------------------------------
     *
     * La période métier vient de Assignment.
     */
    const inspectionWhere: Prisma.InspectionWhereInput = {
      submittedById: supervisorId,

      assignment: {
        year,
        bimonthlyPeriod: bimester,
      },

      ...(groupId
        ? {
            groupId,
          }
        : {}),

      ...(isGlobalRole
        ? {}
        : {
            groupId: {
              in: user.groupIds,
            },
          }),
    };

    /**
     * ---------------------------------------------------------
     * INSPECTIONS
     * ---------------------------------------------------------
     */

    const [
      totalInspections,
      submittedInspections,
      verifiedInspections,
      rejectedInspections,
    ] = await Promise.all([
      prisma.inspection.count({
        where: inspectionWhere,
      }),

      prisma.inspection.count({
        where: {
          ...inspectionWhere,
          status: "soumis",
        },
      }),

      prisma.inspection.count({
        where: {
          ...inspectionWhere,
          status: "verifie",
        },
      }),

      prisma.inspection.count({
        where: {
          ...inspectionWhere,
          status: "rejete",
        },
      }),
    ]);

    /**
     * ---------------------------------------------------------
     * ASSIGNMENTS
     * ---------------------------------------------------------
     *
     * On compte les tâches affectées au superviseur
     * pour la période.
     */
    const assignmentWhere: Prisma.AssignmentWhereInput = {
      assignedToId: supervisorId,
      year,
      bimonthlyPeriod: bimester,

      ...(groupId
        ? {
            groupId,
          }
        : {}),

      ...(isGlobalRole
        ? {}
        : {
            groupId: {
              in: user.groupIds,
            },
          }),
    };

    const assigned = await prisma.assignment.count({
      where: assignmentWhere,
    });

    /**
     * Tâches ayant une inspection soumise ou vérifiée.
     */
    const completedAssignments = await prisma.assignment.count({
      where: {
        ...assignmentWhere,
        inspections: {
          some: {
            submittedById: supervisorId,
            status: {
              in: ["soumis", "verifie"],
            },
          },
        },
      },
    });

    /**
     * Tâches en retard.
     */
    const overdue = await prisma.assignment.count({
      where: {
        ...assignmentWhere,

        dueDate: {
          lt: new Date(),
        },

        inspections: {
          none: {
            submittedById: supervisorId,
            status: {
              in: ["soumis", "verifie"],
            },
          },
        },
      },
    });

    /**
     * ---------------------------------------------------------
     * TAUX DE PERFORMANCE
     * ---------------------------------------------------------
     */

    const completionRate =
      assigned > 0
        ? Number(((completedAssignments / assigned) * 100).toFixed(2))
        : 0;

    const verificationRate =
      totalInspections > 0
        ? Number(((verifiedInspections / totalInspections) * 100).toFixed(2))
        : 0;

    /**
     * ---------------------------------------------------------
     * RÉSULTATS DES INSPECTIONS
     * ---------------------------------------------------------
     *
     * Pour une évaluation professionnelle, on se base
     * sur les inspections vérifiées.
     */
    const findingWhere: Prisma.InspectionValueWhereInput = {
      inspection: {
        ...inspectionWhere,
        status: "verifie",
      },
    };

    const findingGroups = await prisma.inspectionValue.groupBy({
      by: ["state"],
      where: findingWhere,
      _count: {
        _all: true,
      },
    });

    const findings = {
      ras: 0,
      yes: 0,
      na: 0,
      minor: 0,
      major: 0,
      nonInspected: 0,
    };

    for (const item of findingGroups) {
      switch (item.state) {
        case "ras":
          findings.ras = item._count._all;
          break;

        case "yes":
          findings.yes = item._count._all;
          break;

        case "na":
          findings.na = item._count._all;
          break;

        case "minor":
          findings.minor = item._count._all;
          break;

        case "major":
          findings.major = item._count._all;
          break;

        case "non_inspecte":
          findings.nonInspected = item._count._all;
          break;
      }
    }

    /**
     * ---------------------------------------------------------
     * TAUX DE CONFORMITÉ
     * ---------------------------------------------------------
     *
     * Conforme :
     *   RAS
     *   YES
     *   NA
     *
     * Non conforme :
     *   MINOR
     *   MAJOR
     *
     * NON_INSPECTE n'entre pas dans le calcul.
     */
    const evaluableFindings =
      findings.ras +
      findings.yes +
      findings.na +
      findings.minor +
      findings.major;

    const compliantFindings = findings.ras + findings.yes + findings.na;

    const complianceRate =
      evaluableFindings > 0
        ? Number(((compliantFindings / evaluableFindings) * 100).toFixed(2))
        : 0;

    /**
     * ---------------------------------------------------------
     * RÉPONSE
     * ---------------------------------------------------------
     */

    return res.json({
      supervisor: {
        id: supervisor.id,
        username: supervisor.username,
        displayName: supervisor.displayName,
        email: supervisor.email,
        groups: supervisor.userGroups.map((item) => item.group),
      },

      period: {
        year,
        bimester,
      },

      performance: {
        assigned,
        completed: completedAssignments,
        totalInspections,
        submitted: submittedInspections,
        verified: verifiedInspections,
        rejected: rejectedInspections,
        overdue,
        completionRate,
        verificationRate,
        complianceRate,
      },

      findings: {
        ...findings,
        evaluable: evaluableFindings,
        compliant: compliantFindings,
      },
    });
  } catch (error) {
    console.error("GET /evaluations/summary:", error);

    return res.status(500).json({
      error: "Impossible de calculer les performances du superviseur",
    });
  }
});

/**
 * POST /evaluations
 *
 * Création d'une évaluation par un administrateur.
 */
evaluationsRouter.post("/", async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const user = req.user!;

    const {
      supervisorId,
      year,
      bimonthlyPeriod,
      groupId,

      respectDelais,
      qualiteInspections,
      qualiteObservations,
      suiviAnomalies,
      respectProcedures,
      reactivite,
      autonomie,

      strengths,
      weaknesses,
      recommendations,
      comment,
    } = req.body;

    /**
     * Validation principale.
     */
    if (!supervisorId) {
      return res.status(400).json({
        error: "Le superviseur est obligatoire",
      });
    }

    if (!Number.isInteger(year) || year < 2000) {
      return res.status(400).json({
        error: "Année invalide",
      });
    }

    if (
      !Number.isInteger(bimonthlyPeriod) ||
      bimonthlyPeriod < 1 ||
      bimonthlyPeriod > 6
    ) {
      return res.status(400).json({
        error: "Bimestre invalide",
      });
    }

    /**
     * Vérification des notes.
     */
    const scores = [
      respectDelais,
      qualiteInspections,
      qualiteObservations,
      suiviAnomalies,
      respectProcedures,
      reactivite,
      autonomie,
    ];

    for (const score of scores) {
      if (
        score !== undefined &&
        score !== null &&
        (!Number.isInteger(score) || score < 1 || score > 5)
      ) {
        return res.status(400).json({
          error: "Chaque note doit être comprise entre 1 et 5",
        });
      }
    }

    /**
     * Vérifier le superviseur.
     */
    const supervisor = await prisma.user.findFirst({
      where: {
        id: supervisorId,
        role: "superviseur",
        isActive: true,
      },
    });

    if (!supervisor) {
      return res.status(404).json({
        error: "Superviseur introuvable",
      });
    }

    /**
     * Vérifier le groupe si fourni.
     */
    if (groupId) {
      //   if (!user.groupIds.includes(groupId)) {
      //     return res.status(403).json({
      //       error: "Vous n'avez pas accès à ce groupe",
      //     });
      //   }
      const isGlobalRole =
        user.role === "administrateur" || user.role === "approbateur";

      if (groupId && !isGlobalRole && !user.groupIds.includes(groupId)) {
        return res.status(403).json({
          error: "Accès au groupe refusé",
        });
      }

      const membership = await prisma.userGroup.findFirst({
        where: {
          userId: supervisorId,
          groupId,
        },
      });

      if (!membership) {
        return res.status(400).json({
          error: "Le superviseur n'appartient pas à ce groupe",
        });
      }
    }

    /**
     * Empêcher deux évaluations identiques.
     */
    const existing = await prisma.evaluation.findFirst({
      where: {
        supervisorId,
        year,
        bimonthlyPeriod,
        groupId: groupId ?? null,
      },
    });

    if (existing) {
      return res.status(409).json({
        error:
          "Une évaluation existe déjà pour ce superviseur et cette période",
        evaluationId: existing.id,
      });
    }

    const evaluation = await prisma.evaluation.create({
      data: {
        supervisorId,
        createdById: user.id,
        year,
        bimonthlyPeriod,
        groupId: groupId ?? null,

        respectDelais: respectDelais ?? null,
        qualiteInspections: qualiteInspections ?? null,
        qualiteObservations: qualiteObservations ?? null,
        suiviAnomalies: suiviAnomalies ?? null,
        respectProcedures: respectProcedures ?? null,
        reactivite: reactivite ?? null,
        autonomie: autonomie ?? null,

        strengths: strengths ?? null,
        weaknesses: weaknesses ?? null,
        recommendations: recommendations ?? null,
        comment: comment ?? null,
      },

      include: {
        supervisor: {
          select: {
            id: true,
            displayName: true,
          },
        },

        createdBy: {
          select: {
            id: true,
            displayName: true,
          },
        },

        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return res.status(201).json(evaluation);
  } catch (error) {
    console.error("POST /evaluations:", error);

    return res.status(500).json({
      error: "Impossible d'enregistrer l'évaluation",
    });
  }
});

evaluationsRouter.get("/my", requireAuth, async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== "superviseur") {
      return res.status(403).json({
        error: "Cette route est réservée aux superviseurs.",
      });
    }

    const evaluation = await prisma.evaluation.findFirst({
      where: {
        supervisorId: user.id,
      },
      orderBy: [
        { year: "desc" },
        { bimonthlyPeriod: "desc" },
        { createdAt: "desc" },
      ],
      include: {
        supervisor: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            displayName: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return res.json(evaluation);
  } catch (error) {
    console.error("GET /evaluations/my error:", error);

    return res.status(500).json({
      error: "Impossible de récupérer votre évaluation.",
    });
  }
});

evaluationsRouter.patch("/:id", async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== "administrateur") {
      return res.status(403).json({
        error: "Seul un administrateur peut modifier une évaluation.",
      });
    }

    const { id } = req.params;

    const existing = await prisma.evaluation.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        error: "Évaluation introuvable.",
      });
    }

    const {
      respectDelais,
      qualiteInspections,
      qualiteObservations,
      suiviAnomalies,
      respectProcedures,
      reactivite,
      autonomie,
      strengths,
      weaknesses,
      recommendations,
      comment,
      groupId,
      year,
      bimonthlyPeriod,
    } = req.body;

    const scores = {
      respectDelais,
      qualiteInspections,
      qualiteObservations,
      suiviAnomalies,
      respectProcedures,
      reactivite,
      autonomie,
    };

    for (const [key, value] of Object.entries(scores)) {
      if (
        value !== undefined &&
        value !== null &&
        (!Number.isInteger(value) || value < 1 || value > 5)
      ) {
        return res.status(400).json({
          error: `La note ${key} doit être comprise entre 1 et 5.`,
        });
      }
    }

    if (
      year !== undefined &&
      (!Number.isInteger(year) || year < 2000 || year > 2100)
    ) {
      return res.status(400).json({
        error: "Année invalide.",
      });
    }

    if (
      bimonthlyPeriod !== undefined &&
      (!Number.isInteger(bimonthlyPeriod) ||
        bimonthlyPeriod < 1 ||
        bimonthlyPeriod > 6)
    ) {
      return res.status(400).json({
        error: "Bimestre invalide.",
      });
    }

    if (groupId) {
      const group = await prisma.group.findUnique({
        where: { id: groupId },
      });

      if (!group) {
        return res.status(400).json({
          error: "Groupe introuvable.",
        });
      }
    }

    const updated = await prisma.evaluation.update({
      where: { id },

      data: {
        ...(year !== undefined ? { year } : {}),
        ...(bimonthlyPeriod !== undefined ? { bimonthlyPeriod } : {}),
        ...(groupId !== undefined ? { groupId: groupId || null } : {}),

        ...(respectDelais !== undefined ? { respectDelais } : {}),
        ...(qualiteInspections !== undefined ? { qualiteInspections } : {}),
        ...(qualiteObservations !== undefined ? { qualiteObservations } : {}),
        ...(suiviAnomalies !== undefined ? { suiviAnomalies } : {}),
        ...(respectProcedures !== undefined ? { respectProcedures } : {}),
        ...(reactivite !== undefined ? { reactivite } : {}),
        ...(autonomie !== undefined ? { autonomie } : {}),

        ...(strengths !== undefined ? { strengths: strengths || null } : {}),
        ...(weaknesses !== undefined ? { weaknesses: weaknesses || null } : {}),
        ...(recommendations !== undefined
          ? { recommendations: recommendations || null }
          : {}),
        ...(comment !== undefined ? { comment: comment || null } : {}),
      },

      include: {
        supervisor: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            displayName: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("PATCH /evaluations/:id", error);

    return res.status(500).json({
      error: "Impossible de modifier l'évaluation.",
    });
  }
});

/**
 * GET /evaluations
 *
 * Historique des évaluations.
 */
evaluationsRouter.get("/", async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
      });
    }

    const isGlobalRole =
      user.role === "administrateur" || user.role === "approbateur";

    const evaluations = await prisma.evaluation.findMany({
      where: isGlobalRole
        ? undefined
        : {
            groupId: {
              in: user.groupIds,
            },
          },

      orderBy: [
        {
          year: "desc",
        },
        {
          bimonthlyPeriod: "desc",
        },
        {
          createdAt: "desc",
        },
      ],

      include: {
        supervisor: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },

        createdBy: {
          select: {
            id: true,
            displayName: true,
          },
        },

        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return res.json(evaluations);
  } catch (error) {
    console.error("GET /evaluations:", error);

    return res.status(500).json({
      error: "Impossible de récupérer les évaluations",
    });
  }
});

/**
 * GET /evaluations/:id
 */
evaluationsRouter.get("/:id", async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
      });
    }

    const evaluation = await prisma.evaluation.findUnique({
      where: {
        id: req.params.id,
      },

      include: {
        supervisor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            email: true,
          },
        },

        createdBy: {
          select: {
            id: true,
            displayName: true,
          },
        },

        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!evaluation) {
      return res.status(404).json({
        error: "Évaluation introuvable",
      });
    }

    /**
     * Un superviseur ne peut consulter que
     * ses propres évaluations.
     */
    if (user.role === "superviseur" && evaluation.supervisorId !== user.id) {
      return res.status(403).json({
        error: "Accès refusé",
      });
    }

    if (
      user.role === "superviseur" &&
      evaluation.groupId &&
      !user.groupIds.includes(evaluation.groupId)
    ) {
      return res.status(403).json({
        error: "Accès refusé",
      });
    }

    return res.json(evaluation);
  } catch (error) {
    console.error("GET /evaluations/:id:", error);

    return res.status(500).json({
      error: "Impossible de récupérer l'évaluation",
    });
  }
});
