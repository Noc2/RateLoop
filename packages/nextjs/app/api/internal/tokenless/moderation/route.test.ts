import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const previousToken = process.env.TOKENLESS_PIPELINE_TOKEN;

afterEach(() => {
  if (previousToken === undefined) delete process.env.TOKENLESS_PIPELINE_TOKEN;
  else process.env.TOKENLESS_PIPELINE_TOKEN = previousToken;
});

test("public response moderation uses the existing private pipeline credential boundary", async () => {
  process.env.TOKENLESS_PIPELINE_TOKEN = "test-pipeline-token";
  const denied = await GET(
    new NextRequest(
      "https://rateloop-tokenless.example/api/internal/tokenless/moderation?target=public_rater_responses",
    ),
  );
  assert.equal(denied.status, 401);

  const malformed = await POST(
    new NextRequest("https://rateloop-tokenless.example/api/internal/tokenless/moderation", {
      method: "POST",
      headers: { authorization: "Bearer test-pipeline-token", "content-type": "application/json" },
      body: JSON.stringify({
        target: "public_rater_response",
        responseId: "rrs_invalid",
        decision: "delisted",
        reasonCode: "policy_pass",
      }),
    }),
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "invalid_moderation_request");
});
