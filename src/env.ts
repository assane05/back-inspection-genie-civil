import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v)
    throw new Error(
      `Variable d'environnement manquante : ${name} (voir .env.example)`,
    );
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  frontendOrigins: required("FRONTEND_ORIGIN")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 8 * 60 * 60),
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "las_session",
  photoStorageDriver: (process.env.PHOTO_STORAGE_DRIVER ?? "local") as "local",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  publicUploadBaseUrl:
    process.env.PUBLIC_UPLOAD_BASE_URL ?? "http://localhost:4000/uploads",
  demoSeedPassword: process.env.DEMO_SEED_PASSWORD ?? "ChangeMe123!",
  isProduction: process.env.NODE_ENV === "production",
};

if (env.isProduction && env.demoSeedPassword === "ChangeMe123!") {
  throw new Error(
    "défaut détecté en production — changez-le ou ne relancez pas le seed de démonstration.",
  );
}
