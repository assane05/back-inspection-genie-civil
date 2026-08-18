import { prisma } from "../prisma";

export async function loadUserGroups(
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const memberships = await prisma.userGroup.findMany({
    where: { userId },
    include: { group: { select: { id: true, name: true } } },
  });
  return memberships.map((m) => m.group);
}
