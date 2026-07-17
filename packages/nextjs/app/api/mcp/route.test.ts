import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET, OPTIONS, POST } from "~~/app/api/mcp/route";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const originalRateLimitSecret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;

function request(
  value: unknown,
  options: { headers?: Record<string, string>; method?: string; rawBody?: string } = {},
) {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/mcp", {
    body: options.rawBody ?? JSON.stringify(value),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "x-real-ip": "203.0.113.10",
      ...options.headers,
    },
    method: options.method ?? "POST",
  });
}

async function body(response: Response) {
  return (await response.json()) as Record<string, any>;
}

beforeEach(() => {
  process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = "test-only-rate-limit-secret-with-at-least-32-characters";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalRateLimitSecret === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = originalRateLimitSecret;
});

test("implements initialization, ping, and notification semantics", async () => {
  const initialized = await POST(
    request({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: { capabilities: {}, clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-11-25" },
    }),
  );
  const initializedBody = await body(initialized);
  assert.equal(initialized.status, 200);
  assert.equal(initialized.headers.get("cache-control"), "no-store");
  assert.equal(initializedBody.result.protocolVersion, "2025-11-25");
  assert.deepEqual(initializedBody.result.capabilities, { tools: {} });

  const pinged = await POST(
    request(
      { id: "ping", jsonrpc: "2.0", method: "ping" },
      { headers: { "mcp-protocol-version": "2025-03-26", "x-real-ip": "203.0.113.11" } },
    ),
  );
  assert.deepEqual((await body(pinged)).result, {});

  const negotiated = await POST(
    request(
      {
        id: "negotiate",
        jsonrpc: "2.0",
        method: "initialize",
        params: { capabilities: {}, clientInfo: { name: "older-test", version: "1" }, protocolVersion: "2024-11-05" },
      },
      { headers: { "mcp-protocol-version": "2025-06-18", "x-real-ip": "203.0.113.19" } },
    ),
  );
  assert.equal((await body(negotiated)).result.protocolVersion, "2025-11-25");

  const notification = await POST(
    request(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { headers: { "mcp-protocol-version": "2025-11-25", "x-real-ip": "203.0.113.12" } },
    ),
  );
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), "");
});

test("lists exactly the four browser handoff tools and reports live capabilities", async () => {
  const listed = await POST(request({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }));
  const listedBody = await body(listed);
  assert.deepEqual(
    listedBody.result.tools.map((tool: { name: string }) => tool.name),
    ["rateloop_capabilities", "rateloop_create_handoff", "rateloop_get_handoff_status", "rateloop_get_result"],
  );
  assert.deepEqual(
    listedBody.result.tools.map((tool: { annotations: Record<string, boolean>; title: string }) => ({
      annotations: tool.annotations,
      title: tool.title,
    })),
    [
      {
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
        title: "Get RateLoop capabilities",
      },
      {
        annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
        title: "Create human-assurance handoff",
      },
      {
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
        title: "Get handoff status",
      },
      {
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true },
        title: "Get assurance result",
      },
    ],
  );
  assert.equal(JSON.stringify(listedBody).includes("rateloop_quote"), false);
  assert.equal(JSON.stringify(listedBody).includes("rateloop_ask"), false);

  const capabilities = await POST(
    request(
      {
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "rateloop_capabilities" },
      },
      { headers: { "x-real-ip": "203.0.113.13" } },
    ),
  );
  const capabilitiesBody = await body(capabilities);
  assert.deepEqual(capabilitiesBody.result.structuredContent.allowedAudienceSources, [
    "customer_invited",
    "rateloop_network",
    "hybrid",
  ]);
  assert.equal(capabilitiesBody.result.structuredContent.handoffVersion, "rateloop.handoff.v1");
});

test("returns tool validation errors as successful MCP tool results", async () => {
  const response = await POST(
    request({
      id: 4,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        arguments: {
          confirmedNoSensitiveData: false,
          dataClassification: "redacted",
          redactionSummary: "All sensitive fields were removed.",
          request: {},
        },
        name: "rateloop_create_handoff",
      },
    }),
  );
  const responseBody = await body(response);
  assert.equal(response.status, 200);
  assert.equal(responseBody.result.isError, true);
  assert.equal(responseBody.result.structuredContent.code, "sensitive_data_confirmation_required");
});

test("enforces same-origin browser access, Streamable HTTP headers, and body limits", async () => {
  const preflight = await OPTIONS(
    request(null, {
      headers: { origin: "https://rateloop-tokenless.vercel.app" },
      method: "OPTIONS",
      rawBody: "",
    }),
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://rateloop-tokenless.vercel.app");
  assert.equal(preflight.headers.get("cache-control"), "no-store");

  const forbidden = await POST(
    request({ id: 5, jsonrpc: "2.0", method: "ping" }, { headers: { origin: "https://attacker.example" } }),
  );
  assert.equal(forbidden.status, 403);
  assert.equal((await body(forbidden)).error.data.code, "origin_forbidden");

  const invalidAccept = await POST(
    request(
      { id: 6, jsonrpc: "2.0", method: "ping" },
      { headers: { accept: "application/json", "x-real-ip": "203.0.113.14" } },
    ),
  );
  assert.equal(invalidAccept.status, 406);

  const unsupportedVersion = await POST(
    request(
      { id: 7, jsonrpc: "2.0", method: "ping" },
      { headers: { "mcp-protocol-version": "2024-11-05", "x-real-ip": "203.0.113.15" } },
    ),
  );
  assert.equal(unsupportedVersion.status, 400);
  assert.equal((await body(unsupportedVersion)).error.data.code, "unsupported_protocol_version");

  const oversized = await POST(
    request(
      { id: 8, jsonrpc: "2.0", method: "ping" },
      { headers: { "content-length": String(64 * 1_024 + 1), "x-real-ip": "203.0.113.16" } },
    ),
  );
  assert.equal(oversized.status, 413);

  const malformed = await POST(request(null, { headers: { "x-real-ip": "203.0.113.17" }, rawBody: "{" }));
  assert.equal(malformed.status, 400);
  assert.equal((await body(malformed)).error.code, -32700);
});

test("GET is disabled and same-origin POST responses carry CORS without caching", async () => {
  const getResponse = await GET();
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get("allow"), "POST, OPTIONS");

  const response = await POST(
    request(
      { id: 9, jsonrpc: "2.0", method: "ping" },
      { headers: { origin: "https://rateloop-tokenless.vercel.app", "x-real-ip": "203.0.113.18" } },
    ),
  );
  assert.equal(response.headers.get("access-control-allow-origin"), "https://rateloop-tokenless.vercel.app");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("returns HTTP 429 after 60 requests from one caller", async () => {
  let response: Response | null = null;
  for (let count = 1; count <= 61; count += 1) {
    response = await POST(
      request({ id: count, jsonrpc: "2.0", method: "ping" }, { headers: { "x-real-ip": "203.0.113.60" } }),
    );
  }
  assert.ok(response);
  assert.equal(response.status, 429);
  assert.match(response.headers.get("retry-after") ?? "", /^\d+$/);
  assert.equal((await body(response)).error.data.code, "rate_limit_exceeded");
});
