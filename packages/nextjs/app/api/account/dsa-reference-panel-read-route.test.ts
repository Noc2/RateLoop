import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDsaReferencePanelPilotGet,
  createDsaReferencePanelPilotPost,
} from "~~/app/api/account/compliance/dsa/reference-panel/route";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const NO_STORE = "private, no-store, max-age=0";

test("global reference-panel GET requires browser authentication", async () => {
  let projectionCalled = false;
  const get = createDsaReferencePanelPilotGet({
    async requireSession() {
      throw new TokenlessServiceError("Authentication is required.", 401, "authentication_required");
    },
    async readPilot() {
      projectionCalled = true;
      return { epochs: [], adjudications: [] };
    },
  });

  const response = await get(
    new NextRequest("https://tokenless.example.test/api/account/compliance/dsa/reference-panel"),
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
  assert.equal(projectionCalled, false);
});

test("global reference-panel GET scopes discovery to the authenticated principal", async () => {
  let projectedPrincipal: string | null = null;
  const calls: string[] = [];
  const get = createDsaReferencePanelPilotGet({
    async requireSession() {
      return { principalId: "rlp_abcdefghijklmnopqrstuvwxyz" };
    },
    async readPilot(input) {
      calls.push(`read:${input.accountAddress}`);
      projectedPrincipal = input.accountAddress;
      return { epochs: [], adjudications: [] };
    },
  });

  const response = await get(
    new NextRequest("https://tokenless.example.test/api/account/compliance/dsa/reference-panel"),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
  assert.equal(projectedPrincipal, "rlp_abcdefghijklmnopqrstuvwxyz");
  assert.deepEqual(calls, ["read:rlp_abcdefghijklmnopqrstuvwxyz"]);
  assert.deepEqual(await response.json(), { epochs: [], adjudications: [] });
});

test("global reference-panel POST requires mutation authentication and an exact reconciliation action", async () => {
  const calls: string[] = [];
  const post = createDsaReferencePanelPilotPost({
    async requireSession(_request, options) {
      assert.deepEqual(options, { mutation: true });
      return { principalId: "rlp_abcdefghijklmnopqrstuvwxyz" };
    },
    async reconcileResponses(input) {
      calls.push(input.accountAddress);
      return {
        attemptedUnitCount: 1,
        failedUnitCount: 1,
        completedUnitCount: 0,
        materializedResponseCount: 0,
        retryingUnitCount: 1,
        cooldownUnitCount: 0,
      };
    },
  });
  const response = await post(
    new NextRequest("https://tokenless.example.test/api/account/compliance/dsa/reference-panel", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://tokenless.example.test" },
      body: JSON.stringify({ action: "reconcile_response_evidence" }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
  assert.deepEqual(calls, ["rlp_abcdefghijklmnopqrstuvwxyz"]);
  assert.deepEqual(await response.json(), {
    attemptedUnitCount: 1,
    failedUnitCount: 1,
    completedUnitCount: 0,
    materializedResponseCount: 0,
    retryingUnitCount: 1,
    cooldownUnitCount: 0,
  });
});

test("global reference-panel POST rejects unsupported fields before reconciliation", async () => {
  let reconciliationCalled = false;
  const post = createDsaReferencePanelPilotPost({
    async requireSession() {
      return { principalId: "rlp_abcdefghijklmnopqrstuvwxyz" };
    },
    async reconcileResponses() {
      reconciliationCalled = true;
    },
  });
  const response = await post(
    new NextRequest("https://tokenless.example.test/api/account/compliance/dsa/reference-panel", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://tokenless.example.test" },
      body: JSON.stringify({ action: "reconcile_response_evidence", unitId: "private-unit" }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), NO_STORE);
  assert.equal(reconciliationCalled, false);
});

test("global reference-panel POST preserves manager/auditor service denial for unauthorized principals", async () => {
  const post = createDsaReferencePanelPilotPost({
    async requireSession() {
      return { principalId: "rlp_unauthorized_reviewer" };
    },
    async reconcileResponses() {
      throw new TokenlessServiceError(
        "DSA reference-panel assignment not found.",
        404,
        "dsa_named_panel_assignment_not_found",
      );
    },
  });
  const response = await post(
    new NextRequest("https://tokenless.example.test/api/account/compliance/dsa/reference-panel", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://tokenless.example.test" },
      body: JSON.stringify({ action: "reconcile_response_evidence" }),
    }),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    code: "dsa_named_panel_assignment_not_found",
    message: "DSA reference-panel assignment not found.",
    retryable: false,
  });
});
