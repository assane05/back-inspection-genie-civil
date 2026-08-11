import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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

export async function savePhotoFromDataUrl(
  dataUrl: string,
): Promise<StoredPhoto> {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("invalid_photo_data_url");
  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, "base64");

  const now = new Date();
  const dir = path.join(
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
  );
  const filename = `${randomUUID()}.${MIME_EXT[mimeType] ?? "jpg"}`;
  const storageKey = path.join(dir, filename);

  const absoluteDir = path.join(path.resolve(env.uploadDir), dir);
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(absoluteDir, filename), buffer);

  return {
    storageKey,
    url: `${env.publicUploadBaseUrl.replace(/\/$/, "")}/${storageKey.split(path.sep).join("/")}`,
    mimeType,
    sizeBytes: buffer.byteLength,
  };
}
