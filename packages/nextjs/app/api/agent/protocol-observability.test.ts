import { NextRequest } from "next/server";
import { POST as exchangeToken } from "./oauth/token/route";
import { POST as callWorkspaceMcp } from "./v1/mcp/route";
import assert from "node:assert/strict";
import test from "node:test";

test("OAuth token and workspace MCP failures share credential-free structured diagnostics", async () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = line => lines.push(String(line));
  try {
    const oauth = await exchangeToken(
      new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/oauth/token", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "code=oauth-secret&client_id=private-client",
      }),
    );
    const mcp = await callWorkspaceMcp(
      new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/mcp", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ access_token: "bearer-secret" }),
      }),
    );
    assert.equal(oauth.status, 415);
    assert.equal(mcp.status, 415);
  } finally {
    console.info = original;
  }

  assert.deepEqual(
    lines.map(line => JSON.parse(line)),
    [
      {
        event: "agent_protocol_request_failed",
        endpoint: "oauth_token",
        method: "POST",
        status: 415,
        errorCode: "invalid_request",
      },
      {
        event: "agent_protocol_request_failed",
        endpoint: "workspace_mcp",
        method: "POST",
        status: 415,
        errorCode: "invalid_content_type",
      },
    ],
  );
  assert.doesNotMatch(lines.join("\n"), /oauth-secret|private-client|bearer-secret/u);
});
