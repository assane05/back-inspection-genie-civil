import { Router } from "express";
import { z } from "zod";
import { env } from "../env";
import { prisma } from "../prisma";
import { verifyPassword } from "../lib/password";
import { createSession, revokeSession } from "../lib/session";
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
  path: "/",
};

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });

  const { identifier, password } = parsed.data;
  const key = identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: key }, { email: key }] },
  });

  if (!user || !user.isActive)
    return res.status(401).json({ error: "invalid_credentials" });

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  const { token, expiresAt } = await createSession(user.id);
  res.cookie(env.sessionCookieName, token, {
    ...cookieOptions,
    maxAge: expiresAt.getTime() - Date.now(),
  });
  res.json({ user: toSessionUser(user), expiresIn: env.sessionTtlSeconds });
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[env.sessionCookieName];
  if (token) await revokeSession(token);
  res.clearCookie(env.sessionCookieName, {
    ...cookieOptions,
    maxAge: undefined,
  });
  res.status(204).end();
});

/** GET /auth/me — vérité serveur sur la session en cours. */
authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
