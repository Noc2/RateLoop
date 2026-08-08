import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

test("no primary asks for a height it cannot have", () => {
  // A primary is 48px because `.rateloop-gradient-action` pins min-height: 3rem
  // unlayered. Nine call sites wrote `min-h-11` on one anyway and rendered 48,
  // so the source said 44 and the screen said 48 — and the secondaries beside
  // them, where the class is live, really were 44. The pairs looked wrong and
  // the code looked right.
  const root = new URL("../../../", import.meta.url);
  const sources = execFileSync("git", ["ls-files", "*.tsx"], { cwd: root.pathname, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(name => !name.includes(".test."));

  const offenders: string[] = [];
  for (const name of sources) {
    const source = readFileSync(new URL(name, root), "utf8");
    // A <Button …> with no `variant` is a primary: the component defaults to it.
    for (const [element] of source.matchAll(/<Button\b[^>]*>/gsu)) {
      if (/variant=/u.test(element) || !/\bmin-h-\d/u.test(element)) continue;
      offenders.push(`${name}: ${element.replace(/\s+/gu, " ").slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], "a min-height on a primary is inert; drop it or change the variant");
});

test("every branded class a component writes is a class globals.css actually defines", () => {
  // `rateloop-primary-action` is not a real class and never was. It sat on the
  // reviewer's accept-assignment button, which therefore rendered as a bare
  // 32px DaisyUI btn-sm where a 48px brand primary was intended. Nothing caught
  // it because an undefined class is not an error anywhere — it is simply
  // ignored, so the button looked plausible and was wrong.
  //
  // Custom properties are checked too, and separately: `bg-[var(--rateloop-x)]`
  // is a different kind of name from `class="rateloop-x"`, and a missing one
  // fails differently — the declaration is dropped rather than the rule.
  const root = new URL("../../../", import.meta.url);
  const sources = execFileSync("git", ["ls-files", "*.tsx"], { cwd: root.pathname, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(name => !name.includes(".test."));

  const classes = new Map<string, string>();
  const properties = new Map<string, string>();
  for (const name of sources) {
    const source = readFileSync(new URL(name, root), "utf8");
    for (const [, attribute] of source.matchAll(/className\s*=\s*\{?("[^"]*"|`[^`]*`|[^}\n]*)/gu)) {
      for (const [token] of attribute!.matchAll(/(?:--)?\brateloop-[a-z\d-]+/gu)) {
        const seen = token.startsWith("--") ? properties : classes;
        if (!seen.has(token)) seen.set(token, name);
      }
    }
  }

  // Guard against the check passing because the scan found nothing.
  assert.ok(classes.size >= 5, `expected branded classes in the tree, found ${classes.size}`);
  assert.ok(properties.size >= 10, `expected branded custom properties, found ${properties.size}`);

  const undefinedClasses = [...classes].filter(([name]) => !new RegExp(`\\.${name}[\\s,:.{]`, "u").test(globals));
  const undefinedProperties = [...properties].filter(([name]) => !globals.includes(`${name}:`));
  assert.deepEqual(
    [...undefinedClasses, ...undefinedProperties].map(([name, file]) => `${name} (${file})`),
    [],
  );
});
