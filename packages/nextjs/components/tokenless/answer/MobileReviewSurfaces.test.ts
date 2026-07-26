import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("question images stack on mobile and private text always has an expansion path", () => {
  const media = readFileSync(new URL("./QuestionMedia.tsx", import.meta.url), "utf8");
  const privatePreview = readFileSync(new URL("../review/PrivateArtifactPreview.tsx", import.meta.url), "utf8");
  const playwright = readFileSync(new URL("../../../playwright.config.ts", import.meta.url), "utf8");
  assert.match(media, /grid-cols-1 sm:grid-cols-2/u);
  assert.match(media, /sm:col-span-2/u);
  assert.match(privatePreview, /PREVIEW_CHARACTER_LIMIT/u);
  assert.match(privatePreview, /Show more/u);
  assert.match(privatePreview, /role="dialog"/u);
  assert.match(playwright, /mobile-chromium/u);
  assert.match(playwright, /devices\["Pixel 7"\]/u);
});
