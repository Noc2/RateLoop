import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createDsaReferencePanelAdjudicationArtifactGet } from "~~/app/api/account/workspaces/[workspaceId]/compliance/dsa/reference-panel/adjudications/[unitId]/artifact/route";
import type { DatabaseClient } from "~~/lib/db";
import { readDsaReferencePanelAdjudicationArtifact } from "~~/lib/tokenless/dsaReferencePanelPilot";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const REQUEST_URL =
  "https://tokenless.example.test/api/account/workspaces/workspace_exact/compliance/dsa/reference-panel/adjudications/unit_exact/artifact?epochId=epoch_exact&leaseId=lease_exact";
const CONTEXT = { params: Promise.resolve({ workspaceId: "workspace_exact", unitId: "unit_exact" }) };

function result(rows: Record<string, unknown>[]) {
  return { rows } as unknown as Awaited<ReturnType<DatabaseClient["execute"]>>;
}

test("dedicated adjudication artifact route authenticates and forwards only the exact lease scope", async () => {
  let delivered: Record<string, unknown> | null = null;
  const get = createDsaReferencePanelAdjudicationArtifactGet({
    async requireSession() {
      return { principalId: "rlp_abcdefghijklmnopqrstuvwxyz" };
    },
    async readArtifact(input) {
      delivered = input;
      return {
        bytes: new Uint8Array([101, 120, 97, 99, 116]),
        contentType: "text/plain",
        rendererPolicy: "plain_text",
        sizeBytes: 5,
      };
    },
  });

  const response = await get(new NextRequest(REQUEST_URL), CONTEXT);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), null);
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), "exact");
  assert.deepEqual(delivered, {
    accountAddress: "rlp_abcdefghijklmnopqrstuvwxyz",
    workspaceId: "workspace_exact",
    epochId: "epoch_exact",
    unitId: "unit_exact",
    leaseId: "lease_exact",
  });
});

test("dedicated adjudication artifact route never reaches delivery without authentication", async () => {
  let delivered = false;
  const get = createDsaReferencePanelAdjudicationArtifactGet({
    async requireSession() {
      throw new TokenlessServiceError("Authentication is required.", 401, "authentication_required");
    },
    async readArtifact() {
      delivered = true;
      return { bytes: new Uint8Array(), contentType: "text/plain", rendererPolicy: "plain_text", sizeBytes: 0 };
    },
  });
  const response = await get(new NextRequest(REQUEST_URL), CONTEXT);
  assert.equal(response.status, 401);
  assert.equal(delivered, false);
});

test("dedicated adjudication artifact route downloads unsupported stored media types", async () => {
  const get = createDsaReferencePanelAdjudicationArtifactGet({
    async requireSession() {
      return { principalId: "rlp_abcdefghijklmnopqrstuvwxyz" };
    },
    async readArtifact() {
      return { bytes: new Uint8Array([1]), contentType: "text/html", rendererPolicy: "sanitized_html", sizeBytes: 1 };
    },
  });
  const response = await get(new NextRequest(REQUEST_URL), CONTEXT);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="reference-panel-artifact"');
});

test("artifact delivery resolves a current nonterminal marker and passes an internal read-only adjudication context", async () => {
  const statements: string[] = [];
  const client: DatabaseClient = {
    async execute(input) {
      const sql = typeof input === "string" ? input : input.sql;
      statements.push(sql);
      return result([{ project_id: "project_exact", artifact_id: "artifact_exact" }]);
    },
  };
  let readInput: Record<string, unknown> | null = null;
  const artifact = await readDsaReferencePanelAdjudicationArtifact(
    {
      accountAddress: "rlp_abcdefghijklmnopqrstuvwxyz",
      workspaceId: "workspace_exact",
      epochId: "epoch_exact",
      unitId: "unit_exact",
      leaseId: "lease_exact",
    },
    {
      client,
      async readArtifact(input) {
        readInput = input;
        return {
          bytes: new Uint8Array([1]),
          contentType: "application/octet-stream",
          rendererPolicy: "download",
          sizeBytes: 1,
        };
      },
    },
  );
  assert.equal(artifact.sizeBytes, 1);
  assert.deepEqual(readInput, {
    accountAddress: "rlp_abcdefghijklmnopqrstuvwxyz",
    artifactId: "artifact_exact",
    dsaNamedPanelAdjudication: { epochId: "epoch_exact", unitId: "unit_exact" },
    leaseId: "lease_exact",
    projectId: "project_exact",
    purpose: "read",
    workspaceId: "workspace_exact",
  });
  assert.match(statements[0]!, /lease\.revoked_at IS NULL AND lease\.expires_at>CURRENT_TIMESTAMP/u);
  assert.match(statements[0]!, /marker\.qualification_expires_at>CURRENT_TIMESTAMP/u);
  assert.match(statements[0]!, /NOT EXISTS \([\s\S]*tokenless_dsa_named_panel_adjudications adjudication/u);
  assert.match(statements[0]!, /NOT EXISTS \([\s\S]*tokenless_dsa_named_panel_unit_outcomes outcome/u);
});

test("revoked, expired, adjudicated, or terminal markers fail closed before decryption", async () => {
  const client: DatabaseClient = {
    async execute() {
      return result([]);
    },
  };
  let decrypted = false;
  await assert.rejects(
    readDsaReferencePanelAdjudicationArtifact(
      {
        accountAddress: "rlp_abcdefghijklmnopqrstuvwxyz",
        workspaceId: "workspace_exact",
        epochId: "epoch_exact",
        unitId: "unit_exact",
        leaseId: "lease_exact",
      },
      {
        client,
        async readArtifact() {
          decrypted = true;
          return { bytes: new Uint8Array(), contentType: "text/plain", rendererPolicy: "plain_text", sizeBytes: 0 };
        },
      },
    ),
    (error: unknown) => error instanceof TokenlessServiceError && error.status === 404,
  );
  assert.equal(decrypted, false);
});

test("artifact privacy repeats the boundary after decrypt and conditionally logs the exact still-eligible lease", async () => {
  const source = await readFile(new URL("../../../lib/tokenless/artifactPrivacy.ts", import.meta.url), "utf8");
  const decryptAt = source.indexOf("const bytes = decrypt(");
  const recheckAt = source.indexOf("if (input.dsaNamedPanelAdjudication)", decryptAt);
  const logAt = source.indexOf("await appendDsaNamedPanelAdjudicationReadLog({", recheckAt);
  assert.ok(decryptAt >= 0 && recheckAt > decryptAt && logAt > recheckAt);
  assert.match(source.slice(recheckAt, logAt), /assertDsaNamedPanelArtifactBoundary/u);
  assert.match(source, /INSERT INTO tokenless_assurance_access_logs[\s\S]*SELECT \?, marker\.workspace_id/u);
  assert.match(source, /lease\.revoked_at IS NULL AND lease\.expires_at>CURRENT_TIMESTAMP/u);
  assert.match(source, /NOT EXISTS \([\s\S]*tokenless_dsa_named_panel_adjudications adjudication/u);
  assert.match(source, /NOT EXISTS \([\s\S]*tokenless_dsa_named_panel_unit_outcomes outcome/u);
});
