# Tokenless EU deployment contract

**Status:** Current hosted EU resource and evidence runbook.

This runbook applies only to the isolated `tokenless` deployment line. The checked controls make EU the only accepted
hosted data-plane configuration; region configuration alone does not prove that a live deployment is EU-hosted.

## Sources of truth

- `config/tokenless-eu-deployment.json` defines the resources, exact regions, approved processor-evidence fields,
  public-chain exception, canonical SHA-256 digest, and Ed25519 approval boundary.
- `packages/nextjs/vercel.json` pins application functions to Frankfurt (`fra1`).
- `packages/keeper/railway.toml` and `packages/ponder/railway.toml` pin one replica to Railway EU West
  (`europe-west4-drams3a`).
- `scripts/validate-tokenless-eu-deployment.mjs` rejects changed manifest content, mixed regions, legacy identifiers,
  public Blob access, missing processor evidence, and an invalid manifest signature.

Run the repository tests for manifest structure, digest, and region pins without live credentials:

```sh
node --test scripts/validate-tokenless-eu-deployment.test.mjs
```

## Hosted EU release bundle

Before any staging or production deployment:

1. Provision new resources rather than reusing or relocating preview resources: EU Postgres and backups, a
   private EU Blob store, managed EU KMS, EU log sink, EU keeper, and EU Ponder.
2. Record every provider resource ID and exact region in the environment variables named by the manifest. Do not put
   credentials or connection strings in the manifest.
3. Attach approved DPA/subprocessor/transfer evidence IDs for email, billing, analytics, and RPC processing. The
   current Resend adapter must dispatch from `eu-west-1`, but Resend documents that account data, email metadata, logs,
   and API records remain in the US; record that transfer explicitly rather than presenting email as EU-resident.
4. Set `TOKENLESS_DATA_PLANE_MODE=verified-eu` and `TOKENLESS_HOME_REGION=eu`.
5. Recalculate the canonical manifest digest with `manifestDigest()` from the validator after any intentional manifest
   edit. Update the checked digest in the same reviewed change.
6. Select one approved managed provider (`aws-kms`, `gcp-kms`, or `azure-key-vault`), connect its wrap/unwrap adapter
   to the provider-neutral vault boundary, and set its regional resource identifier. The repository supplies the
   boundary and fail-closed checks, but setting the provider name alone does not create or verify a live adapter.
   Local test keys and `TOKENLESS_ARTIFACT_MASTER_KEY` are test-fixture inputs only and are forbidden in hosted builds.
7. Have the release approver sign the 32-byte digest with the dedicated Ed25519 manifest-approval key. Store the
   public key and base64url signature as `TOKENLESS_EU_MANIFEST_SIGNING_PUBLIC_KEY` and
   `TOKENLESS_EU_MANIFEST_SIGNATURE`; keep the private key outside the application deployment.
8. Run `node scripts/validate-tokenless-eu-deployment.mjs` with the proposed production environment. Any missing,
   mismatched, legacy, US, or unsigned entry must block the release.
9. Verify runtime `VERCEL_REGION`, `RAILWAY_REPLICA_REGION`, Railway project/service IDs, Blob privacy, database region,
   backup restore, log delivery, key recovery, and deletion before customer data is admitted.

The Railway services compare injected `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, and `RAILWAY_REPLICA_REGION` with
their approved tokenless environment values at startup. The web build performs the full signed resource-bundle check
before hosted migrations run.

## Claim and rollback gate

Do not publish an `EU-hosted RateLoop data plane` claim until the live checks above have dated evidence and
legal/security approval. Approved customer copy must describe the implemented boundary directly and must not link to a
separate public limitations or trust-status page. Do not claim `EU-only`, `EU sovereign`, or strict residency from region
configuration alone; processor/control-plane and public-chain disclosures belong in the applicable privacy and legal
notices.

If a runtime identity or region differs from the signed manifest, stop admission and workers, preserve evidence, and
roll back only the isolated tokenless services. Never point the tokenless app at `rateloop.ai`, the legacy Vercel
project, the existing US database, or a mixed resource bundle.
