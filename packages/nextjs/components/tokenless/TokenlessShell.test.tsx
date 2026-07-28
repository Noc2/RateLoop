import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource = readFileSync(new URL("./TokenlessShell.tsx", import.meta.url), "utf8");

test("tokenless shell exposes Humans, Agents, and Docs without the legacy product navigation", async () => {
  const source = shellSource;
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
  assert.match(source, /import \{ Suspense \} from "react"/);
  assert.match(source, /<Suspense fallback=.*?>\s*<SiteSearch mobile \/>/s);
  assert.match(source, /<Suspense fallback=.*?>\s*<SiteSearch \/>/s);
  assert.match(source, /<SiteSearch mobile \/>/);
  assert.match(source, /<SiteSearch \/>/);
  assert.doesNotMatch(source, /href: "\/(rate|ask|settings)"|Validate|Earn|Start a validation/);
});

test("tokenless navigation uses the shared page background", () => {
  const source = shellSource;

  assert.match(source, /<header className="[^"]*bg-base-100/);
  assert.match(source, /<aside className="[^"]*bg-base-100/);
  assert.doesNotMatch(source, /bg-black(?:\/\d+)?/);
});

test("tokenless routes expose one main landmark and a keyboard skip link", () => {
  assert.match(shellSource, /href="#main-content"/);
  assert.match(shellSource, /Skip to main content/);
  assert.match(shellSource, /focus:not-sr-only/);
  assert.match(shellSource, /<main[\s\S]*id="main-content"[\s\S]*tabIndex=\{-1\}/);

  const nestedSurfaces = [
    "../../app/(app)/settings/wallets/page.tsx",
    "../../app/(public)/agent/oauth/authorize/page.tsx",
    "../../app/(public)/agent/oauth/device/page.tsx",
    "../../app/(public)/connect/[intentId]/not-found.tsx",
    "../../app/(public)/connect/[intentId]/page.tsx",
    "./TokenlessHandoffClient.tsx",
  ];
  for (const path of nestedSurfaces) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /<main\b/, `${path} must use the shared shell main landmark`);
  }
});

test("the root not-found route has its own landmark and descriptive title", () => {
  const source = readFileSync(new URL("../../app/not-found.tsx", import.meta.url), "utf8");

  assert.match(source, /title: "Page not found \| RateLoop"/);
  assert.match(source, /<main[\s\S]*id="main-content"[\s\S]*tabIndex=\{-1\}/);
});

test("tokenless site search keeps the navbar treatment with explicit submission", () => {
  const source = readFileSync(new URL("./navigation/SiteSearch.tsx", import.meta.url), "utf8");

  assert.match(source, /MagnifyingGlassIcon/);
  assert.match(source, /border-0 bg-base-content\/\[0\.12\]/);
  assert.match(source, /!shadow-none/);
  assert.match(source, /pl-3 pr-16 text-base/);
  assert.doesNotMatch(source, /input-bordered|header-search-input/);
  assert.match(source, /placeholder="Search"/);
  assert.match(source, /const SEARCH_ROUTE = "\/search"/);
  assert.match(source, /<form onSubmit=\{submit\}/);
  assert.match(source, /type="submit"/);
  assert.doesNotMatch(source, /SEARCH_DEBOUNCE_MS/);
  assert.match(source, /aria-label="Search RateLoop"/);
  assert.doesNotMatch(source, /placeholder="Search answers"/);
});
