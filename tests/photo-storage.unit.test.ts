import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(function MockS3Client() {
    return { send: sendMock };
  }),
  PutObjectCommand: vi.fn().mockImplementation(function MockPutObjectCommand(
    input: unknown,
  ) {
    return { __command: "Put", input };
  }),
  DeleteObjectCommand: vi
    .fn()
    .mockImplementation(function MockDeleteObjectCommand(input: unknown) {
      return { __command: "Delete", input };
    }),
}));

describe("photo-storage (S3, SDK mocké)", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("envoie un PutObjectCommand et renvoie une clé/URL cohérentes", async () => {
    const { savePhotoFromDataUrl } = await import("../src/lib/photo-storage");
    const { env } = await import("../src/env");
    sendMock.mockResolvedValue({});

    const tinyJpeg =
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

    const result = await savePhotoFromDataUrl(tinyJpeg);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.__command).toBe("Put");
    expect(call.input.Bucket).toBe(env.s3Bucket);
    expect(call.input.ContentType).toBe("image/jpeg");

    expect(result.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]+\.jpg$/);
    expect(result.url).toBe(`${env.publicUploadBaseUrl}/${result.storageKey}`);
    expect(result.url).not.toContain(":4000");
  });

  it("rejette un data URL invalide avant tout appel réseau", async () => {
    const { savePhotoFromDataUrl } = await import("../src/lib/photo-storage");
    await expect(savePhotoFromDataUrl("not-a-data-url")).rejects.toThrow();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("isImageDataUrl distingue formats supportés / non supportés", async () => {
    const { isImageDataUrl } = await import("../src/lib/photo-storage");
    expect(isImageDataUrl("data:image/jpeg;base64,abc")).toBe(true);
    expect(isImageDataUrl("data:image/png;base64,abc")).toBe(true);
    expect(isImageDataUrl("data:application/pdf;base64,abc")).toBe(false);
    expect(isImageDataUrl("not-a-data-url")).toBe(false);
  });

  it("deletePhoto envoie un DeleteObjectCommand avec la clé fournie", async () => {
    const { deletePhoto } = await import("../src/lib/photo-storage");
    const { env } = await import("../src/env");
    sendMock.mockResolvedValue({});

    await deletePhoto("2026/08/some-key.jpg");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.__command).toBe("Delete");
    expect(call.input.Bucket).toBe(env.s3Bucket);
    expect(call.input.Key).toBe("2026/08/some-key.jpg");
  });
});
