import argon2 from "argon2";
import bcrypt from "bcryptjs";

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (hash.startsWith("$argon2")) return argon2.verify(hash, plain);
  if (hash.startsWith("$2")) return bcrypt.compare(plain, hash);
  return Promise.resolve(false);
}
