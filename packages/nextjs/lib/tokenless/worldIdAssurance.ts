import { hashSignal } from "@worldcoin/idkit-core";
import { type RpSignature, signRequest } from "@worldcoin/idkit-core/signing";
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAddress } from "viem";
import { dbClient, dbPool } from "~~/lib/db";
import { ensureAssuranceRaterProfile } from "~~/lib/tokenless/paidEligibility";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const PROVIDER_ID = "world:poh";
const CAPABILITY = "unique_human";
const REQUEST_TTL_SECONDS = 5 * 60;
const DEFAULT_CREDENTIAL_MIN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_CREDENTIAL_MIN_TTL_SECONDS = 60 * 60;
const MAX_CREDENTIAL_MIN_TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_VERIFY_BODY_BYTES = 64 * 1024;
const CONTEXT_RATE_WINDOW_MS = 10 * 60_000;
const CONTEXT_RATE_LIMIT = 5;
const REQUEST_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_VERIFY_ATTEMPTS = 10;
const APP_ID = /^app_[A-Za-z0-9_-]{8,128}$/u;
const RP_ID = /^rp_[A-Za-z0-9_-]{8,128}$/u;
const FIELD_HEX = /^0x[0-9a-fA-F]{1,64}$/u;

type QueryRow = Record<string, unknown>;
type Environment = Record<string, string | undefined>;
type WorldIdEnvironment = "production" | "staging";
type WorldIdMode = "initial_unique";

type WorldIdConfig = {
  appId: `app_${string}`;
  rpId: `rp_${string}`;
  signingKey: string;
  actionVersion: string;
  action: string;
  environment: WorldIdEnvironment;
  subjectHmacKeyVersion: string;
  subjectHmacKeys: Map<string, Buffer>;
  evidenceKeyVersion: string;
  evidenceKeys: Map<string, Buffer>;
  credentialMinTtlSeconds: number;
};

type SignWorldRequest = (input: { signingKeyHex: string; action?: string; ttl: number }) => RpSignature;
type WorldFetch = typeof fetch;

let configOverride: WorldIdConfig | null = null;
let signerOverride: SignWorldRequest | null = null;
let fetchOverride: WorldFetch | null = null;

function stringValue(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function required(env: Environment, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new TokenlessServiceError(`${name} is required.`, 503, "world_id_unavailable", true);
  return value;
}

function loadKeyring(env: Environment, prefix: string, publicName: string) {
  if (env[`NEXT_PUBLIC_${prefix}_KEYS`] || env[`NEXT_PUBLIC_${prefix}_KEY_VERSION`]) {
    throw new TokenlessServiceError(
      `${publicName} keys must never use NEXT_PUBLIC_ variables.`,
      500,
      "world_id_misconfigured",
    );
  }
  const currentVersion = required(env, `${prefix}_KEY_VERSION`);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(required(env, `${prefix}_KEYS`)) as Record<string, unknown>;
  } catch {
    throw new TokenlessServiceError(`${prefix}_KEYS must be a JSON keyring.`, 503, "world_id_unavailable");
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (typeof encoded !== "string") continue;
    const key = Buffer.from(encoded, "base64url");
    if (key.length === 32) keys.set(version, key);
  }
  if (!keys.has(currentVersion)) {
    throw new TokenlessServiceError(`${publicName} current key is unavailable.`, 503, "world_id_unavailable");
  }
  return { currentVersion, keys };
}

export function isWorldIdAssuranceEnabled(env: Environment = process.env) {
  const value = env.TOKENLESS_NETWORK_PANELS_ENABLED?.trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw new TokenlessServiceError(
    "TOKENLESS_NETWORK_PANELS_ENABLED must be exactly true or false.",
    500,
    "world_id_misconfigured",
  );
}

