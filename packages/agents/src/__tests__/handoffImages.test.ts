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

    expect(image).toEqual({
      filename: "mockup.png",
      imageBase64: ONE_PIXEL_PNG.toString("base64"),
      mimeType: "image/png",
      sha256: createHash("sha256").update(ONE_PIXEL_PNG).digest("hex"),
      sizeBytes: ONE_PIXEL_PNG.length,
    });
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
    const path = await writeTempFile("too-large.png", Buffer.alloc(MAX_HANDOFF_GENERATED_IMAGE_BYTES + 1, 1));

    await expect(readHandoffGeneratedImageFile(path)).rejects.toThrow(/exceeds RateLoop's .* byte generated-image limit/);
  });
});
