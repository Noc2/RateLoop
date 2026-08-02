import "server-only";
import {
  createPlatformSecretManagedAttestationSigner,
  createRekorDssePublisher,
  createRfc3161TimestampAuthority,
} from "~~/lib/tokenless/assuranceAttestationExternalWitness";
import {
  type ManagedAttestationSigner,
  type RekorPublisher,
  type Rfc3161TimestampAuthority,
  countDueAssuranceAttestationJobsByTimestampRequirement,
  processAssuranceAttestationJobs,
} from "~~/lib/tokenless/assuranceAttestationPipeline";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type RuntimeDependencies = {
  signer: ManagedAttestationSigner;
  rekor: RekorPublisher;
  tsa?: Rfc3161TimestampAuthority;
};
type AttestationEnvironment = Record<string, string | undefined>;

let runtimeOverride: RuntimeDependencies | null = null;
let managedRuntime: Promise<RuntimeDependencies> | null = null;

const CORE_PRIVATE_ENV_NAMES = [
  "TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY",
  "TOKENLESS_ATTESTATION_SIGNING_KEY_ID",
  "TOKENLESS_ATTESTATION_REKOR_URL",
  "TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM",
] as const;
const TSA_PRIVATE_ENV_NAMES = [
  "TOKENLESS_ATTESTATION_TSA_URL",
  "TOKENLESS_ATTESTATION_TSA_CA_PEM",
  "TOKENLESS_ATTESTATION_TSA_UNTRUSTED_PEM",
] as const;
const PRIVATE_ENV_NAMES = [...CORE_PRIVATE_ENV_NAMES, ...TSA_PRIVATE_ENV_NAMES] as const;
const REQUIRED_TSA_ENV_NAMES = TSA_PRIVATE_ENV_NAMES.filter(name => name !== "TOKENLESS_ATTESTATION_TSA_UNTRUSTED_PEM");

function value(env: AttestationEnvironment, name: string) {
  return env[name]?.trim() ?? "";
}

function configurationState(env: AttestationEnvironment) {
  const publicNames = PRIVATE_ENV_NAMES.map(name => `NEXT_PUBLIC_${name}`);
  if (publicNames.some(name => value(env, name))) {
    return {
      configured: false,
      timestampingConfigured: false,
      error: "Attestation trust material must never use NEXT_PUBLIC_ variables.",
    } as const;
  }
  const corePresent = CORE_PRIVATE_ENV_NAMES.filter(name => value(env, name));
  const tsaPresent = TSA_PRIVATE_ENV_NAMES.filter(name => value(env, name));
  if (corePresent.length === 0 && tsaPresent.length === 0) {
    return { configured: false, timestampingConfigured: false, error: null } as const;
  }
  if (
    corePresent.length !== CORE_PRIVATE_ENV_NAMES.length ||
    (tsaPresent.length > 0 && REQUIRED_TSA_ENV_NAMES.some(name => !value(env, name)))
  ) {
    return {
      configured: false,
      timestampingConfigured: false,
      error: "Managed attestation runtime configuration is incomplete.",
    } as const;
  }
  return { configured: true, timestampingConfigured: tsaPresent.length > 0, error: null } as const;
}

function requirePublishedSignerKey(signer: ManagedAttestationSigner, env: AttestationEnvironment) {
  let entries: unknown;
  try {
    entries = JSON.parse(value(env, "TOKENLESS_EVIDENCE_VERIFICATION_KEYS"));
  } catch {
    throw new TokenlessServiceError(
      "Managed attestation signer is not present in the published verification keyring.",
      500,
      "invalid_attestation_config",
    );
  }
  const encodedPublicKey = signer.publicKeyDer.toString("base64url");
  const published =
    Array.isArray(entries) &&
    entries.some(
      entry =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        (entry as Record<string, unknown>).algorithm === "Ed25519" &&
        (entry as Record<string, unknown>).status === "current" &&
        (entry as Record<string, unknown>).keyId === signer.keyId &&
        (entry as Record<string, unknown>).publicKey === encodedPublicKey,
    );
  if (!published) {
    throw new TokenlessServiceError(
      "Managed attestation signer is not present in the published verification keyring.",
      500,
      "invalid_attestation_config",
    );
  }
}

