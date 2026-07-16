import "server-only";
import {
  type AwsKmsCredential,
  createAwsKmsManagedAttestationSigner,
  createRekorDssePublisher,
  createRfc3161TimestampAuthority,
} from "~~/lib/tokenless/assuranceAttestationExternalWitness";
import {
  type ManagedAttestationSigner,
  type RekorPublisher,
  type Rfc3161TimestampAuthority,
  countDueAssuranceAttestationJobs,
  processAssuranceAttestationJobs,
} from "~~/lib/tokenless/assuranceAttestationPipeline";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const CREDENTIAL_REFERENCE = /^sec_[0-9a-f]{48}$/u;

type RuntimeDependencies = {
  signer: ManagedAttestationSigner;
  rekor: RekorPublisher;
  tsa: Rfc3161TimestampAuthority;
};
type AttestationEnvironment = Record<string, string | undefined>;

let runtimeOverride: RuntimeDependencies | null = null;
let managedRuntime: Promise<RuntimeDependencies> | null = null;

const PRIVATE_ENV_NAMES = [
  "TOKENLESS_ATTESTATION_KMS_KEY_ARN",
  "TOKENLESS_ATTESTATION_KMS_REGION",
  "TOKENLESS_ATTESTATION_AWS_CREDENTIAL_REFERENCE",
  "TOKENLESS_ATTESTATION_AWS_CREDENTIALS_JSON",
  "TOKENLESS_ATTESTATION_REKOR_URL",
  "TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM",
  "TOKENLESS_ATTESTATION_TSA_URL",
  "TOKENLESS_ATTESTATION_TSA_CA_PEM",
] as const;

function value(env: AttestationEnvironment, name: string) {
  return env[name]?.trim() ?? "";
}

function configurationState(env: AttestationEnvironment) {
  const publicNames = PRIVATE_ENV_NAMES.map(name => `NEXT_PUBLIC_${name}`);
  if (publicNames.some(name => value(env, name))) {
    return { configured: false, error: "Attestation trust material must never use NEXT_PUBLIC_ variables." } as const;
  }
  const present = PRIVATE_ENV_NAMES.filter(name => value(env, name));
  if (present.length === 0) return { configured: false, error: null } as const;
  if (present.length !== PRIVATE_ENV_NAMES.length) {
    return { configured: false, error: "Managed attestation runtime configuration is incomplete." } as const;
  }
  return { configured: true, error: null } as const;
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
  const credentialReference = value(env, "TOKENLESS_ATTESTATION_AWS_CREDENTIAL_REFERENCE");
  if (!CREDENTIAL_REFERENCE.test(credentialReference)) {
    throw new TokenlessServiceError(
      "Managed attestation credential reference is invalid.",
      500,
      "invalid_attestation_config",
    );
  }
  let credentials: Record<string, AwsKmsCredential>;
  try {
    credentials = JSON.parse(value(env, "TOKENLESS_ATTESTATION_AWS_CREDENTIALS_JSON")) as Record<
      string,
      AwsKmsCredential
    >;
  } catch {
    throw new TokenlessServiceError(
      "Managed attestation credential map is invalid.",
      500,
      "invalid_attestation_config",
    );
  }
  const resolveCredential = async () => {
    const credential = credentials[credentialReference];
    if (!credential) {
      throw new TokenlessServiceError(
        "Managed attestation credential reference could not be resolved.",
        503,
        "attestation_credential_unavailable",
        true,
      );
    }
    return credential;
  };
  const signer = await createAwsKmsManagedAttestationSigner({
    keyArn: value(env, "TOKENLESS_ATTESTATION_KMS_KEY_ARN"),
    region: value(env, "TOKENLESS_ATTESTATION_KMS_REGION"),
    resolveCredential,
  });
  requirePublishedSignerKey(signer, env);
  return {
    signer,
    rekor: createRekorDssePublisher({
      logOrigin: value(env, "TOKENLESS_ATTESTATION_REKOR_URL"),
      signerPublicKeyDer: signer.publicKeyDer,
      trustedRekorPublicKeyPem: value(env, "TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM"),
    }),
    tsa: createRfc3161TimestampAuthority({
      authorityUrl: value(env, "TOKENLESS_ATTESTATION_TSA_URL"),
      trustedCaPem: value(env, "TOKENLESS_ATTESTATION_TSA_CA_PEM"),
      untrustedChainPem: value(env, "TOKENLESS_ATTESTATION_TSA_UNTRUSTED_PEM") || undefined,
    }),
  };
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
}) {
  const now = input.now ?? new Date();
  const due = await countDueAssuranceAttestationJobs(now);
  const state = runtimeOverride ? { configured: true, error: null } : configurationState(input.env ?? process.env);
  if (due === 0) {
    return { configured: state.configured, due, completed: 0, retry: 0, dead: 0, unavailable: 0 };
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
  const outcomes = await processAssuranceAttestationJobs({
    ...runtime,
    now,
    limit: input.limit,
  });
  return {
    configured: true,
    due,
    completed: outcomes.filter(outcome => outcome.state === "completed").length,
    retry: outcomes.filter(outcome => outcome.state === "retry").length,
    dead: outcomes.filter(outcome => outcome.state === "dead").length,
    unavailable: 0,
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