function loadConfig(env: Environment = process.env): WorldIdConfig {
  if (configOverride) return configOverride;
  if (!isWorldIdAssuranceEnabled(env)) {
    throw new TokenlessServiceError("RateLoop-network assurance is disabled.", 404, "network_panels_disabled");
  }
  if (env.NEXT_PUBLIC_WORLD_ID_RP_SIGNING_KEY) {
    throw new TokenlessServiceError(
      "WORLD_ID_RP_SIGNING_KEY must never use a NEXT_PUBLIC_ variable.",
      500,
      "world_id_misconfigured",
    );
  }
  const appId = required(env, "WORLD_ID_APP_ID");
  const rpId = required(env, "WORLD_ID_RP_ID");
  const signingKey = required(env, "WORLD_ID_RP_SIGNING_KEY");
  const actionVersion = required(env, "WORLD_ID_PROOF_OF_HUMAN_ACTION_VERSION");
  const action = required(env, "WORLD_ID_PROOF_OF_HUMAN_ACTION");
  const environment = (env.WORLD_ID_ENVIRONMENT?.trim() || "production") as WorldIdEnvironment;
  if (!APP_ID.test(appId) || !RP_ID.test(rpId) || !/^(?:0x)?[0-9a-fA-F]{64}$/u.test(signingKey)) {
    throw new TokenlessServiceError("World ID RP credentials are invalid.", 503, "world_id_unavailable");
  }
  if (
    !/^[A-Za-z0-9_.:-]{1,80}$/u.test(actionVersion) ||
    !action ||
    action.length > 255 ||
    (environment !== "production" && environment !== "staging")
  ) {
    throw new TokenlessServiceError("World ID action or environment is invalid.", 503, "world_id_unavailable");
  }
  const credentialMinTtlSeconds = Number(
    env.TOKENLESS_WORLD_ID_CREDENTIAL_MIN_TTL_SECONDS?.trim() || DEFAULT_CREDENTIAL_MIN_TTL_SECONDS,
  );
  if (
    !Number.isSafeInteger(credentialMinTtlSeconds) ||
    credentialMinTtlSeconds < MIN_CREDENTIAL_MIN_TTL_SECONDS ||
    credentialMinTtlSeconds > MAX_CREDENTIAL_MIN_TTL_SECONDS
  ) {
    throw new TokenlessServiceError("World ID credential minimum TTL is invalid.", 503, "world_id_unavailable");
  }
  const subjects = loadKeyring(env, "TOKENLESS_PROVIDER_SUBJECT_HMAC", "World ID subject HMAC");
  const evidence = loadKeyring(env, "TOKENLESS_WORLD_ID_EVIDENCE", "World ID evidence");
  return {
    appId: appId as `app_${string}`,
    rpId: rpId as `rp_${string}`,
    signingKey: signingKey.startsWith("0x") ? signingKey : `0x${signingKey}`,
    actionVersion,
    action,
    environment,
    subjectHmacKeyVersion: subjects.currentVersion,
    subjectHmacKeys: subjects.keys,
    evidenceKeyVersion: evidence.currentVersion,
    evidenceKeys: evidence.keys,
    credentialMinTtlSeconds,
  };
}

function canonicalField(value: string) {
  if (!FIELD_HEX.test(value)) {
    throw new TokenlessServiceError("World ID field element is invalid.", 400, "invalid_world_id_result");
  }
  return BigInt(value).toString(10);
}

function keyedReference(config: WorldIdConfig, version: string, domain: string, canonicalValue: string) {
  const key = config.subjectHmacKeys.get(version)!;
  return `hmac-sha256:${version}:${createHmac("sha256", key)
    .update(`world:poh:${domain}:${canonicalValue}`)
    .digest("hex")}`;
}

function allKeyedReferences(config: WorldIdConfig, domain: string, canonicalValue: string) {
  return [...config.subjectHmacKeys.keys()]
    .sort()
    .map(version => ({ version, hash: keyedReference(config, version, domain, canonicalValue) }));
}

