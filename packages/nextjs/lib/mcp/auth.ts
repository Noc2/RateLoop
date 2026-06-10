import { createHash } from "crypto";
import { getMcpAgentFromPolicyTokenHash, hashMcpBearerToken } from "~~/lib/agent/policies";

/**
 * MCP auth is intentionally opaque bearer only for now. The server hash-matches
 * self-issued static/policy tokens and does not validate JWT aud/resource
 * claims, so protected-resource metadata must not advertise an external OAuth
 * authorization server until audience-bound JWT validation is implemented.
 */
export const MCP_AUTHENTICATION_SCHEME = "opaque_bearer" as const;
export type McpAuthenticationScheme = typeof MCP_AUTHENTICATION_SCHEME;

export const MCP_SCOPES = {
  ask: "rateloop:ask",
  balance: "rateloop:balance",
  quote: "rateloop:quote",
  rate: "rateloop:rate",
  read: "rateloop:read",
} as const;

export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];

export type McpAgentAuth = {
  allowedCategoryIds: Set<string> | null;
  dailyBudgetAtomic: bigint;
  id: string;
  perAskLimitAtomic: bigint;
  scopes: Set<string>;
  tokenHash: string;
  walletAddress: string | null;
};

export class McpAuthError extends Error {
  readonly status: number;
  readonly requiredScope?: string;

  constructor(message: string, status = 401, requiredScope?: string) {
    super(message);
    this.name = "McpAuthError";
    this.status = status;
    this.requiredScope = requiredScope;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseAtomicAmount(value: unknown, fieldName: string): bigint {
  const rawValue =
    typeof value === "number" || typeof value === "string" || typeof value === "bigint" ? String(value) : "";
  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error(`${fieldName} must be a non-negative integer string.`);
  }
  return BigInt(rawValue);
}

function parseBooleanEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeConfiguredAgent(value: unknown): McpAgentAuth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const tokenHash = typeof entry.tokenHash === "string" ? entry.tokenHash.trim().toLowerCase() : "";
  const token = typeof entry.token === "string" ? entry.token : "";
  const hash = tokenHash || (token ? sha256(token) : "");
  if (!id || !/^[a-f0-9]{64}$/.test(hash)) return null;

  const scopes = new Set(asStringArray(entry.scopes));
  const categories = asStringArray(entry.categories)
    .map(category => category.trim())
    .filter(Boolean);

  return {
    allowedCategoryIds: categories.length > 0 ? new Set(categories) : null,
    dailyBudgetAtomic: parseAtomicAmount(entry.dailyBudgetAtomic ?? entry.dailyBudget ?? "0", "dailyBudgetAtomic"),
    id,
    perAskLimitAtomic: parseAtomicAmount(entry.perAskLimitAtomic ?? entry.perAskLimit ?? "0", "perAskLimitAtomic"),
    scopes,
    tokenHash: hash,
    walletAddress: typeof entry.walletAddress === "string" ? entry.walletAddress.trim() || null : null,
  };
}

export function getConfiguredMcpAgents(): McpAgentAuth[] {
  const rawConfig = process.env.RATELOOP_MCP_AGENTS?.trim();
  if (rawConfig) {
    try {
      const parsed = JSON.parse(rawConfig);
      return Array.isArray(parsed)
        ? parsed.map(normalizeConfiguredAgent).filter((agent): agent is McpAgentAuth => agent !== null)
        : [];
    } catch {
      return [];
    }
  }

  const token = process.env.RATELOOP_MCP_BEARER_TOKEN?.trim();
  if (!token) return [];

  const scopes = process.env.RATELOOP_MCP_BEARER_SCOPES?.split(",")
    .map(scope => scope.trim())
    .filter(Boolean) ?? [MCP_SCOPES.ask, MCP_SCOPES.balance, MCP_SCOPES.quote, MCP_SCOPES.rate, MCP_SCOPES.read];
  const dailyBudgetAtomic = parseAtomicAmount(
    process.env.RATELOOP_MCP_DAILY_BUDGET_USDC ?? "0",
    "RATELOOP_MCP_DAILY_BUDGET_USDC",
  );
  const perAskLimitAtomic = parseAtomicAmount(
    process.env.RATELOOP_MCP_PER_ASK_LIMIT_USDC ?? "0",
    "RATELOOP_MCP_PER_ASK_LIMIT_USDC",
  );
  const allowUnlimitedBudget = parseBooleanEnv(process.env.RATELOOP_MCP_ALLOW_UNLIMITED_BUDGET);

  if (scopes.includes(MCP_SCOPES.ask) && !allowUnlimitedBudget) {
    if (dailyBudgetAtomic <= 0n || perAskLimitAtomic <= 0n) {
      throw new Error(
        "RATELOOP_MCP_DAILY_BUDGET_USDC and RATELOOP_MCP_PER_ASK_LIMIT_USDC must be positive for static rateloop:ask tokens, or set RATELOOP_MCP_ALLOW_UNLIMITED_BUDGET=true.",
      );
    }
  }

  return [
    {
      allowedCategoryIds: null,
      dailyBudgetAtomic,
      id: process.env.RATELOOP_MCP_AGENT_ID?.trim() || "default",
      perAskLimitAtomic,
      scopes: new Set(scopes),
      tokenHash: sha256(token),
      walletAddress: process.env.RATELOOP_MCP_WALLET_ADDRESS?.trim() || null,
    },
  ];
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function buildMcpAuthChallenge(params: { metadataUrl: string; scope?: string }) {
  const scope = params.scope ? `, scope="${params.scope}"` : "";
  return `Bearer realm="rateloop-mcp", resource_metadata="${params.metadataUrl}"${scope}`;
}

function assertRequiredScope(agent: McpAgentAuth, requiredScope?: string) {
  if (requiredScope && !agent.scopes.has(requiredScope)) {
    throw new McpAuthError(`Missing required scope: ${requiredScope}.`, 403, requiredScope);
  }
}

export async function authenticateMcpRequest(request: Request, requiredScope?: string): Promise<McpAgentAuth> {
  const token = readBearerToken(request);
  if (!token) {
    throw new McpAuthError("Missing bearer token.", 401, requiredScope);
  }

  const agents = getConfiguredMcpAgents();
  const tokenHash = hashMcpBearerToken(token);
  const agent = agents.find(candidate => candidate.tokenHash === tokenHash);
  if (agent) {
    assertRequiredScope(agent, requiredScope);
    return agent;
  }

  let policyAgent: McpAgentAuth | null = null;
  if (process.env.DATABASE_URL) {
    try {
      policyAgent = await getMcpAgentFromPolicyTokenHash(tokenHash);
    } catch (error) {
      if (agents.length === 0) {
        console.warn("[mcp-auth] DB-backed agent lookup failed", error);
        throw new McpAuthError("MCP agent authentication is unavailable.", 503, requiredScope);
      }
    }
  }
  if (policyAgent) {
    assertRequiredScope(policyAgent, requiredScope);
    return policyAgent;
  }

  if (agents.length === 0 && !process.env.DATABASE_URL) {
    throw new McpAuthError("MCP agent authentication is not configured.", 503, requiredScope);
  }

  throw new McpAuthError("Invalid bearer token.", 401, requiredScope);
}
