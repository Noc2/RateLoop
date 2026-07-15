import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./InfoPopover.tsx", import.meta.url), "utf8");

test("info popover supports pointer, keyboard, and assistive technology", () => {
  assert.match(source, /type="button"/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{popoverId\}/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /buttonRef\.current\?\.focus\(\)/);
  assert.match(source, /document\.addEventListener\("pointerdown"/);
  assert.match(source, /document\.removeEventListener\("pointerdown"/);
  assert.match(source, /role="tooltip"/);
  assert.doesNotMatch(source, /title=|<details|<summary/);
});
