import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  // Une ou plusieurs origines séparées par une virgule.
  frontendOrigins: required("FRONTEND_ORIGIN")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: required("JWT_SECRET"),
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 8 * 60 * 60),
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "las_session",
  photoStorageDriver: (process.env.PHOTO_STORAGE_DRIVER ?? "local") as "local",
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  publicUploadBaseUrl: process.env.PUBLIC_UPLOAD_BASE_URL ?? "http://localhost:4000/uploads",
  demoSeedPassword: process.env.DEMO_SEED_PASSWORD ?? "ChangeMe123!",
  isProduction: process.env.NODE_ENV === "production",
};

if (env.jwtSecret === "change-me-generate-a-real-secret" && env.isProduction) {
  throw new Error("JWT_SECRET par défaut détecté en production — générez un vrai secret.");
}
