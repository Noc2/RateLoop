import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tokenless surfaces use sanctioned readable secondary text tiers", async () => {
  const styles = await readFile(new URL("../../styles/globals.css", import.meta.url), "utf8");

  assert.match(styles, /--color-base-100: #0a0a0a/);
  assert.match(styles, /--rateloop-surface: #0a0a0a/);
  assert.match(styles, /--rateloop-text-secondary: rgb\(245 245 245 \/ 0\.7\)/);
  assert.match(styles, /--rateloop-text-tertiary: rgb\(245 245 245 \/ 0\.55\)/);
  assert.match(styles, /\.text-base-content\\\/45\s*\{\s*color: var\(--rateloop-text-secondary\)/);
  for (const tier of ["40", "35", "30", "25"]) {
    assert.match(styles, new RegExp(`\\.text-base-content\\\\/${tier}`));
  }
});
