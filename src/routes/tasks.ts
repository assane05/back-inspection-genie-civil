import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { deriveDateParts } from "../lib/iso-week";

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");

/**
 * GET /tasks — liste avec filtres, cohérente avec TaskFilters côté frontend
 * (src/lib/tasks.ts). Un superviseur ne voit jamais que les tâches de ses
 * propres groupes, même s'il force un autre groupe en paramètre — l'admin
 * voit tout et peut filtrer librement.
 */
tasksRouter.get("/", async (req, res) => {
  const { form, status, year, bimester, week, q } = req.query as Record<string, string | undefined>;
  const groupParams = ([] as string[]).concat((req.query.group as string | string[] | undefined) ?? []);

  const where: Record<string, unknown> = {};
  if (form && form !== "all") where.form = form;
  if (status && status !== "all") where.status = status;
  if (year && year !== "all") where.year = Number(year);
  if (bimester && bimester !== "all") where.bimester = Number(bimester);
  if (week && week !== "all") where.week = Number(week);
  if (q) {
    where.OR = [
      { form: { contains: q, mode: "insensitive" } },
      { zone: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  if (req.user!.role === "supervisor") {
    where.group = { in: req.user!.groups };
  } else if (groupParams.length) {
    where.group = { in: groupParams };
  }

  const tasks = await prisma.task.findMany({ where, orderBy: { dueDate: "asc" } });
  res.json({ tasks });
});

tasksRouter.get("/:id", async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: "not_found" });
  if (req.user!.role === "supervisor" && !req.user!.groups.includes(task.group)) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json({ task });
});

const createTasksSchema = z.object({
  form: z.string().min(1),
  zones: z.array(z.string().min(1)).min(1),
  groups: z.array(z.string().min(1)).min(1),
  notes: z.string().default(""),
  dueISO: isoDate,
  kind: z.enum(["horizontal", "batiment"]).default("horizontal"),
});

/**
 * POST /tasks — assignation individuelle (1 zone × 1 groupe) ou en lot
 * (plusieurs zones et/ou groupes) : une tâche par combinaison zone × groupe,
 * miroir exact de createTasks() dans src/lib/admin-tasks.ts côté frontend.
 */
tasksRouter.post("/", requireRole("admin"), async (req, res) => {
  const parsed = createTasksSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  const { form, zones, groups, notes, dueISO, kind } = parsed.data;

  const { year, bimester, week } = deriveDateParts(dueISO);
  const dueDate = new Date(dueISO + "T00:00:00");

  const rows = zones.flatMap((zone) =>
    groups.map((group) => ({
      form,
      zone,
      group,
      notes,
      dueDate,
      year,
      bimester,
      week,
      kind,
      createdById: req.user!.id,
    })),
  );

  const created = await prisma.$transaction(rows.map((data) => prisma.task.create({ data })));
  res.status(201).json({ tasks: created });
});

const updateTaskSchema = z.object({
  form: z.string().min(1).optional(),
  zone: z.string().min(1).optional(),
  group: z.string().min(1).optional(),
  notes: z.string().optional(),
  dueISO: isoDate.optional(),
  status: z.enum(["not_submitted", "in_progress", "pending", "verified"]).optional(),
  kind: z.enum(["horizontal", "batiment"]).optional(),
});

/** PATCH /tasks/:id — édition admin (réassignation, correction, changement de statut). */
tasksRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const { dueISO, ...rest } = parsed.data;
  const dateParts = dueISO ? deriveDateParts(dueISO) : {};

  try {
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(dueISO ? { dueDate: new Date(dueISO + "T00:00:00"), ...dateParts } : {}),
      },
    });
    res.json({ task });
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

/** DELETE /tasks/:id — supprime la tâche (et ses soumissions, en cascade). */
tasksRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});
