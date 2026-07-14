import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("For Agents navigation stays visible while session-aware controls track the browser session", () => {
  const shell = readFileSync(new URL("../TokenlessShell.tsx", import.meta.url), "utf8");
  const sessionButton = readFileSync(new URL("../../thirdweb/ThirdwebSessionButton.tsx", import.meta.url), "utf8");

  assert.match(shell, /links\.map\(\(\{ href, label, icon: Icon \}\) =>/);
  assert.doesNotMatch(shell, /filter\(link => link\.href !== "\/agents"\)/);
  assert.match(sessionButton, /onSessionChange\?\.\(value !== null\)/);
  assert.match(sessionButton, /onSessionChange\?\.\(true\)/);
  assert.match(sessionButton, /onSessionChange\?\.\(false\)/);
});
