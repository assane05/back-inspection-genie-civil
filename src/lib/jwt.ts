import jwt from "jsonwebtoken";
import { env } from "../env";

export type SessionTokenPayload = { sub: string };

export function signSessionToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies SessionTokenPayload, env.jwtSecret, {
    expiresIn: env.sessionTtlSeconds,
  });
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as SessionTokenPayload;
  } catch {
    return null;
  }
}
