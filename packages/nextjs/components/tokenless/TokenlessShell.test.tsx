import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("tokenless shell exposes Answer, Ask, Account, and Docs without legacy actions", async () => {
  const source = readFileSync(new URL("./TokenlessShell.tsx", import.meta.url), "utf8");
  assert.match(source, /href: "\/rate", label: "Answer"/);
  assert.match(source, /href: "\/ask", label: "Ask"/);
  assert.match(source, /href: "\/settings", label: "Account"/);
  assert.match(source, /href: "\/docs", label: "Docs"/);
  assert.doesNotMatch(source, /Validate|Earn|Start a validation/);
});
