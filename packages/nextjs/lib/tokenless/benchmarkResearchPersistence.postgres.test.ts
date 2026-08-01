import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { createBenchmarkResearchPersistence } from "~~/lib/tokenless/benchmarkResearchPersistence";

const databaseUrl = process.env.BENCHMARK_RESEARCH_TEST_DATABASE_URL;

test(
  "PostgreSQL 16 enforces the contractual activation and invited agreement lifecycle",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const runId = Date.now().toString(36);
    const manager = `rlp_manager_contractual_research_${runId}`;
    const recipient = `rlp_recipient_contractual_research_${runId}`;
    const workspaceId = `workspace_pg_contractual_research_${runId}`;
    const projectId = `project_pg_contractual_research_${runId}`;
    const benchmarkId = `benchmark_pg_contractual_research_${runId}`;
    const persistence = createBenchmarkResearchPersistence({ pool });
    try {
      const fixtureTime = new Date("2026-08-01T08:00:00.000Z");
      await pool.query(
        `INSERT INTO tokenless_workspaces (workspace_id,name,status,created_at,updated_at)
         VALUES ($1,'0176 PostgreSQL fixture','active',$2,$2)`,
        [workspaceId, fixtureTime],
      );
      await pool.query(
        `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at)
         VALUES ($1,'active',$3,$3),($2,'active',$3,$3)`,
        [manager, recipient, fixtureTime],
      );
      await pool.query(
        `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
         VALUES ($1,$2,'owner',$3)`,
        [workspaceId, manager, fixtureTime],
      );
      await pool.query(
        `INSERT INTO tokenless_assurance_projects
         (project_id,workspace_id,name,description,data_classification,status,retention_days,created_by,created_at,updated_at)
         VALUES ($1,$2,'0176 project',NULL,'public','active',30,$3,$4,$4)`,
        [projectId, workspaceId, manager, fixtureTime],
      );

      const activation = await persistence.activateBenchmark({
        authenticatedManagerPrincipalId: manager,
        workspaceId,
        projectId,
        benchmarkId,
        activationReference: `activation_pg_contractual_research_${runId}`,
        deploymentKey: `deployment_pg_contractual_research_${runId}`,
      });
      assert.equal(activation.activationScope, "research_export_only");
      assert.equal(activation.networkReleaseAuthority, "none");

      await persistence.offerAgreement({
        authenticatedManagerPrincipalId: manager,
        recipientPrincipalId: recipient,
        workspaceId,
        projectId,
        benchmarkId,
        agreementId: `agreement_pg_contractual_research_${runId}`,
        agreementVersion: 1,
        purpose: "methodology_validation",
        expiresInMs: 24 * 60 * 60 * 1_000,
      });
      await assert.rejects(
        persistence.acceptAgreement({
          authenticatedRecipientPrincipalId: recipient,
          workspaceId,
          projectId,
          benchmarkId,
          agreementId: `agreement_pg_guessed_${runId}`,
          agreementVersion: 1,
          purpose: "methodology_validation",
        }),
        /project not found/iu,
      );
      const accepted = await persistence.acceptAgreement({
        authenticatedRecipientPrincipalId: recipient,
        workspaceId,
        projectId,
        benchmarkId,
        agreementId: `agreement_pg_contractual_research_${runId}`,
        agreementVersion: 1,
        purpose: "methodology_validation",
      });
      const stored = await pool.query(
        `SELECT accepted_at,offer_hash FROM tokenless_benchmark_research_agreement_acceptances
          WHERE workspace_id=$1 AND agreement_id=$2 AND agreement_version=1`,
        [workspaceId, accepted.agreementId],
      );
      assert.equal(stored.rowCount, 1);
      assert.equal(new Date(stored.rows[0].accepted_at).toISOString(), accepted.acceptedAt);
      assert.match(String(stored.rows[0].offer_hash), /^sha256:[0-9a-f]{64}$/u);

      await assert.rejects(
        pool.query(
          `UPDATE tokenless_benchmark_research_agreement_acceptances
              SET purpose='sample_reproduction'
            WHERE workspace_id=$1 AND agreement_id=$2`,
          [workspaceId, accepted.agreementId],
        ),
        (error: Error & { code?: string }) => error.code === "55000",
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO tokenless_benchmark_activations
           (workspace_id,project_id,benchmark_id,activation_reference,deployment_key,status,public_safe_only,
            access_class,activation_scope,network_release_authority,activation_json,activation_hash,activated_by)
           VALUES ($1,$2,$3,$4,$5,'active',true,
                   'contractual_public_safe_benchmark_research','research_export_only','none','{}',$6,$7)`,
          [
            workspaceId,
            projectId,
            benchmarkId,
            `activation_pg_bad_digest_${runId}`,
            `deployment_pg_bad_digest_${runId}`,
            `sha256:${"0".repeat(64)}`,
            manager,
          ],
        ),
        (error: Error & { code?: string }) => error.code === "23514",
      );

      const replayConstraint = await pool.query(
        `SELECT pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid='tokenless_benchmark_research_access_snapshots'::regclass
            AND contype='u'`,
      );
      assert.match(
        replayConstraint.rows.map(row => String(row.definition)).join("\n"),
        /UNIQUE \(grant_lookup_digest, recipient_lookup_digest, idempotency_key\)/u,
      );
    } finally {
      await pool.end();
    }
  },
);
