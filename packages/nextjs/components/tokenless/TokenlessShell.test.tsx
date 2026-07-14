import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("tokenless shell exposes Answer, Ask, Account, and Docs without legacy actions", async () => {
  const source = readFileSync(new URL("./TokenlessShell.tsx", import.meta.url), "utf8");
  assert.match(source, /href: "\/rate", label: "Answer"/);
  assert.match(source, /href: "\/ask", label: "Ask"/);
  assert.match(source, /href: "\/settings", label: "Account"/);
  assert.match(source, /href: "\/docs", label: "Docs"/);
  assert.match(source, /icon: GlobeAltIcon/);
  assert.match(source, /icon: PlusCircleIcon/);
  assert.match(source, /icon: IdentificationIcon/);
  assert.match(source, /icon: BookOpenIcon/);
  assert.match(source, /Human Assurance/);
  assert.match(source, /w-52/);
  assert.match(source, /border-t[^\n]+px-2\.5 pt-4/);
  assert.doesNotMatch(source, /Validate|Earn|Start a validation/);
});

test("tokenless answer search restores the established navbar treatment", () => {
  const source = readFileSync(new URL("./navigation/AnswerSearch.tsx", import.meta.url), "utf8");

  assert.match(source, /MagnifyingGlassIcon/);
  assert.match(source, /border-0 bg-base-content\/\[0\.12\]/);
  assert.match(source, /px-4 text-center/);
  assert.doesNotMatch(source, /input-bordered|header-search-input/);
  assert.match(source, /placeholder="Search"/);
  assert.doesNotMatch(source, /placeholder="Search answers"/);
});
