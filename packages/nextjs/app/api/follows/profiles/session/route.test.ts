import { NextRequest } from "next/server";
import { GET } from "./route";
import assert from "node:assert/strict";
import test from "node:test";

test("profile follow sessions are retired", async () => {
  const response = await GET(
    new NextRequest(
      "https://curyo.xyz/api/follows/profiles/session?address=0x63cada40e8acf7a1d47229af5be35b78b16035fa",
    ),
  );

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    error: "Profile follows are public and no longer use signed read or write sessions.",
    hasSession: false,
    hasReadSession: false,
    hasWriteSession: false,
  });
});
