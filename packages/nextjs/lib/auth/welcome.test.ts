import assert from "node:assert/strict";
import test from "node:test";
import { parseWelcomeChoice, welcomeDestination } from "~~/lib/auth/welcome";

test("welcome choices route to the existing reviewer and agent entry points", () => {
  assert.equal(welcomeDestination("review"), "/human?tab=discover");
  assert.equal(welcomeDestination("invitation"), "/human?tab=discover&invite=1");
  assert.equal(welcomeDestination("agent"), "/agents");
  assert.equal(parseWelcomeChoice("review"), "review");
  assert.equal(parseWelcomeChoice("unknown"), null);
  assert.equal(parseWelcomeChoice(null), null);
});