function keyFingerprints(config: WorldIdConfig) {
  return Object.fromEntries(
    [...config.subjectHmacKeys.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([version, key]) => [version, createHash("sha256").update(key).digest("hex")]),
  );
}

function encryptPayload(config: WorldIdConfig, reference: string, value: unknown) {
  const key = config.evidenceKeys.get(config.evidenceKeyVersion)!;
  const nonce = randomBytes(12);
  const aad = `${PROVIDER_ID}:${config.rpId}:enrollment:${reference}:${config.evidenceKeyVersion}`;
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [
    "aes-256-gcm-v1",
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function signalForRequest(requestId: string) {
  return requestId;
}

function verifierUrl(config: WorldIdConfig) {
  const origin =
    config.environment === "staging" ? "https://staging-developer.worldcoin.org" : "https://developer.world.org";
  return `${origin}/api/v4/verify/${encodeURIComponent(config.rpId)}`;
}

async function freezeActionAndKeys(client: PoolClient, config: WorldIdConfig, now: Date) {
  const fingerprints = keyFingerprints(config);
  await client.query(
    `INSERT INTO tokenless_world_id_action_registry
     (provider_id, rp_id, app_id, action_version, action, environment,
      hmac_key_fingerprints_json, registered_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON CONFLICT (provider_id, rp_id) DO NOTHING`,
    [
      PROVIDER_ID,
      config.rpId,
      config.appId,
      config.actionVersion,
      config.action,
      config.environment,
      JSON.stringify(fingerprints),
      now,
    ],
  );
  const result = await client.query(
    `SELECT app_id, action_version, action, environment, hmac_key_fingerprints_json
     FROM tokenless_world_id_action_registry
     WHERE provider_id = $1 AND rp_id = $2 LIMIT 1 FOR UPDATE`,
    [PROVIDER_ID, config.rpId],
  );
  const row = result.rows[0] as QueryRow | undefined;
  if (
    !row ||
    stringValue(row, "app_id") !== config.appId ||
    stringValue(row, "action_version") !== config.actionVersion ||
    stringValue(row, "action") !== config.action ||
    stringValue(row, "environment") !== config.environment
  ) {
    throw new TokenlessServiceError(
      "The registered World ID action is immutable and does not match configuration.",
      500,
      "world_id_action_mismatch",
    );
  }
  let registered: Record<string, string>;
  try {
    registered = JSON.parse(String(row.hmac_key_fingerprints_json)) as Record<string, string>;
  } catch {
    throw new TokenlessServiceError("World ID HMAC registry is invalid.", 500, "world_id_misconfigured");
  }
  for (const [version, fingerprint] of Object.entries(registered)) {
    if (fingerprints[version] !== fingerprint) {
      throw new TokenlessServiceError(
        "Every registered World ID HMAC key version must be retained unchanged.",
        500,
        "world_id_hmac_key_missing",
      );
    }
  }
  if (Object.keys(fingerprints).some(version => registered[version] === undefined)) {
    await client.query(
      `UPDATE tokenless_world_id_action_registry
       SET hmac_key_fingerprints_json = $1, updated_at = $2
       WHERE provider_id = $3 AND rp_id = $4`,
      [JSON.stringify({ ...registered, ...fingerprints }), now, PROVIDER_ID, config.rpId],
    );
  }
}

export async function createWorldIdAssuranceContext(input: { principalId: string; payoutAccount: string; now?: Date }) {
  const now = input.now ?? new Date();
  const payoutAccount = getAddress(input.payoutAccount).toLowerCase();
  const config = loadConfig();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const raterId = await ensureAssuranceRaterProfile(client, { principalId: input.principalId, payoutAccount }, now);
    await freezeActionAndKeys(client, config, now);
    await client.query(`DELETE FROM tokenless_world_id_requests WHERE expires_at < $1`, [
      new Date(now.getTime() - REQUEST_RETENTION_MS),
    ]);
    const bindingResult = await client.query(
      `SELECT b.binding_id, a.assertion_id
       FROM tokenless_provider_subject_bindings b
       JOIN tokenless_assurance_assertions a ON a.binding_id = b.binding_id
       WHERE b.rater_id = $1 AND b.provider_id = $2 AND b.provider_namespace = $3
         AND b.status = 'active' AND a.status = 'active'
       ORDER BY a.evidence_verified_at DESC LIMIT 1 FOR UPDATE`,
      [raterId, PROVIDER_ID, config.rpId],
    );
    if (bindingResult.rows.length > 0) {
      throw new TokenlessServiceError(
        "This RateLoop account already has a durable World ID enrollment.",
        409,
        "world_id_already_enrolled",
      );
    }
    const limitResult = await client.query(
      `SELECT window_started_at, request_count FROM tokenless_world_id_context_limits
       WHERE rater_id = $1 LIMIT 1 FOR UPDATE`,
      [raterId],
    );
    const limit = limitResult.rows[0] as QueryRow | undefined;
    const windowExpired =
      !limit || new Date(String(limit.window_started_at)).getTime() <= now.getTime() - CONTEXT_RATE_WINDOW_MS;
    if (!windowExpired && Number(limit!.request_count) >= CONTEXT_RATE_LIMIT) {
      throw new TokenlessServiceError("Too many World ID contexts were requested.", 429, "world_id_rate_limited", true);
    }
    if (!limit) {
      await client.query(
        `INSERT INTO tokenless_world_id_context_limits
         (rater_id, window_started_at, request_count, updated_at) VALUES ($1,$2,1,$2)`,
        [raterId, now],
      );
    } else if (windowExpired) {
      await client.query(
        `UPDATE tokenless_world_id_context_limits
         SET window_started_at = $1, request_count = 1, updated_at = $1 WHERE rater_id = $2`,
        [now, raterId],
      );
    } else {
      await client.query(
        `UPDATE tokenless_world_id_context_limits
         SET request_count = request_count + 1, updated_at = $1 WHERE rater_id = $2`,
        [now, raterId],
      );
    }
    const mode: WorldIdMode = "initial_unique";
    const signed = (signerOverride ?? signRequest)({
      signingKeyHex: config.signingKey,
      action: config.action,
      ttl: REQUEST_TTL_SECONDS,
    });
    const createdAt = new Date(signed.createdAt * 1000);
    const expiresAt = new Date(signed.expiresAt * 1000);
    if (createdAt > new Date(now.getTime() + 60_000) || expiresAt <= now || expiresAt <= createdAt) {
      throw new TokenlessServiceError("World ID RP context timestamps are invalid.", 503, "world_id_unavailable", true);
    }
    const credentialExpiresAtMin = new Date(now.getTime() + config.credentialMinTtlSeconds * 1000);
    const requestId = `wrq_${randomUUID().replaceAll("-", "")}`;
    await client.query(
      `UPDATE tokenless_world_id_requests SET status = 'superseded'
       WHERE rater_id = $1 AND status = 'pending'`,
      [raterId],
    );
    await client.query(
      `INSERT INTO tokenless_world_id_requests
       (request_id, rater_id, principal_id, account_address, provider_id, rp_id, app_id, action_version,
        action, environment, mode, assurance_effect, nonce, credential_expires_at_min,
        status, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',$15,$16)`,
      [
        requestId,
        raterId,
        input.principalId,
        payoutAccount,
        PROVIDER_ID,
        config.rpId,
        config.appId,
        config.actionVersion,
        config.action,
        config.environment,
        mode,
        "bind_durable_unique_human",
        signed.nonce,
        credentialExpiresAtMin,
        createdAt,
        expiresAt,
      ],
    );
    await client.query("COMMIT");
    return {
      requestId,
      mode,
      appId: config.appId,
      action: config.action,
      environment: config.environment,
      signal: signalForRequest(requestId),
      credentialExpiresAtMin: Math.floor(credentialExpiresAtMin.getTime() / 1000),
      rpContext: {
        rp_id: config.rpId,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type ParsedWorldResult = {
  mode: WorldIdMode;
  nonce: string;
  signalHash: string;
  expiresAtMin: number;
  nullifierNumeric: string;
};

function parseWorldResult(rawBody: string, request: QueryRow): ParsedWorldResult {
  if (Buffer.byteLength(rawBody, "utf8") > MAX_VERIFY_BODY_BYTES) {
    throw new TokenlessServiceError("World ID result is too large.", 413, "invalid_world_id_result");
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new TokenlessServiceError("World ID result must be valid JSON.", 400, "invalid_world_id_result");
  }
  const mode = stringValue(request, "mode") as WorldIdMode;
  const responses = Array.isArray(parsed.responses) ? parsed.responses : [];
  const response = responses[0] as Record<string, unknown> | undefined;
  const expectedSignalHash = hashSignal(signalForRequest(stringValue(request, "request_id")!)).toLowerCase();
  const expiresAtMin = Number(response?.expires_at_min);
  if (
    parsed.protocol_version !== "4.0" ||
    parsed.nonce !== stringValue(request, "nonce") ||
    parsed.environment !== stringValue(request, "environment") ||
    responses.length !== 1 ||
    response?.identifier !== "proof_of_human" ||
    response.issuer_schema_id !== 1 ||
    typeof response.signal_hash !== "string" ||
    response.signal_hash.toLowerCase() !== expectedSignalHash ||
    !Array.isArray(response.proof) ||
    response.proof.length !== 5 ||
    !Number.isSafeInteger(expiresAtMin) ||
    expiresAtMin < Math.floor(new Date(String(request.credential_expires_at_min)).getTime() / 1000)
  ) {
    throw new TokenlessServiceError("World ID 4 Proof of Human result is invalid.", 400, "invalid_world_id_result");
  }
  if (
    mode !== "initial_unique" ||
    "session_id" in parsed ||
    parsed.action !== stringValue(request, "action") ||
    typeof response.nullifier !== "string"
  ) {
    throw new TokenlessServiceError("World ID uniqueness result is invalid.", 400, "invalid_world_id_result");
  }
  return {
    mode,
    nonce: parsed.nonce as string,
    signalHash: expectedSignalHash,
    expiresAtMin,
    nullifierNumeric: canonicalField(response.nullifier),
  };
}

async function verifyWithWorld(rawBody: string, parsed: ParsedWorldResult, config: WorldIdConfig) {
  let response: Response;
  try {
    response = await (fetchOverride ?? fetch)(verifierUrl(config), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
      cache: "no-store",
    });
  } catch {
    throw new TokenlessServiceError(
      "World ID verification is temporarily unavailable.",
      503,
      "world_id_unavailable",
      true,
    );
  }
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(await response.text()) as Record<string, unknown>;
  } catch {
    throw new TokenlessServiceError(
      "World ID returned an invalid verification response.",
      503,
      "world_id_unavailable",
      true,
    );
  }
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new TokenlessServiceError(
        "World ID verification is temporarily unavailable.",
        503,
        "world_id_unavailable",
        true,
      );
    }
    throw new TokenlessServiceError("World ID rejected this proof.", 422, "world_id_verification_rejected");
  }
  const results = Array.isArray(result.results) ? result.results : [];
  const proofResult = results.find(
    value => value && typeof value === "object" && (value as QueryRow).identifier === "proof_of_human",
  ) as QueryRow | undefined;
  const createdAt = typeof result.created_at === "string" ? new Date(result.created_at) : null;
  const nullifierMatches =
    typeof proofResult?.nullifier === "string" &&
    typeof result.nullifier === "string" &&
    canonicalField(String(proofResult.nullifier)) === parsed.nullifierNumeric &&
    canonicalField(String(result.nullifier)) === parsed.nullifierNumeric;
  if (
    result.success !== true ||
    (result.environment !== undefined && result.environment !== config.environment) ||
    !proofResult ||
    proofResult.success !== true ||
    !nullifierMatches ||
    result.action !== config.action ||
    !createdAt ||
    !Number.isFinite(createdAt.getTime())
  ) {
    throw new TokenlessServiceError("World ID rejected this proof.", 422, "world_id_verification_rejected");
  }
  return { createdAt };
}

function placeholders(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(",");
}

async function persistInitial(
  client: PoolClient,
  input: {
    request: QueryRow;
    parsed: ParsedWorldResult;
    config: WorldIdConfig;
    remoteCreatedAt: Date;
    now: Date;
  },
) {
  const { request, parsed, config, now } = input;
  const raterId = stringValue(request, "rater_id")!;
  const references = allKeyedReferences(config, "subject", parsed.nullifierNumeric);
  const hashes = references.map(value => value.hash);
  const bindingRows = await client.query(
    `SELECT binding_id, rater_id, subject_reference_hash, subject_reference_key_version
     FROM tokenless_provider_subject_bindings
     WHERE provider_id = $1 AND provider_namespace = $2
       AND (rater_id = $3 OR subject_reference_hash IN (${placeholders(4, hashes.length)}))
     FOR UPDATE`,
    [PROVIDER_ID, config.rpId, raterId, ...hashes],
  );
  const rows = bindingRows.rows as QueryRow[];
  const subjectOwner = rows.find(row => hashes.includes(String(row.subject_reference_hash)));
  const accountBinding = rows.find(row => stringValue(row, "rater_id") === raterId);
  if (
    (subjectOwner && stringValue(subjectOwner, "rater_id") !== raterId) ||
    (accountBinding && !hashes.includes(String(accountBinding.subject_reference_hash)))
  ) {
    throw new TokenlessServiceError(
      "This World ID is already bound to a different RateLoop account.",
      409,
      "world_id_already_bound",
    );
  }
  const currentReference = references.find(value => value.version === config.subjectHmacKeyVersion)!;
  const bindingId = stringValue(accountBinding, "binding_id") ?? `bind_world_${currentReference.hash.slice(-48)}`;
  if (!accountBinding) {
    await client.query(
      `INSERT INTO tokenless_provider_subject_bindings
       (binding_id, rater_id, provider_id, provider_namespace, subject_reference_hash,
        subject_reference_scheme, subject_reference_key_version, status, bound_at,
        last_verified_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'hmac-sha256-v1',$6,'active',$7,$7,$7,$7)`,
      [bindingId, raterId, PROVIDER_ID, config.rpId, currentReference.hash, currentReference.version, now],
    );
  }
  const assertionIdReference = keyedReference(
    config,
    config.subjectHmacKeyVersion,
    "assertion-id",
    `${config.action}:${parsed.nullifierNumeric}`,
  );
  const assertionHash = keyedReference(
    config,
    config.subjectHmacKeyVersion,
    "assertion",
    `proof_of_human:1:${parsed.nullifierNumeric}`,
  );
  const assertionId = `assert_world_${assertionIdReference.slice(-48)}`;
  const credentialExpiresAt = new Date(parsed.expiresAtMin * 1000);
  const evidence = encryptPayload(config, assertionIdReference, {
    schemaVersion: "rateloop.world-id-enrollment-evidence.v1",
    proofType: "uniqueness",
    validityModel: "durable_enrollment",
    providerId: PROVIDER_ID,
    providerNamespace: config.rpId,
    credential: "proof_of_human",
    issuerSchemaId: 1,
    actionVersion: config.actionVersion,
    action: config.action,
    environment: config.environment,
    signalHash: parsed.signalHash,
    credentialExpiresAtMin: parsed.expiresAtMin,
    subjectReferenceHash: currentReference.hash,
    assertionIdHash: assertionIdReference,
    upstreamCreatedAt: input.remoteCreatedAt.toISOString(),
    verifiedAt: now.toISOString(),
  });
  await client.query(
    `INSERT INTO tokenless_assurance_assertions
     (assertion_id, rater_id, binding_id, provider_id, provider_namespace,
      provider_assertion_hash, provider_assertion_id_hash, provider_assertion_reference_scheme,
      provider_assertion_key_version, capabilities_json, provider_evidence_ciphertext,
      provider_evidence_key_version, provider_evidence_key_domain, evidence_verified_at,
      evidence_expires_at, assurance_validity_model, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'hmac-sha256-v1',$8,$9,$10,$11,'world_id_enrollment',$12,$13,
             'durable_enrollment','active',$12,$12)`,
    [
      assertionId,
      raterId,
      bindingId,
      PROVIDER_ID,
      config.rpId,
      assertionHash,
      assertionIdReference,
      config.subjectHmacKeyVersion,
      JSON.stringify([CAPABILITY]),
      evidence,
      config.evidenceKeyVersion,
      now,
      credentialExpiresAt,
    ],
  );
  return {
    assertionId,
    credentialExpiresAt,
    continuity: "durable_account_enrollment" as const,
  };
}

export async function verifyWorldIdAssurance(input: { principalId: string; rawBody: string; now?: Date }) {
  const now = input.now ?? new Date();
  const config = loadConfig();
  let untrusted: Record<string, unknown>;
  try {
    untrusted = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    throw new TokenlessServiceError("World ID result must be valid JSON.", 400, "invalid_world_id_result");
  }
  if (typeof untrusted.nonce !== "string") {
    throw new TokenlessServiceError("World ID result nonce is missing.", 400, "invalid_world_id_result");
  }
  const requestResult = await dbClient.execute({
    sql: `SELECT request_id, rater_id, principal_id, account_address, provider_id, rp_id, app_id,
                 action_version, action, environment, mode, assurance_effect, nonce, credential_expires_at_min,
                 status, verify_attempt_count, created_at, expires_at
          FROM tokenless_world_id_requests WHERE rp_id = ? AND nonce = ? LIMIT 1`,
    args: [config.rpId, untrusted.nonce],
  });
  const request = requestResult.rows[0] as QueryRow | undefined;
  if (
    !request ||
    stringValue(request, "principal_id") !== input.principalId ||
    stringValue(request, "provider_id") !== PROVIDER_ID ||
    stringValue(request, "rp_id") !== config.rpId ||
    stringValue(request, "app_id") !== config.appId ||
    stringValue(request, "action_version") !== config.actionVersion ||
    stringValue(request, "action") !== config.action ||
    stringValue(request, "environment") !== config.environment ||
    stringValue(request, "mode") !== "initial_unique" ||
    stringValue(request, "assurance_effect") !== "bind_durable_unique_human"
  ) {
    throw new TokenlessServiceError("World ID request does not match this account.", 403, "world_id_request_mismatch");
  }
  if (stringValue(request, "status") !== "pending" || new Date(String(request.expires_at)) <= now) {
    throw new TokenlessServiceError("World ID request expired or was already used.", 409, "world_id_request_consumed");
  }
  const attempted = await dbClient.execute({
    sql: `UPDATE tokenless_world_id_requests
          SET verify_attempt_count = verify_attempt_count + 1, last_verify_attempt_at = ?
          WHERE request_id = ? AND status = 'pending' AND expires_at > ?
            AND verify_attempt_count < ?
          RETURNING verify_attempt_count`,
    args: [now, stringValue(request, "request_id"), now, MAX_VERIFY_ATTEMPTS],
  });
  if (attempted.rowCount !== 1) {
    throw new TokenlessServiceError("World ID verification attempt limit reached.", 429, "world_id_rate_limited", true);
  }
  const parsed = parseWorldResult(input.rawBody, request);
  const remote = await verifyWithWorld(input.rawBody, parsed, config);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await freezeActionAndKeys(client, config, now);
    const lockedResult = await client.query(
      `SELECT request_id, rater_id, principal_id, account_address, status, expires_at, mode
       FROM tokenless_world_id_requests WHERE request_id = $1 LIMIT 1 FOR UPDATE`,
      [stringValue(request, "request_id")],
    );
    const locked = lockedResult.rows[0] as QueryRow | undefined;
    if (
      !locked ||
      stringValue(locked, "principal_id") !== input.principalId ||
      stringValue(locked, "status") !== "pending" ||
      new Date(String(locked.expires_at)) <= now
    ) {
      throw new TokenlessServiceError(
        "World ID request expired or was already used.",
        409,
        "world_id_request_consumed",
      );
    }
    const profileResult = await client.query(
      `SELECT rater_id FROM tokenless_rater_profiles
       WHERE rater_id = $1 AND principal_id = $2 LIMIT 1 FOR UPDATE`,
      [stringValue(locked, "rater_id"), input.principalId],
    );
    if (profileResult.rowCount !== 1) {
      throw new TokenlessServiceError(
        "The World ID account binding is no longer available.",
        409,
        "world_id_binding_missing",
      );
    }
    const persisted = await persistInitial(client, { request, parsed, config, remoteCreatedAt: remote.createdAt, now });
    const consumed = await client.query(
      `UPDATE tokenless_world_id_requests
       SET status = 'verified', consumed_at = $1, assertion_id = $2
       WHERE request_id = $3 AND status = 'pending' AND expires_at > $1`,
      [now, persisted.assertionId, stringValue(request, "request_id")],
    );
    if (consumed.rowCount !== 1) {
      throw new TokenlessServiceError("World ID request was already used.", 409, "world_id_request_consumed");
    }
    await client.query("COMMIT");
    return {
      status: "verified" as const,
      providerId: PROVIDER_ID,
      capability: CAPABILITY,
      assuranceRefreshed: false,
      mode: parsed.mode,
      validityModel: "durable_enrollment" as const,
      continuity: persisted.continuity,
      credentialExpiresAt: persisted.credentialExpiresAt,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new TokenlessServiceError("World ID proof was already used.", 409, "world_id_replay");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getWorldIdAssuranceStatus(principalId: string) {
  const result = await dbClient.execute({
    sql: `SELECT a.evidence_verified_at, a.assurance_validity_model
          FROM tokenless_rater_profiles p
          JOIN tokenless_provider_subject_bindings b ON b.rater_id = p.rater_id
          JOIN tokenless_assurance_assertions a ON a.binding_id = b.binding_id
          WHERE p.principal_id = ? AND b.provider_id = ? AND b.status = 'active'
            AND a.status = 'active' AND a.capabilities_json LIKE '%"unique_human"%'
          ORDER BY a.evidence_verified_at DESC LIMIT 1`,
    args: [principalId, PROVIDER_ID],
  });
  const row = result.rows[0] as QueryRow | undefined;
  return {
    verified: Boolean(row),
    providerId: PROVIDER_ID,
    validityModel: row ? stringValue(row, "assurance_validity_model") : null,
    verifiedAt: row?.evidence_verified_at ? new Date(String(row.evidence_verified_at)).toISOString() : null,
  };
}

export function __setWorldIdAssuranceOverridesForTests(input: {
  config?: WorldIdConfig | null;
  signer?: SignWorldRequest | null;
  fetch?: WorldFetch | null;
}) {
  if (input.config !== undefined) configOverride = input.config;
  if (input.signer !== undefined) signerOverride = input.signer;
  if (input.fetch !== undefined) fetchOverride = input.fetch;
}

export const __worldIdAssuranceTestUtils = { canonicalField, loadConfig };
