import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_HANDOFF_GENERATED_IMAGE_BYTES,
  readHandoffGeneratedImageFile,
  readHandoffGeneratedImageFiles,
} from "../handoffImages.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function pngWithDimensions(width: number, height: number) {
  const buffer = Buffer.from(ONE_PIXEL_PNG);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function writeTempFile(name: string, buffer: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "rateloop-handoff-image-"));
  const path = join(dir, name);
  await writeFile(path, buffer);
  return path;
}

describe("handoff generated image files", () => {
  it("reads PNG bytes without printing base64 through the terminal", async () => {
    const path = await writeTempFile("mockup.png", ONE_PIXEL_PNG);
    const image = await readHandoffGeneratedImageFile(path);

    expect(image).toMatchObject({
      filename: "mockup.png",
      imageBase64: ONE_PIXEL_PNG.toString("base64"),
      mimeType: "image/png",
      path,
      sha256: createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"),
      sizeBytes: ONE_PIXEL_PNG.length,
    });
    expect(image.dimensions).toEqual({ width: 1, height: 1 });
    expect(image.buffer).toEqual(ONE_PIXEL_PNG);
  });

  it("warns when generated image dimensions are not 16:9", async () => {
    const squarePng = pngWithDimensions(1200, 1200);
    const path = await writeTempFile("square.png", squarePng);
    const image = await readHandoffGeneratedImageFile(path);

    expect(image.dimensions).toEqual({ width: 1200, height: 1200 });
    expect(image.warnings).toEqual([
      "1200x1200 is not 16:9. Prefer 16:9 for newly generated public images; other ratios are allowed when useful.",
    ]);
  });

  it("does not warn when generated image dimensions are 16:9", async () => {
    const widescreenPng = pngWithDimensions(1600, 900);
    const path = await writeTempFile("widescreen.png", widescreenPng);
    const image = await readHandoffGeneratedImageFile(path);

    expect(image.dimensions).toEqual({ width: 1600, height: 900 });
    expect(image.warnings).toEqual([]);
  });

  it("supports repeated image file inputs", async () => {
    const first = await writeTempFile("first.png", ONE_PIXEL_PNG);
    const second = await writeTempFile("second.png", ONE_PIXEL_PNG);

    const images = await readHandoffGeneratedImageFiles([first, second]);

    expect(images).toHaveLength(2);
    expect(images[0]?.filename).toBe("first.png");
    expect(images[1]?.filename).toBe("second.png");
  });

  it("rejects files above the RateLoop per-image upload limit", async () => {
    const path = await writeTempFile(
      "too-large.png",
      Buffer.alloc(MAX_HANDOFF_GENERATED_IMAGE_BYTES + 1, 1),
    );

    await expect(readHandoffGeneratedImageFile(path)).rejects.toThrow(
      /exceeds RateLoop's .* byte generated-image limit/,
    );
  });
});
