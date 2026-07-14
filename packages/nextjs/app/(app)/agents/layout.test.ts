import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Agents pages require a verified RateLoop browser session before rendering", () => {
  const source = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

  assert.match(source, /const cookieStore = await cookies\(\)/);
  assert.match(source, /await findAuthSession\(cookieStore\.get\(AUTH_SESSION_COOKIE\)\?\.value\)/);
  assert.match(source, /if \(!session\) redirect\("\/"\)/);
  assert.ok(source.indexOf('if (!session) redirect("/")') < source.indexOf("return children"));
});
