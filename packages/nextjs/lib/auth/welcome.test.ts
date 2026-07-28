import assert from "node:assert/strict";
import test from "node:test";
import { parseWelcomeChoice, welcomeDestination } from "~~/lib/auth/welcome";

test("welcome choices route to the existing reviewer and agent entry points", () => {
  assert.equal(welcomeDestination("review"), "/human/review");
  assert.equal(welcomeDestination("invitation"), "/human/review?invite=1");
  assert.equal(welcomeDestination("agent"), "/agents/overview");
  assert.equal(parseWelcomeChoice("review"), "review");
  assert.equal(parseWelcomeChoice("unknown"), null);
  assert.equal(parseWelcomeChoice(null), null);
});

test("welcome choices reject inherited object prototype keys", () => {
  for (const inherited of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
    assert.equal(parseWelcomeChoice(inherited), null, `${inherited} must not resolve to a welcome destination`);
  }
});
