import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("For Agents navigation follows the verified RateLoop browser session", () => {
  const shell = readFileSync(new URL("../TokenlessShell.tsx", import.meta.url), "utf8");
  const sessionButton = readFileSync(new URL("../../thirdweb/ThirdwebSessionButton.tsx", import.meta.url), "utf8");

  assert.match(shell, /authenticated \? links : links\.filter\(link => link\.href !== "\/agents"\)/);
  assert.match(shell, /onSessionChange=\{setAuthenticated\}/);
  assert.match(sessionButton, /onSessionChange\?\.\(value !== null\)/);
  assert.match(sessionButton, /onSessionChange\?\.\(true\)/);
  assert.match(sessionButton, /onSessionChange\?\.\(false\)/);
});
