import { NextRequest } from "next/server";
import { POST } from "./route";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { questionDetailsHashInput } from "~~/lib/attachments/questionDetails.shared";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testMemory";

const env = process.env as Record<string, string | undefined>;
const originalAgents = env.RATELOOP_MCP_AGENTS;
const originalAppUrl = env.APP_URL;
const originalDatabaseUrl = env.DATABASE_URL;
const originalModerationMode = env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE;
const originalOpenAiKey = env.OPENAI_API_KEY;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function uploadRequest(detailsId: string) {
  const text = "Private details that should not be echoed from database errors.";
  const normalizedText = text.trim();
  const sha256 = createHash("sha256")
    .update(questionDetailsHashInput({ detailsId, normalizedText, requiresGatedAccess: true }), "utf8")
    .digest("hex");

  return new NextRequest("https://rateloop.ai/api/attachments/details/upload", {
    body: JSON.stringify({
      address: "0x00000000000000000000000000000000000000aa",
      detailsId,
      requiresGatedAccess: true,
      sha256,
      sizeBytes: new TextEncoder().encode(normalizedText).byteLength,
      text,
    }),
    headers: new Headers({
      authorization: "Bearer secret-token",
      "content-type": "application/json",
    }),
    method: "POST",
  });
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  env.APP_URL = "https://www.rateloop.ai";
  env.DATABASE_URL = "memory:";
  env.RATELOOP_MCP_AGENTS = JSON.stringify([
    {
      dailyBudgetAtomic: "5000000",
      id: "details-agent",
      perAskLimitAtomic: "1000000",
      scopes: ["rateloop:ask"],
      token: "secret-token",
      walletAddress: "0x00000000000000000000000000000000000000aa",
    },
  ]);
  env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE = "disabled";
  delete env.OPENAI_API_KEY;
});

after(() => {
  __setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("OPENAI_API_KEY", originalOpenAiKey);
  restoreEnv("RATELOOP_MCP_AGENTS", originalAgents);
  restoreEnv("RATELOOP_QUESTION_DETAILS_MODERATION_MODE", originalModerationMode);
});

test("details upload applies the pending gated attachment migration before insert", async () => {
  await dbClient.execute("ALTER TABLE question_details DROP COLUMN requires_gated_access");

  const response = await POST(uploadRequest("det_routemissinggateddetail"));
  const body = (await response.json()) as { status?: string };

  assert.equal(response.status, 200);
  assert.equal(body.status, "approved");

  const rows = await dbClient.execute(
    "SELECT requires_gated_access FROM question_details WHERE id = 'det_routemissinggateddetail'",
  );
  assert.equal(rows.rows[0]?.requires_gated_access, true);
});
