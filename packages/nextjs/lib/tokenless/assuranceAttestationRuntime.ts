import "server-only";
import {
  managedAssuranceAttestationConfigurationState,
  resolveManagedAssuranceAttestationConfiguration,
} from "~~/lib/tokenless/assuranceAttestationConfiguration.mjs";
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

async function buildRuntime(env: AttestationEnvironment): Promise<RuntimeDependencies> {
  let configuration: ReturnType<typeof resolveManagedAssuranceAttestationConfiguration>;
  try {
    configuration = resolveManagedAssuranceAttestationConfiguration(env);
  } catch (error) {
    throw new TokenlessServiceError(
      error instanceof Error ? error.message : "Managed attestation runtime is unavailable.",
      503,
      "attestation_runtime_unavailable",
      true,
    );
  }
  const signer = createPlatformSecretManagedAttestationSigner({
    expectedKeyId: configuration.signer.keyId,
    privateKey: configuration.signer.privateKey,
  });
  const runtime: RuntimeDependencies = {
    signer,
    rekor: createRekorDssePublisher({
      logOrigin: configuration.rekor.logOrigin,
      signerPublicKeyDer: signer.publicKeyDer,
      trustedRekorPublicKeyPem: configuration.rekor.trustedPublicKeyPem,
    }),
  };
  if (configuration.tsa) {
    runtime.tsa = createRfc3161TimestampAuthority({
      authorityUrl: configuration.tsa.authorityUrl,
      trustedCaPem: configuration.tsa.trustedCaPem,
      untrustedChainPem: configuration.tsa.untrustedChainPem,
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
  let state;
  if (runtimeOverride) {
    state = { configured: true, timestampingConfigured: Boolean(runtimeOverride.tsa), error: null };
  } else {
    try {
      const configuration = resolveManagedAssuranceAttestationConfiguration(input.env ?? process.env);
      state = { configured: true, timestampingConfigured: Boolean(configuration.tsa), error: null };
    } catch (error) {
      state = {
        configured: false,
        timestampingConfigured: false,
        error: error instanceof Error ? error.message : "Managed attestation runtime is unavailable.",
      };
    }
  }
  if (due === 0) {
    return {
      configured: state.configured,
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
  configurationState: managedAssuranceAttestationConfigurationState,
};
