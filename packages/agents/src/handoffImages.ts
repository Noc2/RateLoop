import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export const MAX_HANDOFF_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_HANDOFF_GENERATED_IMAGES = 4;

const RECOMMENDED_GENERATED_IMAGE_ASPECT_RATIO = 16 / 9;
const RECOMMENDED_GENERATED_IMAGE_ASPECT_RATIO_TOLERANCE = 0.03;

const MIME_BY_EXTENSION: Record<
  string,
  "image/jpeg" | "image/png" | "image/webp"
> = {
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

export type HandoffGeneratedImageDimensions = {
  width: number;
  height: number;
};

export type HandoffGeneratedImageFile = HandoffGeneratedImage & {
  buffer: Buffer;
  dimensions: HandoffGeneratedImageDimensions | null;
  path: string;
  warnings: string[];
};

function detectImageMimeType(
  path: string,
  buffer: Buffer,
): HandoffGeneratedImage["mimeType"] {
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

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
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

  throw new Error(
    `Unsupported image type for ${path}. Use a PNG, JPG, JPEG, or WEBP file.`,
  );
}

function dimensionsOrNull(
  width: number,
  height: number,
): HandoffGeneratedImageDimensions | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function readPngDimensions(buffer: Buffer) {
  if (buffer.length < 24) return null;
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) {
    return null;
  }
  return dimensionsOrNull(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

function isJpegStartOfFrame(marker: number) {
  return (
    marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

function readJpegDimensions(buffer: Buffer) {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[2] !== 0xff
  ) {
    return null;
  }

  let offset = 2;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset++;
    while (offset < buffer.length && buffer[offset] === 0xff) offset++;
    if (offset >= buffer.length) return null;

    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) return null;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > buffer.length) return null;

    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return null;
      return dimensionsOrNull(
        buffer.readUInt16BE(offset + 5),
        buffer.readUInt16BE(offset + 3),
      );
    }

    offset = segmentEnd;
  }

  return null;
}

function readUInt24LE(buffer: Buffer, offset: number) {
  if (offset + 3 > buffer.length) return null;
  return (
    buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
  );
}

function readWebpDimensions(buffer: Buffer) {
  if (
    buffer.length < 12 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) return null;

    if (chunkType === "VP8X" && chunkSize >= 10) {
      const widthMinusOne = readUInt24LE(buffer, chunkStart + 4);
      const heightMinusOne = readUInt24LE(buffer, chunkStart + 7);
      if (widthMinusOne === null || heightMinusOne === null) return null;
      return dimensionsOrNull(widthMinusOne + 1, heightMinusOne + 1);
    }

    if (chunkType === "VP8L" && chunkSize >= 5 && buffer[chunkStart] === 0x2f) {
      const b0 = buffer[chunkStart + 1];
      const b1 = buffer[chunkStart + 2];
      const b2 = buffer[chunkStart + 3];
      const b3 = buffer[chunkStart + 4];
      const width = 1 + b0 + ((b1 & 0x3f) << 8);
      const height = 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10);
      return dimensionsOrNull(width, height);
    }

    if (
      chunkType === "VP8 " &&
      chunkSize >= 10 &&
      buffer[chunkStart + 3] === 0x9d &&
      buffer[chunkStart + 4] === 0x01 &&
      buffer[chunkStart + 5] === 0x2a
    ) {
      return dimensionsOrNull(
        buffer.readUInt16LE(chunkStart + 6) & 0x3fff,
        buffer.readUInt16LE(chunkStart + 8) & 0x3fff,
      );
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  return null;
}

function readImageDimensions(
  buffer: Buffer,
  mimeType: HandoffGeneratedImage["mimeType"],
) {
  if (mimeType === "image/png") return readPngDimensions(buffer);
  if (mimeType === "image/jpeg") return readJpegDimensions(buffer);
  if (mimeType === "image/webp") return readWebpDimensions(buffer);
  return null;
}

function generatedImageWarnings(
  dimensions: HandoffGeneratedImageDimensions | null,
) {
  if (!dimensions) return [];
  const ratio = dimensions.width / dimensions.height;
  if (
    Math.abs(ratio - RECOMMENDED_GENERATED_IMAGE_ASPECT_RATIO) <=
    RECOMMENDED_GENERATED_IMAGE_ASPECT_RATIO_TOLERANCE
  ) {
    return [];
  }

  return [
    `${dimensions.width}x${dimensions.height} is not 16:9. Prefer 16:9 for newly generated public images; other ratios are allowed when useful.`,
  ];
}

export async function readHandoffGeneratedImageFile(
  path: string,
): Promise<HandoffGeneratedImageFile> {
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

  const mimeType = detectImageMimeType(path, buffer);
  const dimensions = readImageDimensions(buffer, mimeType);

  return {
    buffer,
    dimensions,
    filename: basename(resolvedPath),
    imageBase64: buffer.toString("base64"),
    mimeType,
    path: resolvedPath,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.length,
    warnings: generatedImageWarnings(dimensions),
  };
}

export async function readHandoffGeneratedImageFiles(
  paths: readonly string[],
): Promise<HandoffGeneratedImageFile[]> {
  if (paths.length > MAX_HANDOFF_GENERATED_IMAGES) {
    throw new Error(
      `generatedImages supports at most ${MAX_HANDOFF_GENERATED_IMAGES} images.`,
    );
  }
  return Promise.all(paths.map((path) => readHandoffGeneratedImageFile(path)));
}
