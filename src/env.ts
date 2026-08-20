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

  // Stockage objets des photos (compatible S3 : AWS S3, MinIO, R2, Spaces...).
  // S3_ENDPOINT reste optionnel — on l'omet pour AWS S3 lui-même, on le
  // renseigne pour tout service S3-compatible auto-hébergé (MinIO en local).
  s3Endpoint: process.env.S3_ENDPOINT || undefined,
  s3Region: required("S3_REGION"),
  s3Bucket: required("S3_BUCKET"),
  s3AccessKeyId: required("S3_ACCESS_KEY_ID"),
  s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
  // AUCUN défaut ici volontairement — l'audit de l'ancienne application a
  // relevé une URL localhost codée en dur pour les photos ; on force une
  // valeur explicite par environnement plutôt que de risquer la même
  // régression silencieuse en prod.
  publicUploadBaseUrl: required("PUBLIC_UPLOAD_BASE_URL"),

  demoSeedPassword: process.env.DEMO_SEED_PASSWORD ?? "ChangeMe123!",
  isProduction: process.env.NODE_ENV === "production",
};

if (env.isProduction && env.demoSeedPassword === "ChangeMe123!") {
  throw new Error(
    "défaut détecté en production — changez-le ou ne relancez pas le seed de démonstration.",
  );
}

if (
  env.isProduction &&
  /localhost|127\.0\.0\.1/.test(env.publicUploadBaseUrl)
) {
  throw new Error(
    "PUBLIC_UPLOAD_BASE_URL pointe vers localhost en production — c'est exactement la régression relevée à l'audit de l'ancienne application. Configurez l'URL publique réelle du bucket/CDN.",
  );
}
