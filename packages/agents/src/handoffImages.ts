import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export const MAX_HANDOFF_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_HANDOFF_GENERATED_IMAGES = 4;

const MIME_BY_EXTENSION: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export type HandoffGeneratedImage = {
  filename: string;
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sha256: string;
  sizeBytes: number;
};

function detectImageMimeType(path: string, buffer: Buffer): HandoffGeneratedImage["mimeType"] {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  const extensionMime = MIME_BY_EXTENSION[extname(path).toLowerCase()];
  if (extensionMime) return extensionMime;

  throw new Error(`Unsupported image type for ${path}. Use a PNG, JPG, JPEG, or WEBP file.`);
}

export async function readHandoffGeneratedImageFile(path: string): Promise<HandoffGeneratedImage> {
  const resolvedPath = resolve(path);
  const buffer = await readFile(resolvedPath);
  if (buffer.length <= 0) {
    throw new Error(`${path} is empty.`);
  }
  if (buffer.length > MAX_HANDOFF_GENERATED_IMAGE_BYTES) {
    throw new Error(
      `${path} is ${buffer.length} bytes, which exceeds RateLoop's ${MAX_HANDOFF_GENERATED_IMAGE_BYTES} byte generated-image limit.`,
    );
  }

  return {
    filename: basename(resolvedPath),
    imageBase64: buffer.toString("base64"),
    mimeType: detectImageMimeType(path, buffer),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.length,
  };
}

export async function readHandoffGeneratedImageFiles(paths: readonly string[]): Promise<HandoffGeneratedImage[]> {
  if (paths.length > MAX_HANDOFF_GENERATED_IMAGES) {
    throw new Error(`generatedImages supports at most ${MAX_HANDOFF_GENERATED_IMAGES} images.`);
  }
  return Promise.all(paths.map(path => readHandoffGeneratedImageFile(path)));
}
