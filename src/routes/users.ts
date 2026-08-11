import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword } from "../lib/password";
import { toSessionUser } from "../lib/session-user";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole("admin"));

function isSeedAccount(id: string) {
  return id === "u-admin-1" || /^u-supervisor-\d+$/.test(id);
}

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  res.json({ users: users.map(toSessionUser) });
});

const createUserSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8, "8 caractères minimum"),
  role: z.enum(["admin", "supervisor"]).default("supervisor"),
  groups: z.array(z.string()).default([]),
});

function initialsFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
  return initials || "??";
}

/** crée un compte avec un vrai mot de passe. */
usersRouter.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "invalid_body", details: parsed.error.flatten() });
  const { password, ...rest } = parsed.data;

  const conflict = await prisma.user.findFirst({
    where: { OR: [{ username: rest.username }, { email: rest.email }] },
  });
  if (conflict)
    return res.status(409).json({ error: "username_or_email_taken" });

  const user = await prisma.user.create({
    data: {
      ...rest,
      passwordHash: await hashPassword(password),
      initials: initialsFor(rest.name),
    },
  });
  res.status(201).json({ user: toSessionUser(user) });
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  username: z.string().min(3).optional(),
  email: z.string().email().optional(),
  role: z.enum(["admin", "supervisor"]).optional(),
  groups: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

/** modifie le profil, le rôle, les groupes, ou désactive/réactive. */
usersRouter.patch("/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "invalid_body", details: parsed.error.flatten() });
  const { password, ...rest } = parsed.data;

  if (rest.isActive === false && req.params.id === req.user!.id) {
    return res.status(400).json({ error: "cannot_deactivate_self" });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
      },
    });
    res.json({ user: toSessionUser(user) });
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

/** les comptes de démonstration sont protégés (désactiver plutôt que supprimer). */
usersRouter.delete("/:id", async (req, res) => {
  if (isSeedAccount(req.params.id)) {
    return res.status(400).json({ error: "seed_account_protected" });
  }
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});
