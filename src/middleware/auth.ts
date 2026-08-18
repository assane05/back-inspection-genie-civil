import type { NextFunction, Request, Response } from "express";
import { env } from "../env";
import { getValidSession } from "../lib/session";
import { prisma } from "../prisma";
import { toSessionUser, type SessionUser } from "../lib/session-user";
import { loadUserGroups } from "../lib/user-groups";
import {
  assertGroupAccess as assertGroupAccessPure,
  requireAuth as requireAuthPure,
  requireRole as requireRolePure,
} from "../lib/access-control";

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
  const session = await getValidSession(token);
  if (!session) return next();
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (user && user.isActive) {
    const groups = await loadUserGroups(user.id);
    req.user = toSessionUser(user, groups);
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  requireAuthPure(req.user);
  next();
}

export function requireRole(
  ...roles: Array<"superviseur" | "administrateur" | "approbateur">
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    requireRolePure(req.user, ...roles);
    next();
  };
}

export const assertGroupAccess = assertGroupAccessPure;
