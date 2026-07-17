import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("tokenless shell exposes Humans, Agents, and Docs without the legacy product navigation", async () => {
  const source = readFileSync(new URL("./TokenlessShell.tsx", import.meta.url), "utf8");
  assert.match(source, /href: "\/human", label: "Humans"/);
  assert.match(source, /href: "\/agents", label: "Agents"/);
  assert.doesNotMatch(source, /For Humans|For Agents/);
  assert.match(source, /href: "\/docs", label: "Docs"/);
  assert.match(source, /\["Pricing", "\/pricing"\]/);
  assert.match(source, /href="\/pricing"/);
  assert.match(source, /icon: GlobeAltIcon/);
  assert.match(source, /icon: PlusCircleIcon/);
  assert.match(source, /icon: BookOpenIcon/);
  assert.doesNotMatch(source, /ShieldCheckIcon/);
  assert.match(source, /Human Assurance/);
  assert.match(source, /w-52/);
  assert.match(source, /border-t[^\n]+px-2\.5 pt-4/);
  assert.match(source, /import \{ SiteSearch \}/);
  assert.match(source, /<SiteSearch mobile \/>/);
  assert.match(source, /<SiteSearch \/>/);
  assert.doesNotMatch(source, /href: "\/(rate|ask|settings)"|Validate|Earn|Start a validation/);
});

test("tokenless navigation uses the shared page background", () => {
  const source = readFileSync(new URL("./TokenlessShell.tsx", import.meta.url), "utf8");

  assert.match(source, /<header className="[^"]*bg-base-100/);
  assert.match(source, /<aside className="[^"]*bg-base-100/);
  assert.doesNotMatch(source, /bg-black(?:\/\d+)?/);
});

test("tokenless site search restores the established navbar treatment", () => {
  const source = readFileSync(new URL("./navigation/SiteSearch.tsx", import.meta.url), "utf8");

  assert.match(source, /MagnifyingGlassIcon/);
  assert.match(source, /border-0 bg-base-content\/\[0\.12\]/);
  assert.match(source, /!shadow-none/);
  assert.match(source, /px-4 text-center/);
  assert.doesNotMatch(source, /input-bordered|header-search-input/);
  assert.match(source, /placeholder="Search"/);
  assert.match(source, /const SEARCH_ROUTE = "\/search"/);
  assert.match(source, /SEARCH_DEBOUNCE_MS = 200/);
  assert.match(source, /aria-label="Search RateLoop"/);
  assert.doesNotMatch(source, /placeholder="Search answers"/);
});
