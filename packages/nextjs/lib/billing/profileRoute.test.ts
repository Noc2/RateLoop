import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, PATCH } from "~~/app/api/account/workspaces/[workspaceId]/billing/profile/route";

const context = { params: Promise.resolve({ workspaceId: "ws_acme" }) };

test("billing profile route requires a browser session and disables shared caching", async () => {
  const response = await GET(
    new NextRequest("https://tokenless.example.test/api/account/workspaces/ws_acme/billing/profile"),
    context,
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal((await response.json()).code, "authentication_required");
});

test("billing profile mutations reject cross-origin requests before reading a session", async () => {
  const response = await PATCH(
    new NextRequest("https://tokenless.example.test/api/account/workspaces/ws_acme/billing/profile", {
      body: JSON.stringify({ legalName: "Acme", registeredAddress: "Berlin" }),
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      method: "PATCH",
    }),
    context,
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "invalid_origin");
});
