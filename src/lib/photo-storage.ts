import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

import { env } from "../env";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type StoredPhoto = {
  storageKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
};

export function isImageDataUrl(value: string): boolean {
  return /^data:image\/(jpeg|png|webp);base64,/.test(value);
}

let client: S3Client | undefined;

/** Lazy — évite d'instancier le client (et de valider les credentials) au simple import du module, utile pour les tests unitaires qui mockent ce module. */
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint,
      forcePathStyle: env.s3ForcePathStyle,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
  }
  return client;
}

/**
 * Stockage objets compatible S3 (AWS S3, MinIO, R2, Spaces...) — remplace
 * l'écriture sur disque local. L'URL publique est toujours construite à
 * partir de PUBLIC_UPLOAD_BASE_URL (obligatoire, sans défaut localhost —
 * cf. env.ts et l'audit de l'ancienne application).
 */
export async function savePhotoFromDataUrl(
  dataUrl: string,
): Promise<StoredPhoto> {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("invalid_photo_data_url");
  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, "base64");

  const now = new Date();
  const storageKey = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    `${randomUUID()}.${MIME_EXT[mimeType] ?? "jpg"}`,
  ].join("/");

  await s3().send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: storageKey,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  return {
    storageKey,
    url: `${env.publicUploadBaseUrl.replace(/\/$/, "")}/${storageKey}`,
    mimeType,
    sizeBytes: buffer.byteLength,
  };
}

export async function deletePhoto(storageKey: string): Promise<void> {
  await s3().send(
    new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: storageKey }),
  );
}

export async function getPhotoObject(storageKey: string) {
  return s3().send(
    new GetObjectCommand({
      Bucket: env.s3Bucket,
      Key: storageKey,
    }),
  );
}