async function buildRuntime(env: AttestationEnvironment): Promise<RuntimeDependencies> {
  const state = configurationState(env);
  if (!state.configured) {
    throw new TokenlessServiceError(
      state.error ?? "Managed attestation runtime is unavailable.",
      503,
      "attestation_runtime_unavailable",
      true,
    );
  }
  const signer = createPlatformSecretManagedAttestationSigner({
    expectedKeyId: value(env, "TOKENLESS_ATTESTATION_SIGNING_KEY_ID"),
    privateKey: value(env, "TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY"),
  });
  requirePublishedSignerKey(signer, env);
  const runtime: RuntimeDependencies = {
    signer,
    rekor: createRekorDssePublisher({
      logOrigin: value(env, "TOKENLESS_ATTESTATION_REKOR_URL"),
      signerPublicKeyDer: signer.publicKeyDer,
      trustedRekorPublicKeyPem: value(env, "TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM"),
    }),
  };
  if (state.timestampingConfigured) {
    runtime.tsa = createRfc3161TimestampAuthority({
      authorityUrl: value(env, "TOKENLESS_ATTESTATION_TSA_URL"),
      trustedCaPem: value(env, "TOKENLESS_ATTESTATION_TSA_CA_PEM"),
      untrustedChainPem: value(env, "TOKENLESS_ATTESTATION_TSA_UNTRUSTED_PEM") || undefined,
    });
  }
  return runtime;
}

async function getRuntime(env: AttestationEnvironment) {
  if (runtimeOverride) return runtimeOverride;
  managedRuntime ??= buildRuntime(env).catch(error => {
    managedRuntime = null;
    throw error;
  });
  return managedRuntime;
}

export async function processDueAssuranceAttestations(input: {
  now?: Date;
  limit?: number;
  env?: AttestationEnvironment;
  signal?: AbortSignal;
}) {
  const now = input.now ?? new Date();
  const dueCounts = await countDueAssuranceAttestationJobsByTimestampRequirement(now);
  const due = dueCounts.total;
  const state = runtimeOverride
    ? { configured: true, timestampingConfigured: Boolean(runtimeOverride.tsa), error: null }
    : configurationState(input.env ?? process.env);
  if (due === 0) {
    return {
      configured: state.configured && state.timestampingConfigured,
      due,
      completed: 0,
      retry: 0,
      dead: 0,
      unavailable: 0,
    };
  }
  if (!state.configured) {
    return { configured: false, due, completed: 0, retry: 0, dead: 0, unavailable: due };
  }
  let runtime: RuntimeDependencies;
  try {
    runtime = await getRuntime(input.env ?? process.env);
  } catch {
    return { configured: false, due, completed: 0, retry: 0, dead: 0, unavailable: due };
  }
  const unavailable = runtime.tsa ? 0 : dueCounts.timestampedExports;
  const common = {
    signer: runtime.signer,
    rekor: runtime.rekor,
    now,
    limit: input.limit,
    signal: input.signal,
  };
  const outcomes = runtime.tsa
    ? await processAssuranceAttestationJobs({ ...common, tsa: runtime.tsa })
    : await processAssuranceAttestationJobs({ ...common, scope: "decision_packet" });
  return {
    configured: unavailable === 0,
    due,
    completed: outcomes.filter(outcome => outcome.state === "completed").length,
    retry: outcomes.filter(outcome => outcome.state === "retry").length,
    dead: outcomes.filter(outcome => outcome.state === "dead").length,
    unavailable,
  };
}

export function __setAssuranceAttestationRuntimeForTests(value: RuntimeDependencies | null) {
  runtimeOverride = value;
  managedRuntime = null;
}

export const __assuranceAttestationRuntimeTestUtils = {
  buildRuntime,
  configurationState,
  requirePublishedSignerKey,
};
