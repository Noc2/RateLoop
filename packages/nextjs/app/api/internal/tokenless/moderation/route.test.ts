import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

const previousToken = process.env.TOKENLESS_PIPELINE_TOKEN;
const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

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

test("moderation compares its pipeline credential in constant time, like the pipeline route", () => {
  assert.match(routeSource, /import \{ createHash, timingSafeEqual \} from "node:crypto";/);
  assert.match(routeSource, /if \(!timingSafeEqual\(supplied, expected\)\)/);
  assert.doesNotMatch(routeSource, /headers\.get\("authorization"\)\s*!==/);
});

test("moderation stays unavailable rather than open when the pipeline credential is unset", async () => {
  delete process.env.TOKENLESS_PIPELINE_TOKEN;
  const response = await GET(
    new NextRequest("https://rateloop-tokenless.example/api/internal/tokenless/moderation?operationKey=operation_123", {
      headers: { authorization: "Bearer anything" },
    }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "pipeline_unavailable");
});
