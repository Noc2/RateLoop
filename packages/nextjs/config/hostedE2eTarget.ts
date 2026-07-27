const CANONICAL_TOKENLESS_HOST = "rateloop-tokenless.vercel.app";
const LEGACY_HOSTS = new Set(["rateloop.ai", "www.rateloop.ai", "rate-loop-nextjs.vercel.app"]);
const IMMUTABLE_TOKENLESS_HOST = /^rateloop-tokenless-(?!git-)[a-z0-9](?:[a-z0-9-]{4,61}[a-z0-9])?\.vercel\.app$/u;

type HostedE2eEnvironment = Record<string, string | undefined>;

export type HostedE2eTarget = {
  baseURL: string;
  expectedGitRef: "tokenless";
  expectedGitSha: string;
  kind: "canonical" | "immutable";
};

function value(env: HostedE2eEnvironment, name: string) {
  return env[name]?.trim() ?? "";
}

function exactOrigin(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("E2E_BASE_URL must be an absolute URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Hosted E2E targets must be a credential-free HTTPS origin.");
  }
  return parsed;
}

function explicitImmutableHost(env: HostedE2eEnvironment) {
  const host = value(env, "E2E_ALLOWED_IMMUTABLE_HOST").toLowerCase();
  if (!host) return null;
  if (host.includes("://") || host.includes("/") || !IMMUTABLE_TOKENLESS_HOST.test(host)) {
    throw new Error("E2E_ALLOWED_IMMUTABLE_HOST must name one exact immutable tokenless Vercel host.");
  }
  return host;
}

export function hostedE2eTarget(env: HostedE2eEnvironment = process.env): HostedE2eTarget {
  const target = exactOrigin(value(env, "E2E_BASE_URL"));
  const host = target.hostname.toLowerCase();
  const allowedImmutableHost = explicitImmutableHost(env);
  const expectedGitSha = value(env, "E2E_EXPECTED_GIT_SHA").toLowerCase();
  const expectedGitRef = value(env, "E2E_EXPECTED_GIT_REF") || "tokenless";

  if (LEGACY_HOSTS.has(host)) {
    throw new Error(`Hosted E2E refuses legacy host ${host}.`);
  }
  const kind =
    host === CANONICAL_TOKENLESS_HOST
      ? "canonical"
      : host === allowedImmutableHost && IMMUTABLE_TOKENLESS_HOST.test(host)
        ? "immutable"
        : null;
  if (!kind) {
    throw new Error("Hosted E2E target is not on the explicit tokenless allowlist.");
  }
  if (!/^[0-9a-f]{40}$/u.test(expectedGitSha)) {
    throw new Error("E2E_EXPECTED_GIT_SHA must be the full lowercase 40-character commit SHA.");
  }
  if (expectedGitRef !== "tokenless") {
    throw new Error("Hosted E2E may verify only the tokenless Git ref.");
  }

  return {
    baseURL: target.origin,
    expectedGitRef,
    expectedGitSha,
    kind,
  };
}
