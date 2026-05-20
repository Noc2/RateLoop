import { POST } from "./route";
import assert from "node:assert/strict";
import test from "node:test";

test("profile follow challenges are retired", async () => {
  const response = await POST();

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    error: "Profile follows are public and on-chain, so signed follow challenges are no longer issued.",
  });
});
