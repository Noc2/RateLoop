import type { Page } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_SESSION_PATTERN = /^mcps_[A-Za-z0-9_-]{32,128}$/u;

type FetchImplementation = typeof fetch;
type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid response.`);
  }
  return value as JsonObject;
}

async function jsonResponse(response: Response, label: string) {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  return object(value, label);
}

export function sha256Commitment(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function parseOAuthCallback(callbackUrl: string, redirectUri: string, expectedState: string) {
  const callback = new URL(callbackUrl);
  const expected = new URL(redirectUri);
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) {
    throw new Error("The OAuth callback did not match the registered loopback redirect.");
  }
  if (callback.searchParams.get("state") !== expectedState) {
    throw new Error("The OAuth callback state did not match.");
  }
  const code = callback.searchParams.get("code");
  if (!code || callback.searchParams.has("error")) {
    throw new Error("The OAuth callback did not contain an authorization code.");
  }
  return code;
}

export async function authorizeHostedMcpClient(input: {
  baseUrl: string;
  clientName: string;
  fetchImpl?: FetchImplementation;
  page: Page;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const redirectUri = "http://127.0.0.1:43871/oauth/callback";
  const resource = `${input.baseUrl}/api/agent/v1/mcp`;
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomUUID().replaceAll("-", "");
  const registered = await jsonResponse(
    await fetchImpl(`${input.baseUrl}/api/agent/oauth/register`, {
      body: JSON.stringify({
        client_name: input.clientName,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "connection:claim context:read evaluation:read review:decide",
      }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
    }),
    "OAuth client registration",
  );
  const clientId = registered.client_id;
  const scope = registered.scope;
  if (typeof clientId !== "string" || typeof scope !== "string") {
    throw new Error("OAuth client registration omitted its client ID or scope.");
  }

  const authorization = new URL("/agent/oauth/authorize", input.baseUrl);
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    scope,
    state,
  }).toString();
  await input.page.goto(authorization.href, { waitUntil: "domcontentloaded" });
  await input.page.getByRole("heading", { name: `Allow ${input.clientName}?` }).waitFor();
  await input.page.getByRole("button", { name: "Allow connection" }).click();
  const callbackFrame = input.page.locator('iframe[title="Complete agent authentication"]');
  await callbackFrame.waitFor({ state: "attached" });
  const callbackUrl = await callbackFrame.getAttribute("src");
  if (!callbackUrl) throw new Error("The OAuth consent screen did not produce a loopback callback.");
  const code = parseOAuthCallback(callbackUrl, redirectUri, state);

  const tokens = await jsonResponse(
    await fetchImpl(`${input.baseUrl}/api/agent/oauth/token`, {
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource,
      }).toString(),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    }),
    "OAuth token exchange",
  );
  if (typeof tokens.access_token !== "string" || !tokens.access_token) {
    throw new Error("OAuth token exchange omitted the access token.");
  }
  return new HostedMcpClient({
    accessToken: tokens.access_token,
    endpoint: resource,
    fetchImpl,
  });
}

export class HostedMcpClient {
  private nextId = 1;
  private sessionId: string | null = null;

  constructor(
    private readonly input: {
      accessToken: string;
      endpoint: string;
      fetchImpl?: FetchImplementation;
    },
  ) {}

  private async request(value: JsonObject, expectJson = true) {
    const response = await (this.input.fetchImpl ?? fetch)(this.input.endpoint, {
      body: JSON.stringify(value),
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.input.accessToken}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        ...(this.sessionId ? { "MCP-Session-Id": this.sessionId } : {}),
      },
      method: "POST",
    });
    if (!expectJson) {
      if (!response.ok) throw new Error(`MCP notification returned HTTP ${response.status}.`);
      return { body: {}, response };
    }
    const body = await jsonResponse(response, "MCP request");
    return { body, response };
  }

  async initialize(clientName: string) {
    const { body, response } = await this.request({
      id: this.nextId++,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true } },
        clientInfo: { name: clientName, version: "1.0.0" },
      },
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (!sessionId || !MCP_SESSION_PATTERN.test(sessionId)) {
      throw new Error("MCP initialization omitted a valid session ID.");
    }
    this.sessionId = sessionId;
    const result = object(body.result, "MCP initialization");
    if (result.protocolVersion !== MCP_PROTOCOL_VERSION) {
      throw new Error("MCP initialization negotiated an unexpected protocol version.");
    }
    await this.request({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, false);
  }

  async call(name: string, args: JsonObject) {
    if (!this.sessionId) throw new Error("MCP must be initialized before calling tools.");
    const { body } = await this.request({
      id: this.nextId++,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name, arguments: args },
    });
    const result = object(body.result, `MCP tool ${name}`);
    if (result.isError === true) throw new Error(`MCP tool ${name} returned an error.`);
    return object(result.structuredContent, `MCP tool ${name}`);
  }
}
