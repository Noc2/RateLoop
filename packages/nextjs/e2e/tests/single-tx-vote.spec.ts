import { test } from "@playwright/test";

test.describe("Single-transaction vote flow", () => {
  test("ERC-1363 transferAndCall vote path is retired for RBTS", async () => {
    test.skip(true, "RBTS voting uses commitVote writes after redeploy; ERC-1363 transferAndCall is not part of this flow.");
  });
});
