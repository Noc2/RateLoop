import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import test from "node:test";
import { POST, __enterpriseAuthRouteTestUtils } from "~~/app/api/auth/better/[...all]/route";

test("direct Better Auth enterprise management endpoints cannot bypass workspace authorization", async () => {
  for (const path of __enterpriseAuthRouteTestUtils.blockedManagementPaths) {
    const response = await POST(
      new NextRequest(`https://rateloop.test/api/auth/better${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: "Use workspace identity settings." });
  }
});

test("SCIM active mutation parser accepts RFC 7644 path and value-object forms", () => {
  const parse = __enterpriseAuthRouteTestUtils.scimActiveMutation;
  assert.equal(parse({ Operations: [{ op: "replace", path: "active", value: false }] }), false);
  assert.equal(parse({ Operations: [{ op: "replace", path: "/ACTIVE", value: true }] }), true);
  assert.equal(parse({ Operations: [{ op: "replace", value: { active: false } }] }), false);
  assert.equal(parse({ Operations: [{ op: "replace", path: "displayName", value: "Ada" }] }), null);
});
