import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as getProfile } from "~~/app/api/account/profile/route";
import { GET as getWallets } from "~~/app/api/account/wallets/route";

test("signed-out account reads consistently return uncached authentication errors", async () => {
  const requests = [
    [getProfile, "/api/account/profile"],
    [getWallets, "/api/account/wallets"],
  ] as const;

  for (const [handler, path] of requests) {
    const response = await handler(new NextRequest(`https://tokenless.example.test${path}`));
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("cache-control"), "no-store", path);
    assert.equal((await response.json()).code, "authentication_required", path);
  }
});
