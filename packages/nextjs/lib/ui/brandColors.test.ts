import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ACTION_NEUTRAL = "#f5f5f5";
const ACTION_NEUTRAL_HOVER = "#d4d4d4";
const ACTION_CONTENT = "#050505";
const SECONDARY_NEUTRAL = "#d4d4d4";
const SECONDARY_NEUTRAL_DEEP = "#737373";
const ERROR = "#ef476f";
const ERROR_CONTENT = "#ffffff";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "globals.css"), "utf8");

function readCssVar(name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedName}\\s*:\\s*([^;]+);`, "i"));

  assert.ok(match, `${name} is declared in globals.css`);

  return match[1].trim().toLowerCase();
}

test("primary action neutral stays aligned across DaisyUI and custom tokens", () => {
  assert.equal(readCssVar("--color-primary"), ACTION_NEUTRAL);
  assert.equal(readCssVar("--color-primary-content"), ACTION_CONTENT);
  assert.equal(readCssVar("--rateloop-ember"), ACTION_NEUTRAL);
  assert.equal(readCssVar("--rateloop-action-orange"), ACTION_NEUTRAL);
  assert.equal(readCssVar("--rateloop-action-orange-hover"), ACTION_NEUTRAL_HOVER);
  assert.equal(readCssVar("--rateloop-action-content"), ACTION_CONTENT);
  assert.equal(readCssVar("--rateloop-ember-rgb"), "245 245 245");
});

test("secondary neutral and error accents stay distinct", () => {
  assert.equal(readCssVar("--color-accent"), SECONDARY_NEUTRAL);
  assert.equal(readCssVar("--color-accent-content"), ACTION_CONTENT);
  assert.equal(readCssVar("--color-error"), ERROR);
  assert.equal(readCssVar("--color-error-content"), ERROR_CONTENT);
  assert.equal(readCssVar("--rateloop-ember-deep"), SECONDARY_NEUTRAL_DEEP);
  assert.equal(readCssVar("--rateloop-ember-deep-rgb"), "115 115 115");
});
