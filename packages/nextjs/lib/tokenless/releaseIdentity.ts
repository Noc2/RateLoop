export const TOKENLESS_RELEASE_PROJECT = Object.freeze({
  deploymentLine: "tokenless",
  projectId: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
  projectName: "rateloop-tokenless",
});

export const TOKENLESS_RELEASE_IDENTITY_SCHEMA = "rateloop.release-identity.v1";

type ReleaseEnvironment = Record<string, string | undefined>;

export type TokenlessReleaseIdentity = {
  schemaVersion: typeof TOKENLESS_RELEASE_IDENTITY_SCHEMA;
  deploymentLine: typeof TOKENLESS_RELEASE_PROJECT.deploymentLine;
  project: {
    id: typeof TOKENLESS_RELEASE_PROJECT.projectId;
    name: typeof TOKENLESS_RELEASE_PROJECT.projectName;
  };
  environment: "development" | "preview" | "production";
  git: {
    ref: string | null;
    sha: string | null;
  };
};

function value(env: ReleaseEnvironment, name: string) {
  return env[name]?.trim() ?? "";
}

function hostedEnvironment(env: ReleaseEnvironment) {
  return env.VERCEL === "1" || Boolean(value(env, "VERCEL_ENV"));
}

function safeGitRef(raw: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(raw);
}

export function tokenlessReleaseIdentity(env: ReleaseEnvironment = process.env): TokenlessReleaseIdentity {
  const hosted = hostedEnvironment(env);
  const environment = value(env, "VERCEL_ENV") || "development";
  const sha = value(env, "VERCEL_GIT_COMMIT_SHA");
  const ref = value(env, "VERCEL_GIT_COMMIT_REF");

  if (hosted) {
    if (
      value(env, "VERCEL_PROJECT_ID") !== TOKENLESS_RELEASE_PROJECT.projectId ||
      value(env, "VERCEL_PROJECT_NAME") !== TOKENLESS_RELEASE_PROJECT.projectName
    ) {
      throw new Error("Release identity is unavailable for an unexpected Vercel project.");
    }
    if (environment !== "production" && environment !== "preview") {
      throw new Error("Release identity requires a production or preview Vercel environment.");
    }
    if (!/^[0-9a-f]{40}$/u.test(sha)) {
      throw new Error("Release identity requires the full lowercase Git commit SHA.");
    }
    if (!safeGitRef(ref)) {
      throw new Error("Release identity requires a safe Git ref.");
    }
  } else if (environment !== "development") {
    throw new Error("Release identity cannot represent a hosted environment outside Vercel.");
  }

  return {
    schemaVersion: TOKENLESS_RELEASE_IDENTITY_SCHEMA,
    deploymentLine: TOKENLESS_RELEASE_PROJECT.deploymentLine,
    project: {
      id: TOKENLESS_RELEASE_PROJECT.projectId,
      name: TOKENLESS_RELEASE_PROJECT.projectName,
    },
    environment,
    git: {
      ref: ref || null,
      sha: sha || null,
    },
  };
}
