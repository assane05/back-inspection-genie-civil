import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/stats", async (_req, res) => {
  try {
    // ---------------------------------------------------------
    // 1. KPI : inspections
    // ---------------------------------------------------------

    const [totalForms, verifiedForms, totalTasks, submittedTasks] =
      await Promise.all([
        prisma.inspection.count(),
        prisma.inspection.count({
          where: {
            status: "verifie",
          },
        }),

        prisma.assignment.count(),
        prisma.assignment.count({
          where: {
            inspections: {
              some: {
                status: {
                  in: ["soumis", "verifie"],
                },
              },
            },
          },
        }),
      ]);

    const verifiedPct =
      totalForms > 0
        ? Number(((verifiedForms / totalForms) * 100).toFixed(2))
        : 0;

    const submittedPct =
      totalTasks > 0
        ? Number(((submittedTasks / totalTasks) * 100).toFixed(2))
        : 0;

    // ---------------------------------------------------------
    // 2. Répartition des tâches
    // ---------------------------------------------------------

    const [submittedAssignments, notSubmittedAssignments] = await Promise.all([
      prisma.assignment.count({
        where: {
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

    // ---------------------------------------------------------
    // 3. Répartition par groupe
    // ---------------------------------------------------------

    const groups = await prisma.group.findMany({
      orderBy: {
        name: "asc",
      },
      include: {
        _count: {
          select: {
            inspections: true,
          },
        },
      },
    });

    const byGroup = groups.map((group) => ({
      group: group.name,
      count: group._count.inspections,
    }));

    // ---------------------------------------------------------
    // 4. Évolution par semaine
    // ---------------------------------------------------------

    const inspections = await prisma.inspection.findMany({
      where: {
        OR: [
          {
            submittedAt: {
              not: null,
            },
          },
          {
            verifiedAt: {
              not: null,
            },
          },
        ],
      },
      select: {
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
      }
    >();

    for (const inspection of inspections) {
      if (inspection.submittedAt) {
        const date = inspection.submittedAt;

        const year = date.getFullYear();

        // Numéro de semaine ISO approximatif
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
          });
        }

        trendMap.get(week)!.verified++;
      }
    }

    const trend = Array.from(trendMap.entries()).map(([week, values]) => ({
      week,
      submitted: values.submitted,
      verified: values.verified,
    }));

    // ---------------------------------------------------------
    // 5. Inspections récentes
    // ---------------------------------------------------------

    const recentInspections = await prisma.inspection.findMany({
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
      group: inspection.group.name,
      lastSubmission: inspection.submittedAt,
      week: inspection.weekNumber,
      status: inspection.status,
    }));

    // ---------------------------------------------------------
    // 6. Réponse
    // ---------------------------------------------------------

    return res.json({
      kpis: {
        totalForms,
        verifiedForms,
        verifiedPct,
        totalTasks,
        submittedTasks,
        submittedPct,
      },

      assignmentsDist,

      trend,

      byGroup,

      recent,
    });
  } catch (error) {
    console.error("GET /dashboard/stats:", error);

    return res.status(500).json({
      error: "Impossible de récupérer les statistiques du dashboard",
    });
  }
});
