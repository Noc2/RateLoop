import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { createAuthSession } from "~~/lib/auth/session";
import { dbClient } from "~~/lib/db";
import {
  SAFE_AGENT_CONNECTION_SCOPES,
  claimAgentConnectionIntent,
  verifyAgentConnection,
} from "~~/lib/tokenless/agentConnectionIntents";
import { putHumanReviewConfigurationForOwner } from "~~/lib/tokenless/humanReviewConfiguration";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import {
  completeWorkspaceAgentSetup,
  configureWorkspaceSetupPeople,
  configureWorkspaceSetupReviews,
  confirmWorkspaceSetupAgent,
  createWorkspaceAgentSetupConnection,
  getWorkspaceAgentSetup,
} from "~~/lib/tokenless/workspaceAgentSetup";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const statePath = path.join(packageRoot, "e2e/.state.json");
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const resource = `${baseURL}/api/agent/v1/mcp`;

function isolatedDatabaseUrl() {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required for browser tests.");
  const parsed = new URL(raw);
  const databaseName = parsed.pathname.slice(1);
  if (!/^rateloop(?:_[a-z0-9-]+)?_e2e$/u.test(databaseName)) {
    throw new Error(`Browser-test reset refused for non-e2e database ${JSON.stringify(databaseName)}.`);
  }
  return parsed.toString();
}

async function resetAndMigrate(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("CREATE SCHEMA public");
    await migrate(drizzle(pool), { migrationsFolder: path.join(packageRoot, "drizzle") });
  } finally {
    await pool.end();
  }
}

async function browserIdentity(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `playwright-${label}`,
    displayName: `Playwright ${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  return { identity, session };
}

async function connectedWorkspace(ownerAddress: string) {
  const clientId = "rloc_playwright_client";
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_clients
          (client_id,client_name,redirect_uris_json,redirect_uris_digest,token_endpoint_auth_method,
           grant_types_json,response_types_json,allowed_scopes_json,registration_source,status,created_at,updated_at)
          VALUES (?, 'Playwright Agent', '["http://127.0.0.1/callback"]', 'playwright-redirects', 'none',
                  '["authorization_code","refresh_token"]', '["code"]', ?, 'dynamic', 'active', ?, ?)`,
    args: [clientId, JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES), now, now],
  });
  const { workspaceId } = await createWorkspace({ name: "Browser test workspace", ownerAddress });
  const issued = await createWorkspaceAgentSetupConnection({
    accountAddress: ownerAddress,
    workspaceId,
    origin: baseURL,
    revision: 1,
  });
  if (!issued.connectionUrl) throw new Error("The browser fixture did not receive a connection URL.");
  const tokenFamilyId = "rlotf_playwright_family";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_oauth_token_families
          (token_family_id,client_id,subject_principal_id,audience,resource,granted_scopes_json,status,
           created_at,absolute_expires_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      tokenFamilyId,
      clientId,
      ownerAddress,
      resource,
      resource,
      JSON.stringify(SAFE_AGENT_CONNECTION_SCOPES),
      now,
      new Date(now.getTime() + 86_400_000),
    ],
  });
  const principal = {
    tokenFamilyId,
    clientId,
    clientName: "Playwright Agent",
    subjectPrincipalId: ownerAddress,
    resource,
    scopes: [...SAFE_AGENT_CONNECTION_SCOPES],
  };
  const claimed = await claimAgentConnectionIntent({ connectionUrl: issued.connectionUrl, origin: baseURL, principal });
  await verifyAgentConnection({ principal, integrationId: claimed.connection.integrationId });
  const connected = await getWorkspaceAgentSetup({ accountAddress: ownerAddress, workspaceId });
  if (!connected.agent) throw new Error("The connected browser fixture has no agent.");
  const confirmed = await confirmWorkspaceSetupAgent({
    accountAddress: ownerAddress,
    workspaceId,
    revision: connected.revision,
    agent: {
      displayName: "Review Copilot",
      description: "A deterministic browser-test agent.",
      provider: connected.agent.provider,
      model: connected.agent.model,
      modelVersion: connected.agent.modelVersion,
      environment: "production",
    },
  });
  const review = await putHumanReviewConfigurationForOwner({
    accountAddress: ownerAddress,
    workspaceId,
    agentId: connected.agent.agentId,
    body: {
      expectedBindingVersion: null,
      selection: {
        mode: "adaptive",
        enforcementMode: "advisory",
        agreementThresholdBps: 8_000,
        productionFloorBps: 1_000,
        fixedRateBps: null,
        maximumUnreviewedGap: 20,
        requiredRiskTiers: ["high"],
        criticalRiskTiers: ["critical"],
        minimumConfidenceBps: 7_000,
        maximumLatencyMs: 120_000,
      },
      requestProfile: {
        criterion: "Is this response safe and correct?",
        positiveLabel: "Approve",
        negativeLabel: "Reject",
        rationaleMode: "required",
        audience: "public_network",
        contentBoundary: "public_or_test",
        privateSensitivity: null,
        privateGroupId: null,
        responseWindowSeconds: 3_600,
        panelSize: 3,
        compensationMode: "usdc",
        bountyPerSeatAtomic: "1000000",
      },
      authority: "prepare_for_approval",
    },
  });
  const reviews = await configureWorkspaceSetupReviews({
    accountAddress: ownerAddress,
    workspaceId,
    revision: confirmed.revision,
    bindingRevision: review.configuration.version,
  });
  const people = await configureWorkspaceSetupPeople({
    accountAddress: ownerAddress,
    workspaceId,
    revision: reviews.revision,
    decision: "not_required",
  });
  await completeWorkspaceAgentSetup({ accountAddress: ownerAddress, workspaceId, revision: people.revision });
  return { agentId: connected.agent.agentId, workspaceId };
}

async function main() {
  const databaseUrl = isolatedDatabaseUrl();
  await resetAndMigrate(databaseUrl);
  const setup = await browserIdentity("setup");
  const owner = await browserIdentity("owner");
  const workspace = await connectedWorkspace(owner.identity.principalId);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        baseURL,
        setupSessionToken: setup.session.token,
        ownerSessionToken: owner.session.token,
        ...workspace,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  console.log(`Prepared isolated browser fixtures for ${workspace.workspaceId}.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
