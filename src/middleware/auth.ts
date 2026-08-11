import type { NextFunction, Request, Response } from "express";
import { env } from "../env";
import { verifySessionToken } from "../lib/jwt";
import { prisma } from "../prisma";
import { toSessionUser, type SessionUser } from "../lib/session-user";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.[env.sessionCookieName];
  if (!token) return next();
  const payload = verifySessionToken(token);
  if (!payload) return next();
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (user && user.isActive) req.user = toSessionUser(user);
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "not_authenticated" });
  next();
}

export function requireRole(role: "admin" | "supervisor") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "not_authenticated" });
    if (req.user.role !== role)
      return res.status(403).json({ error: "forbidden" });
    next();
  };
}
