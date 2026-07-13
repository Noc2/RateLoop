import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  createWorkspaceClient,
  createWorkspaceCostCenter,
  createWorkspaceMemberInvite,
  getAccessibleWorkspaceClient,
  getWorkspaceGovernance,
  listAccessibleWorkspaceClients,
  listAccessibleWorkspaceCostCenters,
  listWorkspaceMembers,
  redeemWorkspaceMemberInviteWithBaseAccount,
  updateWorkspaceClientGovernance,
  updateWorkspaceGovernance,
} from "~~/lib/tokenless/workspaceGovernance";

const OWNER_A = "0x1111111111111111111111111111111111111111";
const OWNER_B = "0x2222222222222222222222222222222222222222";
const CONSULTANT = "0x3333333333333333333333333333333333333333";
const END_CLIENT = "0x4444444444444444444444444444444444444444";
const DECISION_OWNER = "0x5555555555555555555555555555555555555555";
const BILLING = "0x6666666666666666666666666666666666666666";
const ADMIN = "0x7777777777777777777777777777777777777777";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function createClient(workspaceId: string, ownerAddress: string, name: string, retentionDays?: number | null) {
  return createWorkspaceClient({
    accountAddress: ownerAddress,
    workspaceId,
    name,
    dpaStatus: "pending",
    retentionDays,
  });
}

test("workspace governance persists trader and VAT data while applying retention defaults to DPA-bound clients", async () => {
  const { workspaceId } = await createWorkspace({ name: "Assurance consultancy", ownerAddress: OWNER_A });

  const initial = await getWorkspaceGovernance({ accountAddress: OWNER_A, workspaceId });
  assert.equal(initial.defaultRetentionDays, 30);
  assert.equal(initial.traderStatus, "unverified");

  const profile = await updateWorkspaceGovernance({
    accountAddress: OWNER_A,
    workspaceId,
    defaultRetentionDays: 45,
    traderStatus: "verified",
    traderLegalName: "Assurance Consulting GmbH",
    traderRegistrationNumber: "HRB 12345",
    traderRegisteredAddress: "Example Street 1, 10115 Berlin",
    vatCountryCode: "de",
    vatId: "DE123456789",
  });
  assert.deepEqual(profile, {
    workspaceId,
    defaultRetentionDays: 45,
    traderStatus: "verified",
    traderLegalName: "Assurance Consulting GmbH",
    traderRegistrationNumber: "HRB 12345",
    traderRegisteredAddress: "Example Street 1, 10115 Berlin",
    vatCountryCode: "DE",
    vatId: "DE123456789",
  });

  const signedAt = new Date("2026-07-01T00:00:00.000Z");
  const inherited = await createWorkspaceClient({
    accountAddress: OWNER_A,
    workspaceId,
    name: "Alpha AG",
    dpaStatus: "signed",
    dpaReference: "dpa:alpha:2026-07",
    dpaEffectiveAt: signedAt,
  });
  assert.equal(inherited.configuredRetentionDays, null);
  assert.equal(inherited.effectiveRetentionDays, 45);
  assert.equal(inherited.dpaStatus, "signed");
  assert.equal(inherited.dpaEffectiveAt, signedAt.toISOString());

  const explicit = await createClient(workspaceId, OWNER_A, "Beta GmbH", 90);
  assert.equal(explicit.configuredRetentionDays, 90);
  assert.equal(explicit.effectiveRetentionDays, 90);
  const updated = await updateWorkspaceClientGovernance({
    accountAddress: OWNER_A,
    workspaceId,
    clientId: explicit.clientId,
    name: "Beta GmbH",
    dpaStatus: "signed",
    dpaReference: "dpa:beta:2026-07",
    dpaEffectiveAt: signedAt,
    retentionDays: null,
  });
  assert.equal(updated.effectiveRetentionDays, 45);
  assert.equal(updated.dpaReference, "dpa:beta:2026-07");

  const costCenter = await createWorkspaceCostCenter({
    accountAddress: OWNER_A,
    workspaceId,
    clientId: inherited.clientId,
    code: "alpha-ai-01",
    name: "Alpha AI assurance",
  });
  assert.equal(costCenter.code, "ALPHA-AI-01");
  assert.deepEqual(
    await listAccessibleWorkspaceCostCenters({
      accountAddress: OWNER_A,
      workspaceId,
      clientId: inherited.clientId,
    }),
    [costCenter],
  );

  const stored = await dbClient.execute({
    sql: `SELECT g.default_retention_days, g.trader_status, g.vat_country_code, g.vat_id,
                 c.dpa_status, c.dpa_reference
          FROM tokenless_workspace_governance g
          JOIN tokenless_workspace_clients c ON c.workspace_id = g.workspace_id
          WHERE g.workspace_id = ? AND c.client_id = ?`,
    args: [workspaceId, inherited.clientId],
  });
  assert.equal(Number(stored.rows[0]?.default_retention_days), 45);
  assert.equal(stored.rows[0]?.trader_status, "verified");
  assert.equal(stored.rows[0]?.vat_country_code, "DE");
  assert.equal(stored.rows[0]?.vat_id, "DE123456789");
  assert.equal(stored.rows[0]?.dpa_status, "signed");
  assert.equal(stored.rows[0]?.dpa_reference, "dpa:alpha:2026-07");
});

