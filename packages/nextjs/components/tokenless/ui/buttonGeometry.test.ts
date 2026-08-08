import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globals = readFileSync(new URL("../../../styles/globals.css", import.meta.url), "utf8");
const daisy = readFileSync(new URL("../../../node_modules/daisyui/daisyui.css", import.meta.url), "utf8");

function unlayered(selector: string) {
  const index = globals.indexOf(selector);
  assert.ok(index >= 0, `${selector} should exist in globals.css`);
  const before = globals.slice(0, index);
  return before.split("{").length === before.split("}").length;
}

test("the branded action rules sit outside every cascade layer", () => {
  // This is the fact the whole size scale rests on. Tailwind imports its
  // utilities into @layer utilities, and an unlayered declaration beats every
  // layered one regardless of specificity or order. So `.rateloop-gradient-action`
  // wins against `.min-h-11` — which is why a min-height utility on a primary
  // does nothing at all, and why 60 such classes were removed rather than
  // rebalanced.
  assert.match(globals, /@import "tailwindcss";/u);
  assert.ok(unlayered(".rateloop-gradient-action {"), "gradient action must stay unlayered");
  assert.ok(unlayered(".btn.rateloop-secondary-action,"), "secondary action must stay unlayered");
  assert.match(globals, /\.rateloop-gradient-action \{[^}]*min-height: 3rem;/su);
});

test("a primary is 48px tall whatever height class it carries", () => {
  // Recorded because it is counterintuitive and was shipped wrong: size="sm" on a
  // primary renders a 48px button with 12px text, since btn-sm sets --size and
  // the unlayered min-height overrides the result.
  const action = globals.slice(globals.indexOf(".rateloop-gradient-action {"));
  assert.match(action.slice(0, action.indexOf("}")), /min-height: 3rem/u);
  // And it declares no padding, so padding comes from .btn's --btn-p.
  assert.doesNotMatch(action.slice(0, action.indexOf("}")), /^\s*padding(-inline)?:/mu);
});

test("px-4 is the DaisyUI default, so writing it beside .btn changes nothing", () => {
  // 24 call sites carried it. Dropping them was safe precisely because these two
  // values agree; if DaisyUI ever changes --btn-p this test fails and the
  // removals need revisiting.
  assert.match(daisy, /--btn-p:\s*1rem/u);
  assert.match(daisy, /\.btn\{[^}]*padding-inline:var\(--btn-p\)/su);
  assert.match(daisy, /\.btn-sm\{[^}]*--btn-p:\s*\.75rem/su);
});

test("the secondary default height makes min-h-9 and min-h-10 inert", () => {
  // .btn sets height via --size; --size-field is 0.25rem, so the default is
  // 2.5rem = 40px. A min-height at or below that cannot raise the box.
  assert.match(daisy, /\.btn\{[^}]*height:var\(--size\)/su);
  assert.match(daisy, /\.btn-md\{[^}]*--size:calc\(var\(--size-field,\.25rem\)\*10\)/su);
});
