import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { env } from "../env";

export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + env.sessionTtlSeconds * 1000);
  await prisma.session.create({ data: { id: token, userId, expiresAt } });
  return { token, expiresAt };
}

export async function getValidSession(token: string) {
  const session = await prisma.session.findUnique({ where: { id: token } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session
      .delete({ where: { id: token } })
      .catch(() => undefined);
    return null;
  }
  return session;
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.delete({ where: { id: token } }).catch(() => undefined);
}