test("one-time member invitations store only hashes, bind redemption to Base Account, and preserve governance roles", async () => {
  const { workspaceId } = await createWorkspace({ name: "Role workspace", ownerAddress: OWNER_A });
  const client = await createClient(workspaceId, OWNER_A, "Client One");

  const invitations = [
    {
      address: CONSULTANT,
      accessRole: "member" as const,
      governanceRole: "consultant" as const,
      clientId: client.clientId,
    },
    {
      address: END_CLIENT,
      accessRole: "member" as const,
      governanceRole: "end_client" as const,
      clientId: client.clientId,
    },
    {
      address: DECISION_OWNER,
      accessRole: "member" as const,
      governanceRole: "decision_owner" as const,
      clientId: client.clientId,
    },
    {
      address: BILLING,
      accessRole: "billing" as const,
      governanceRole: "billing" as const,
      clientId: client.clientId,
    },
  ];

  const created = await Promise.all(
    invitations.map(async invitation => ({
      invitation,
      invite: await createWorkspaceMemberInvite({
        accountAddress: OWNER_A,
        workspaceId,
        clientId: invitation.clientId,
        accessRole: invitation.accessRole,
        governanceRole: invitation.governanceRole,
        intendedAccountAddress: invitation.address,
      }),
    })),
  );

  const storedInvites = await dbClient.execute(
    "SELECT invite_id, invite_token_hash, intended_account_address FROM tokenless_workspace_member_invites",
  );
  assert.equal(storedInvites.rowCount, invitations.length);
  for (const { invite } of created) {
    const stored = storedInvites.rows.find(row => row.invite_id === invite.inviteId);
    assert.match(String(stored?.invite_token_hash), /^[a-f0-9]{64}$/);
    assert.notEqual(stored?.invite_token_hash, invite.token);
    assert.equal(JSON.stringify(stored).includes(invite.token), false);
  }

  await assert.rejects(
    () =>
      redeemWorkspaceMemberInviteWithBaseAccount({
        token: created[0]!.invite.token,
        baseAccountAddress: END_CLIENT,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invite_account_mismatch",
  );

  for (const { invitation, invite } of created) {
    const redeemed = await redeemWorkspaceMemberInviteWithBaseAccount({
      token: invite.token,
      baseAccountAddress: invitation.address,
    });
    assert.equal(redeemed.accountAddress, invitation.address.toLowerCase());
    assert.equal(redeemed.governanceRole, invitation.governanceRole);
  }
  await assert.rejects(
    () =>
      redeemWorkspaceMemberInviteWithBaseAccount({
        token: created[0]!.invite.token,
        baseAccountAddress: CONSULTANT,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invite_unavailable",
  );

  const members = await listWorkspaceMembers({ accountAddress: OWNER_A, workspaceId });
  for (const invitation of invitations) {
    const member = members.find(value => value.accountAddress === invitation.address.toLowerCase());
    assert.equal(member?.accessRole, invitation.accessRole);
    assert.equal(member?.governanceRole, invitation.governanceRole);
    assert.deepEqual(member?.clientIds, [client.clientId]);
  }
  const redeemedRows = await dbClient.execute(
    "SELECT redeemed_by_account_address FROM tokenless_workspace_member_invites WHERE redeemed_at IS NOT NULL",
  );
  assert.equal(redeemedRows.rowCount, invitations.length);
  assert.ok(redeemedRows.rows.every(row => String(row.redeemed_by_account_address).startsWith("0x")));
});

test("only owners and admins manage governance while client and cost-center reads fail closed across scopes", async () => {
  const firstWorkspace = await createWorkspace({ name: "Consultancy A", ownerAddress: OWNER_A });
  const secondWorkspace = await createWorkspace({ name: "Consultancy B", ownerAddress: OWNER_B });
  const alpha = await createClient(firstWorkspace.workspaceId, OWNER_A, "Alpha");
  const beta = await createClient(firstWorkspace.workspaceId, OWNER_A, "Beta");
  const gamma = await createClient(secondWorkspace.workspaceId, OWNER_B, "Gamma");
  await createWorkspaceCostCenter({
    accountAddress: OWNER_A,
    workspaceId: firstWorkspace.workspaceId,
    clientId: alpha.clientId,
    code: "ALPHA",
    name: "Alpha delivery",
  });
  await createWorkspaceCostCenter({
    accountAddress: OWNER_A,
    workspaceId: firstWorkspace.workspaceId,
    clientId: beta.clientId,
    code: "BETA",
    name: "Beta delivery",
  });

  const consultantInvite = await createWorkspaceMemberInvite({
    accountAddress: OWNER_A,
    workspaceId: firstWorkspace.workspaceId,
    clientId: alpha.clientId,
    accessRole: "member",
    governanceRole: "consultant",
    intendedAccountAddress: CONSULTANT,
  });
  await redeemWorkspaceMemberInviteWithBaseAccount({
    token: consultantInvite.token,
    baseAccountAddress: CONSULTANT,
  });
  const adminInvite = await createWorkspaceMemberInvite({
    accountAddress: OWNER_A,
    workspaceId: firstWorkspace.workspaceId,
    accessRole: "admin",
    governanceRole: "consultant",
    intendedAccountAddress: ADMIN,
  });
  await redeemWorkspaceMemberInviteWithBaseAccount({ token: adminInvite.token, baseAccountAddress: ADMIN });

  assert.deepEqual(
    (await listAccessibleWorkspaceClients({ accountAddress: CONSULTANT, workspaceId: firstWorkspace.workspaceId })).map(
      value => value.clientId,
    ),
    [alpha.clientId],
  );
  assert.equal(
    (
      await listAccessibleWorkspaceCostCenters({
        accountAddress: CONSULTANT,
        workspaceId: firstWorkspace.workspaceId,
        clientId: alpha.clientId,
      })
    )[0]?.code,
    "ALPHA",
  );
  await assert.rejects(
    () =>
      getAccessibleWorkspaceClient({
        accountAddress: CONSULTANT,
        workspaceId: firstWorkspace.workspaceId,
        clientId: beta.clientId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "client_not_found",
  );
  await assert.rejects(
    () => listAccessibleWorkspaceClients({ accountAddress: CONSULTANT, workspaceId: secondWorkspace.workspaceId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  await assert.rejects(
    () =>
      getAccessibleWorkspaceClient({
        accountAddress: CONSULTANT,
        workspaceId: firstWorkspace.workspaceId,
        clientId: gamma.clientId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "client_not_found",
  );

  await assert.rejects(
    () =>
      createWorkspaceMemberInvite({
        accountAddress: CONSULTANT,
        workspaceId: firstWorkspace.workspaceId,
        clientId: alpha.clientId,
        accessRole: "member",
        governanceRole: "end_client",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  await assert.rejects(
    () =>
      createWorkspaceCostCenter({
        accountAddress: OWNER_A,
        workspaceId: firstWorkspace.workspaceId,
        clientId: gamma.clientId,
        code: "LEAK",
        name: "Cross-workspace leak",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "client_not_found",
  );

  const adminCreated = await createClient(firstWorkspace.workspaceId, ADMIN, "Admin-created client");
  assert.equal(adminCreated.workspaceId, firstWorkspace.workspaceId);

  await assert.rejects(() =>
    dbClient.execute({
      sql: `INSERT INTO tokenless_workspace_cost_centers
            (cost_center_id, workspace_id, client_id, code, name, status, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      args: [
        "wcc_cross_workspace",
        firstWorkspace.workspaceId,
        gamma.clientId,
        "CROSS",
        "Cross workspace",
        OWNER_A.toLowerCase(),
        new Date(),
        new Date(),
      ],
    }),
  );
});
