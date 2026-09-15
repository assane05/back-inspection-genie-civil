import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/stats", async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
      });
    }

    const isGlobalRole =
      user.role === "administrateur" || user.role === "approbateur";

    const yearParam =
      typeof req.query.year === "string" && req.query.year !== "all"
        ? Number(req.query.year)
        : undefined;

    const bimesterParam =
      typeof req.query.bimester === "string" && req.query.bimester !== "all"
        ? Number(req.query.bimester)
        : undefined;

    const groupParam =
      typeof req.query.group === "string" && req.query.group !== "all"
        ? req.query.group
        : undefined;

    const formTypeIdParam =
      typeof req.query.formTypeId === "string" && req.query.formTypeId !== "all"
        ? req.query.formTypeId
        : undefined;

    /* ---------------------------------------------------------
       VALIDATION DES FILTRES
    --------------------------------------------------------- */

    if (
      yearParam !== undefined &&
      (!Number.isInteger(yearParam) || yearParam < 2000)
    ) {
      return res.status(400).json({
        error: "Année invalide",
      });
    }

    if (
      bimesterParam !== undefined &&
      (!Number.isInteger(bimesterParam) ||
        bimesterParam < 1 ||
        bimesterParam > 6)
    ) {
      return res.status(400).json({
        error: "Bimestre invalide",
      });
    }

    /* ---------------------------------------------------------
       ACCÈS AUX GROUPES
    --------------------------------------------------------- */

    const accessibleGroupIds = isGlobalRole ? undefined : user.groupIds;

    if (!isGlobalRole && groupParam && !user.groupIds.includes(groupParam)) {
      return res.status(403).json({
        error: "Vous n'avez pas accès à ce groupe",
      });
    }

    /* ---------------------------------------------------------
       FILTRE CENTRAL DES INSPECTIONS
    --------------------------------------------------------- */

    const inspectionWhere: Prisma.InspectionWhereInput = {
      ...(accessibleGroupIds
        ? {
            groupId: {
              in: accessibleGroupIds,
            },
          }
        : {}),

      ...(groupParam
        ? {
            groupId: groupParam,
          }
        : {}),

      ...(formTypeIdParam
        ? {
            formTypeId: formTypeIdParam,
          }
        : {}),

      ...(yearParam !== undefined
        ? {
            assignment: {
              year: yearParam,
              ...(bimesterParam !== undefined
                ? {
                    bimonthlyPeriod: bimesterParam,
                  }
                : {}),
            },
          }
        : bimesterParam !== undefined
          ? {
              assignment: {
                bimonthlyPeriod: bimesterParam,
              },
            }
          : {}),
    };

    /*
     * Si année/bimestre sont sélectionnés, ils sont basés
     * sur l'Assignment lié à l'inspection.
     *
     * C'est préférable à createdAt car le dashboard travaille
     * avec les périodes métier des fiches.
     */

    /* ---------------------------------------------------------
       FILTRE DES ASSIGNMENTS / TÂCHES
    --------------------------------------------------------- */

    const assignmentWhere: Prisma.AssignmentWhereInput = {
      ...(accessibleGroupIds
        ? {
            groupId: {
              in: accessibleGroupIds,
            },
          }
        : {}),

      ...(groupParam
        ? {
            groupId: groupParam,
          }
        : {}),

      ...(formTypeIdParam
        ? {
            formTypeId: formTypeIdParam,
          }
        : {}),

      ...(yearParam !== undefined
        ? {
            year: yearParam,
          }
        : {}),

      ...(bimesterParam !== undefined
        ? {
            bimonthlyPeriod: bimesterParam,
          }
        : {}),
    };

    /* ---------------------------------------------------------
       KPI INSPECTIONS
    --------------------------------------------------------- */

    const [totalForms, submittedForms, verifiedForms, rejectedForms] =
      await Promise.all([
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

    const verifiedPct =
      totalForms > 0
        ? Number(((verifiedForms / totalForms) * 100).toFixed(2))
        : 0;

    /* ---------------------------------------------------------
       KPI TÂCHES
    --------------------------------------------------------- */

    const totalTasks = await prisma.assignment.count({
      where: assignmentWhere,
    });

    const submittedTasks = await prisma.assignment.count({
      where: {
        ...assignmentWhere,
        inspections: {
          some: {
            status: {
              in: ["soumis", "verifie"],
            },

            ...(groupParam
              ? {
                  groupId: groupParam,
                }
              : {}),

            ...(formTypeIdParam
              ? {
                  formTypeId: formTypeIdParam,
                }
              : {}),
          },
        },
      },
    });

    const overdueTasks = await prisma.assignment.count({
      where: {
        ...assignmentWhere,

        dueDate: {
          lt: new Date(),
        },

        inspections: {
          none: {
            status: {
              in: ["soumis", "verifie"],
            },
          },
        },
      },
    });

    const submittedPct =
      totalTasks > 0
        ? Number(((submittedTasks / totalTasks) * 100).toFixed(2))
        : 0;

    /* ---------------------------------------------------------
       RÉPARTITION DES STATUTS
    --------------------------------------------------------- */

    const statusGroups = await prisma.inspection.groupBy({
      by: ["status"],
      where: inspectionWhere,
      _count: {
        _all: true,
      },
    });

    const byStatus = [
      {
        status: "non_soumis",
        name: "Non soumises",
        count: 0,
      },
      {
        status: "soumis",
        name: "Soumises",
        count: 0,
      },
      {
        status: "verifie",
        name: "Vérifiées",
        count: 0,
      },
      {
        status: "rejete",
        name: "Rejetées",
        count: 0,
      },
    ];

    for (const item of statusGroups) {
      const target = byStatus.find((status) => status.status === item.status);

      if (target) {
        target.count = item._count._all;
      }
    }

    /* ---------------------------------------------------------
       RÉPARTITION DES GROUPES
    --------------------------------------------------------- */

    const groupCounts = await prisma.inspection.groupBy({
      by: ["groupId"],
      where: inspectionWhere,
      _count: {
        _all: true,
      },
    });

    const groups = await prisma.group.findMany({
      where: isGlobalRole
        ? undefined
        : {
            id: {
              in: user.groupIds,
            },
          },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    const groupMap = new Map(groups.map((group) => [group.id, group.name]));

    const byGroup = groupCounts.map((item) => ({
      group: groupMap.get(item.groupId) ?? "Groupe inconnu",
      count: item._count._all,
    }));

    /* ---------------------------------------------------------
       ÉVOLUTION
    --------------------------------------------------------- */

    const trendInspections = await prisma.inspection.findMany({
      where: inspectionWhere,
      select: {
        status: true,
        submittedAt: true,
        verifiedAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const trendMap = new Map<
      string,
      {
        submitted: number;
        verified: number;
        rejected: number;
      }
    >();

    for (const inspection of trendInspections) {
      if (inspection.submittedAt) {
        const date = inspection.submittedAt;

        const year = date.getFullYear();
        const startOfYear = new Date(year, 0, 1);

        const diff = date.getTime() - startOfYear.getTime();

        const weekNumber = Math.ceil(
          (diff / 86400000 + startOfYear.getDay() + 1) / 7,
        );

        const week = `S${String(weekNumber).padStart(2, "0")}`;

        if (!trendMap.has(week)) {
          trendMap.set(week, {
            submitted: 0,
            verified: 0,
            rejected: 0,
          });
        }

        trendMap.get(week)!.submitted++;
      }

      if (inspection.verifiedAt) {
        const date = inspection.verifiedAt;

        const year = date.getFullYear();
        const startOfYear = new Date(year, 0, 1);

        const diff = date.getTime() - startOfYear.getTime();

        const weekNumber = Math.ceil(
          (diff / 86400000 + startOfYear.getDay() + 1) / 7,
        );

        const week = `S${String(weekNumber).padStart(2, "0")}`;

        if (!trendMap.has(week)) {
          trendMap.set(week, {
            submitted: 0,
            verified: 0,
            rejected: 0,
          });
        }

        trendMap.get(week)!.verified++;
      }

      if (inspection.status === "rejete") {
        const date = inspection.submittedAt ?? new Date();

        const year = date.getFullYear();
        const startOfYear = new Date(year, 0, 1);

        const diff = date.getTime() - startOfYear.getTime();

        const weekNumber = Math.ceil(
          (diff / 86400000 + startOfYear.getDay() + 1) / 7,
        );

        const week = `S${String(weekNumber).padStart(2, "0")}`;

        if (!trendMap.has(week)) {
          trendMap.set(week, {
            submitted: 0,
            verified: 0,
            rejected: 0,
          });
        }

        trendMap.get(week)!.rejected++;
      }
    }

    const trend = Array.from(trendMap.entries()).map(([week, values]) => ({
      week,
      submitted: values.submitted,
      verified: values.verified,
      rejected: values.rejected,
    }));

    /* ---------------------------------------------------------
       RÉPARTITION DES ASSIGNMENTS
    --------------------------------------------------------- */

    const [submittedAssignments, notSubmittedAssignments] = await Promise.all([
      prisma.assignment.count({
        where: {
          ...assignmentWhere,
          inspections: {
            some: {
              status: {
                in: ["soumis", "verifie"],
              },
            },
          },
        },
      }),

      prisma.assignment.count({
        where: {
          ...assignmentWhere,
          inspections: {
            none: {
              status: {
                in: ["soumis", "verifie"],
              },
            },
          },
        },
      }),
    ]);

    const assignmentsDist = [
      {
        name: "Soumises",
        value: submittedAssignments,
      },
      {
        name: "Non soumises",
        value: notSubmittedAssignments,
      },
    ];

    /* ---------------------------------------------------------
       INSPECTIONS RÉCENTES
    --------------------------------------------------------- */

    const recentInspections = await prisma.inspection.findMany({
      where: inspectionWhere,
      orderBy: {
        updatedAt: "desc",
      },
      take: 6,
      include: {
        formType: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },

        group: {
          select: {
            id: true,
            name: true,
          },
        },

        assignment: {
          select: {
            id: true,
            year: true,
            bimonthlyPeriod: true,
            weekNumber: true,
            dueDate: true,
          },
        },
      },
    });

    const recent = recentInspections.map((inspection) => ({
      id: inspection.id,
      name: inspection.formType.name,
      formType: inspection.formType.code,
      formTypeId: inspection.formType.id,
      group: inspection.group.name,
      groupId: inspection.group.id,
      lastSubmission: inspection.submittedAt,
      week: inspection.weekNumber,
      status: inspection.status,
    }));

    /* ---------------------------------------------------------
       OPTIONS DES FILTRES
       IMPORTANT : elles ne dépendent PAS des filtres actifs
    --------------------------------------------------------- */

    const accessibleAssignments = await prisma.assignment.findMany({
      where: assignmentWhere,
      select: {
        year: true,
        bimonthlyPeriod: true,
      },
      distinct: ["year", "bimonthlyPeriod"],
    });

    const years = await prisma.assignment.findMany({
      where: {
        ...(accessibleGroupIds
          ? {
              groupId: {
                in: accessibleGroupIds,
              },
            }
          : {}),
      },
      select: {
        year: true,
      },
      distinct: ["year"],
      orderBy: {
        year: "desc",
      },
    });

    const filterGroups = await prisma.group.findMany({
      where: isGlobalRole
        ? undefined
        : {
            id: {
              in: user.groupIds,
            },
          },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    const formTypes = await prisma.formType.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    /* ---------------------------------------------------------
       RÉPONSE
    --------------------------------------------------------- */

    return res.json({
      kpis: {
        totalForms,
        submittedForms,
        verifiedForms,
        rejectedForms,
        verifiedPct,

        totalTasks,
        submittedTasks,
        overdueTasks,
        submittedPct,
      },

      byStatus,
      assignmentsDist,
      trend,
      byGroup,
      recent,
      filterOptions: {
        years: years.map((item) => item.year),
        bimesters: [1, 2, 3, 4, 5, 6],
        groups: filterGroups,
        formTypes,
      },
    });
  } catch (error) {
    console.error("GET /dashboard/stats:", error);

    return res.status(500).json({
      error: "Impossible de récupérer les statistiques du dashboard",
    });
  }
});
