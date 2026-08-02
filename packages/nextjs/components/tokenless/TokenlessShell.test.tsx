import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellMessages = readFileSync(new URL("../../messages/en/shell.json", import.meta.url), "utf8");
const shellSource = [readFileSync(new URL("./TokenlessShell.tsx", import.meta.url), "utf8"), shellMessages].join("\n");
const globalStyles = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");

test("tokenless shell exposes Humans, Agents, and Docs without the legacy product navigation", async () => {
  const source = shellSource;
  assert.match(source, /href: "\/human\/review", labelKey: "humans"/);
  assert.match(source, /href: "\/agents\/overview", labelKey: "agents"/);
  assert.doesNotMatch(source, /For Humans|For Agents/);
  assert.match(source, /href: "\/docs", labelKey: "docs"/);
  assert.match(source, /\["pricing", "\/pricing"\]/);
  assert.match(source, /publicHref\("\/pricing"\)/);
  assert.match(source, /icon: GlobeAltIcon/);
  assert.match(source, /icon: PlusCircleIcon/);
  assert.match(source, /icon: BookOpenIcon/);
  assert.doesNotMatch(source, /ShieldCheckIcon/);
  assert.match(source, /Human Assurance/);
  assert.match(source, /w-52/);
  assert.match(source, /border-t[^\n]+px-2\.5 pt-4/);
  assert.match(source, /import \{ SiteSearch \}/);
  assert.match(source, /import \{ Suspense/);
  assert.match(source, /<Suspense fallback=.*?>\s*<SiteSearch mobile \/>/s);
  assert.match(source, /<Suspense fallback=.*?>\s*<SiteSearch \/>/s);
  assert.match(source, /<SiteSearch mobile \/>/);
  assert.match(source, /<SiteSearch \/>/);
  assert.doesNotMatch(source, /href: "\/(rate|ask|settings)"|Validate|Earn|Start a validation/);
});

test("tokenless navigation uses the shared page background", () => {
  const source = shellSource;

  assert.match(source, /<header className="[^"]*bg-base-100/);
  assert.match(source, /<aside[\s\S]*data-rateloop-rail[\s\S]*bg-base-100/);
  assert.doesNotMatch(globalStyles, /--rateloop-rail-(?:surface|text|border)/);
  assert.doesNotMatch(globalStyles, /\[data-rateloop-rail\]\s*\{/);
});

test("shell sign-in actions preserve the current destination", () => {
  assert.match(shellSource, /useSearchParams\(\)\.toString\(\)/);
  assert.match(shellSource, /<ThirdwebSessionButton compact=\{compact\} returnTo=\{returnTo\}/);
});

test("public content keeps a quiet validated return to the originating workspace", () => {
  assert.match(shellSource, /workspaceReturnPathForLocation/);
  assert.match(shellSource, /workspacePublicContentHref/);
  assert.match(shellSource, /function WorkspaceReturnLink/);
  assert.match(shellSource, /"back": "Back to workspace"/);
  assert.match(shellSource, /isPublicContentPath\(pathname\)/);
  assert.match(shellSource, /href=\{publicHref\(link\.href\)\}/);
});

test("Docs sub-navigation uses the longest matching route", () => {
  assert.match(shellSource, /import \{ DOCS_NAV, resolveActiveDocsHref \}/);
  assert.match(shellSource, /const activeDocsHref = resolveActiveDocsHref\(pathname\)/);
  assert.match(shellSource, /const linkActive = activeDocsHref === link\.href/);
  assert.doesNotMatch(shellSource, /const linkActive = pathname === link\.href/);
  assert.match(shellSource, /aria-current=\{active \? "location" : undefined\}/);
  assert.match(shellSource, /aria-current=\{linkActive \? "page" : undefined\}/);
});

test("mobile navigation describes and closes its current state", () => {
  assert.match(shellSource, /const \[mobileNavOpen, setMobileNavOpen\] = useState\(false\)/);
  assert.match(shellSource, /useEffect\(\(\) => setMobileNavOpen\(false\), \[pathname\]\)/);
  assert.match(shellSource, /aria-label=\{mobileNavOpen \? t\("navigation\.close"\) : t\("navigation\.open"\)\}/);
  assert.match(shellSource, /<NavLinks mobile onNavigate=\{\(\) => setMobileNavOpen\(false\)\} \/>/);
});

test("tokenless routes expose one main landmark and a keyboard skip link", () => {
  assert.match(shellSource, /href="#main-content"/);
  assert.match(shellSource, /"skipToContent": "Skip to main content"/);
  assert.match(shellSource, /focus:not-sr-only/);
  assert.match(shellSource, /<main[\s\S]*id="main-content"[\s\S]*tabIndex=\{-1\}/);

  const nestedSurfaces = [
    "../../app/[locale]/(app)/settings/wallets/page.tsx",
    "../../app/[locale]/(public)/agent/oauth/authorize/page.tsx",
    "../../app/[locale]/(public)/agent/oauth/device/page.tsx",
    "../../app/[locale]/(public)/connect/[intentId]/not-found.tsx",
    "../../app/[locale]/(public)/connect/[intentId]/page.tsx",
    "./TokenlessHandoffClient.tsx",
  ];
  for (const path of nestedSurfaces) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /<main\b/, `${path} must use the shared shell main landmark`);
  }
});

test("root recovery routes use the shell's single landmark", () => {
  const notFoundSource = readFileSync(new URL("../../app/not-found.tsx", import.meta.url), "utf8");
  const errorSource = readFileSync(new URL("../../app/error.tsx", import.meta.url), "utf8");
  const recoverySource = readFileSync(new URL("./RootRecoverySurface.tsx", import.meta.url), "utf8");

  assert.match(notFoundSource, /title: "Page not found"/);
  for (const source of [notFoundSource, errorSource]) {
    assert.match(source, /import \{ TokenlessShell \}/);
    assert.match(source, /<TokenlessShell>/);
    assert.match(source, /<RootRecoverySurface/);
    assert.doesNotMatch(source, /<main\b/);
  }
  assert.doesNotMatch(recoverySource, /<main\b/);
  assert.equal(shellSource.match(/<main\b/g)?.length, 1);
});

test("tokenless site search keeps the navbar treatment with explicit submission", () => {
  const source = [readFileSync(new URL("./navigation/SiteSearch.tsx", import.meta.url), "utf8"), shellMessages].join(
    "\n",
  );

  assert.match(source, /MagnifyingGlassIcon/);
  assert.match(source, /border-0 bg-base-content\/\[0\.12\]/);
  assert.match(source, /!shadow-none/);
  assert.match(source, /pl-3 pr-16 text-base/);
  assert.doesNotMatch(source, /input-bordered|header-search-input/);
  assert.match(source, /placeholder=\{t\("placeholder"\)\}/);
  assert.match(source, /const SEARCH_ROUTE = "\/search"/);
  assert.match(source, /<form onSubmit=\{submit\}/);
  assert.match(source, /type="submit"/);
  assert.doesNotMatch(source, /SEARCH_DEBOUNCE_MS/);
  assert.match(source, /aria-label=\{t\("label"\)\}/);
  assert.doesNotMatch(source, /placeholder="Search answers"/);
});
