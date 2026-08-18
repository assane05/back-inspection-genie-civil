import type { User } from "@prisma/client";

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: "superviseur" | "administrateur" | "approbateur";
  groupIds: string[];
  groupNames: string[];
  isActive: boolean;
};

export function toSessionUser(
  user: User,
  groups: { id: string; name: string }[],
): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    groupIds: groups.map((g) => g.id),
    groupNames: groups.map((g) => g.name),
    isActive: user.isActive,
  };
}
