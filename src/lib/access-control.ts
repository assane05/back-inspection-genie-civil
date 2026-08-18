import { ApiError } from "./api-error";
import type { SessionUser } from "./session-user";

export function requireAuth(user: SessionUser | undefined): SessionUser {
  if (!user)
    throw new ApiError(401, "not_authenticated", "Authentification requise.");
  return user;
}

export function requireRole(
  user: SessionUser | undefined,
  ...roles: Array<"superviseur" | "administrateur" | "approbateur">
): SessionUser {
  const u = requireAuth(user);
  if (!roles.includes(u.role))
    throw new ApiError(403, "forbidden", "Rôle insuffisant pour cette action.");
  return u;
}

export function assertGroupAccess(user: SessionUser, groupId: string): void {
  if (user.role === "administrateur" || user.role === "approbateur") return;
  if (!user.groupIds.includes(groupId)) {
    throw new ApiError(
      403,
      "forbidden",
      "Ce groupe n'est pas accessible à cet utilisateur.",
    );
  }
}
