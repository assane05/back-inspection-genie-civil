import { Router } from "express";
import { z } from "zod";
import { env } from "../env";
import { prisma } from "../prisma";
import { verifyPassword } from "../lib/password";
import { signSessionToken } from "../lib/jwt";
import { toSessionUser } from "../lib/session-user";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const cookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "lax" as const,
  maxAge: env.sessionTtlSeconds * 1000,
  path: "/",
};

/**
 * POST /auth/login — { identifier, password } -> { user, expiresIn }
 * Identifiant = username ou email. Pose un cookie de session httpOnly.
 * Contrat exact attendu par src/lib/auth-api.ts#authenticate côté frontend.
 */
authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });

  const { identifier, password } = parsed.data;
  const key = identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: key }, { email: key }] },
  });

  // Réponse volontairement identique (identifiant inconnu / mdp faux / compte désactivé)
  // pour ne pas révéler quels comptes existent.
  if (!user || !user.isActive) return res.status(401).json({ error: "invalid_credentials" });

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  const token = signSessionToken(user.id);
  res.cookie(env.sessionCookieName, token, cookieOptions);
  res.json({ user: toSessionUser(user), expiresIn: env.sessionTtlSeconds });
});

/** POST /auth/logout — révoque le cookie de session côté serveur. */
authRouter.post("/logout", (_req, res) => {
  res.clearCookie(env.sessionCookieName, { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
});

/** GET /auth/me — vérité serveur sur la session en cours (pas encore appelé par le frontend actuel). */
authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
