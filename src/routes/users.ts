import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { loadUserGroups } from "../lib/user-groups";
import { hashPassword } from "../lib/password";
import { ApiError } from "../lib/api-error";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole("administrateur"));

async function serializeUser(user: {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: "superviseur" | "administrateur" | "approbateur";
  isActive: boolean;
  createdAt: Date;
}) {
  const groups = await loadUserGroups(user.id);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    groups,
  };
}

// ========= GET /groups (annuaire des groupes, pour le sélecteur d'affectation) =========
// Déclarée avant /:id pour ne pas être capturée par ce paramètre.
usersRouter.get("/groups", async (_req, res) => {
  const groups = await prisma.group.findMany({ orderBy: { name: "asc" } });
  res.json({ groups });
});

// ========= GET / =========

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { displayName: "asc" } });
  res.json({ users: await Promise.all(users.map(serializeUser)) });
});

// ========= POST / =========

const createUserBody = z.object({
  username: z.string().min(3),
  displayName: z.string().min(1),
  email: z.string().email().nullable().optional(),
  role: z
    .enum(["superviseur", "administrateur", "approbateur"])
    .default("superviseur"),
  password: z.string().min(8, "8 caractères minimum."),
  groupIds: z.array(z.string().uuid()).default([]),
});

usersRouter.post("/", async (req, res) => {
  const parsed = createUserBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }
  const { username, displayName, email, role, password, groupIds } =
    parsed.data;

  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        username,
        displayName,
        email: email ?? null,
        role,
        passwordHash,
        userGroups: { create: groupIds.map((groupId) => ({ groupId })) },
      },
    });
    res.status(201).json(await serializeUser(user));
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new ApiError(
        409,
        "username_taken",
        "Cet identifiant est déjà utilisé.",
      );
    }
    throw err;
  }
});

// ========= PATCH /:id =========

const patchUserBody = z.object({
  displayName: z.string().min(1).optional(),
  username: z.string().min(3).optional(),
  email: z.string().email().nullable().optional(),
  role: z.enum(["superviseur", "administrateur", "approbateur"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
  groupIds: z.array(z.string().uuid()).optional(),
});

usersRouter.patch("/:id", async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw new ApiError(404, "not_found", "Utilisateur introuvable.");

  const parsed = patchUserBody.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "invalid_body",
      "Corps de requête invalide.",
      parsed.error.flatten(),
    );
  }
  const { password, groupIds, ...rest } = parsed.data;

  if (target.id === req.user!.id && rest.isActive === false) {
    throw new ApiError(
      400,
      "cannot_disable_self",
      "Vous ne pouvez pas désactiver votre propre compte.",
    );
  }
  if (
    target.id === req.user!.id &&
    rest.role &&
    rest.role !== "administrateur"
  ) {
    throw new ApiError(
      400,
      "cannot_demote_self",
      "Vous ne pouvez pas retirer votre propre rôle administrateur.",
    );
  }

  try {
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          ...rest,
          passwordHash: password ? await hashPassword(password) : undefined,
        },
      });
      if (groupIds) {
        await tx.userGroup.deleteMany({ where: { userId: target.id } });
        await tx.userGroup.createMany({
          data: groupIds.map((groupId) => ({ userId: target.id, groupId })),
        });
      }
      return updated;
    });
    res.json(await serializeUser(user));
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new ApiError(
        409,
        "username_taken",
        "Cet identifiant est déjà utilisé.",
      );
    }
    throw err;
  }
});

// ========= DELETE /:id =========

usersRouter.delete("/:id", async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw new ApiError(404, "not_found", "Utilisateur introuvable.");
  if (target.id === req.user!.id) {
    throw new ApiError(
      400,
      "cannot_delete_self",
      "Vous ne pouvez pas supprimer votre propre compte.",
    );
  }

  await prisma.user.delete({ where: { id: target.id } });
  res.status(204).end();
});
