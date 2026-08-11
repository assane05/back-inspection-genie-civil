import type { User } from "@prisma/client";

/**
 * Forme exacte attendue par le frontend (src/lib/auth-api.ts#SessionUser).
 * Ne jamais inclure passwordHash ni les colonnes internes.
 */
export type SessionUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: "admin" | "supervisor";
  groups: string[];
  initials: string;
  isActive: boolean;
};

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    groups: user.groups,
    initials: user.initials,
    isActive: user.isActive,
  };
}
