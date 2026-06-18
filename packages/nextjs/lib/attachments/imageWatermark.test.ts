import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import {
  buildConfidentialImageWatermarkOverlaySvg,
  watermarkConfidentialImage,
} from "~~/lib/attachments/imageWatermark";

const WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const VIEW_TOKEN = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
const TIMESTAMP = new Date("2026-06-18T14:25:38.000Z");

test("confidential image watermark overlay uses vector glyphs instead of runtime fonts", () => {
  const overlay = buildConfidentialImageWatermarkOverlaySvg({
    imageHeight: 630,
    imageWidth: 1200,
    timestamp: TIMESTAMP,
    viewToken: VIEW_TOKEN,
    walletAddress: WALLET,
  }).toString("utf8");

  assert.doesNotMatch(overlay, /<text\b/i);
  assert.doesNotMatch(overlay, /font-family/i);
  assert.match(overlay, /<path\b/);
});

test("confidential image watermark renders to valid webp bytes", async () => {
  const source = await sharp({
    create: {
      background: { alpha: 1, b: 22, g: 18, r: 16 },
      channels: 4,
      height: 180,
      width: 360,
    },
  })
    .webp()
    .toBuffer();

  const watermarked = await watermarkConfidentialImage(source, {
    timestamp: TIMESTAMP,
    viewToken: VIEW_TOKEN,
    walletAddress: WALLET,
  });
  const metadata = await sharp(watermarked).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 360);
  assert.equal(metadata.height, 180);
  assert.ok(watermarked.byteLength > 0);
});
