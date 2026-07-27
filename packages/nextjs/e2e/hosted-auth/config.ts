import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOSTED_AUTH_ENV = {
  baseUrl: "TOKENLESS_E2E_BASE_URL",
  inboxProvider: "TOKENLESS_E2E_INBOX_PROVIDER",
  otpFromEmail: "TOKENLESS_E2E_OTP_FROM_EMAIL",
  ownerEmail: "TOKENLESS_E2E_OWNER_EMAIL",
  pollIntervalMs: "TOKENLESS_E2E_INBOX_POLL_INTERVAL_MS",
  pollTimeoutMs: "TOKENLESS_E2E_INBOX_POLL_TIMEOUT_MS",
  resendApiKey: "TOKENLESS_E2E_RESEND_RECEIVING_API_KEY",
  reviewerOneEmail: "TOKENLESS_E2E_REVIEWER_ONE_EMAIL",
  reviewerTwoEmail: "TOKENLESS_E2E_REVIEWER_TWO_EMAIL",
  storageStateDirectory: "TOKENLESS_E2E_STORAGE_STATE_DIRECTORY",
} as const;

export const HOSTED_AUTH_ROLES = ["owner", "reviewerOne", "reviewerTwo"] as const;
export type HostedAuthRole = (typeof HOSTED_AUTH_ROLES)[number];

type HostedAuthEnvironment = Record<string, string | undefined>;

export type HostedAuthAccount = {
  email: string;
  role: HostedAuthRole;
  storageStatePath: string;
};

export type HostedAuthConfig = {
  accounts: Record<HostedAuthRole, HostedAuthAccount>;
  baseUrl: string;
  inbox: {
    apiKey: string;
    expectedFrom: string;
    pollIntervalMs: number;
    pollTimeoutMs: number;
    provider: "resend";
  };
  storageStateDirectory: string;
};

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOKENLESS_HOSTED_ORIGIN = "https://rateloop-tokenless.vercel.app";
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;

function required(environment: HostedAuthEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the hosted authentication harness.`);
  return value;
}

export function normalizeHostedAuthMailbox(value: string, name = "mailbox") {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 320 ||
    normalized.includes("<") ||
    normalized.includes(">") ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    throw new Error(`${name} must be one bare email address.`);
  }
  const [localPart] = normalized.split("@");
  if (localPart?.includes("+")) {
    throw new Error(`${name} must be a dedicated mailbox, not a plus-address alias.`);
  }
  return normalized;
}

function mailboxAliasKey(mailbox: string) {
  const separator = mailbox.lastIndexOf("@");
  let localPart = mailbox.slice(0, separator);
  let domain = mailbox.slice(separator + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") localPart = localPart.replaceAll(".", "");
  return `${localPart}@${domain}`;
}

function assertDistinctMailboxes(accounts: Array<{ email: string; name: string }>) {
  const exact = new Map<string, string>();
  const aliases = new Map<string, string>();
  for (const account of accounts) {
    const exactCollision = exact.get(account.email);
    if (exactCollision) {
      throw new Error(`${account.name} must differ from ${exactCollision}.`);
    }
    exact.set(account.email, account.name);

    const aliasKey = mailboxAliasKey(account.email);
    const aliasCollision = aliases.get(aliasKey);
    if (aliasCollision) {
      throw new Error(`${account.name} must not alias ${aliasCollision}.`);
    }
    aliases.set(aliasKey, account.name);
  }
}

function boundedInteger(
  environment: HostedAuthEnvironment,
  name: string,
  defaults: { value: number; minimum: number; maximum: number },
) {
  const raw = environment[name]?.trim();
  if (!raw) return defaults.value;
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < defaults.minimum || parsed > defaults.maximum) {
    throw new Error(`${name} must be between ${defaults.minimum} and ${defaults.maximum}.`);
  }
  return parsed;
}

function hostedBaseUrl(environment: HostedAuthEnvironment) {
  const raw = required(environment, HOSTED_AUTH_ENV.baseUrl);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${HOSTED_AUTH_ENV.baseUrl} must be the isolated tokenless HTTPS origin.`);
  }
  if (
    parsed.origin !== TOKENLESS_HOSTED_ORIGIN ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${HOSTED_AUTH_ENV.baseUrl} must be exactly ${TOKENLESS_HOSTED_ORIGIN}.`);
  }
  return parsed.origin;
}

function stateDirectory(environment: HostedAuthEnvironment, packageRoot: string) {
  const configured = environment[HOSTED_AUTH_ENV.storageStateDirectory]?.trim();
  return configured ? path.resolve(packageRoot, configured) : path.join(packageRoot, "test-results", "hosted-auth");
}

export function readHostedAuthConfig(
  environment: HostedAuthEnvironment = process.env,
  options: { packageRoot?: string } = {},
): HostedAuthConfig {
  const baseUrl = hostedBaseUrl(environment);
  const provider = required(environment, HOSTED_AUTH_ENV.inboxProvider);
  if (provider !== "resend") {
    throw new Error(`${HOSTED_AUTH_ENV.inboxProvider} must be exactly resend.`);
  }

  const ownerEmail = normalizeHostedAuthMailbox(
    required(environment, HOSTED_AUTH_ENV.ownerEmail),
    HOSTED_AUTH_ENV.ownerEmail,
  );
  const reviewerOneEmail = normalizeHostedAuthMailbox(
    required(environment, HOSTED_AUTH_ENV.reviewerOneEmail),
    HOSTED_AUTH_ENV.reviewerOneEmail,
  );
  const reviewerTwoEmail = normalizeHostedAuthMailbox(
    required(environment, HOSTED_AUTH_ENV.reviewerTwoEmail),
    HOSTED_AUTH_ENV.reviewerTwoEmail,
  );
  assertDistinctMailboxes([
    { email: ownerEmail, name: HOSTED_AUTH_ENV.ownerEmail },
    { email: reviewerOneEmail, name: HOSTED_AUTH_ENV.reviewerOneEmail },
    { email: reviewerTwoEmail, name: HOSTED_AUTH_ENV.reviewerTwoEmail },
  ]);

  const expectedFrom = normalizeHostedAuthMailbox(
    required(environment, HOSTED_AUTH_ENV.otpFromEmail),
    HOSTED_AUTH_ENV.otpFromEmail,
  );
  const apiKey = required(environment, HOSTED_AUTH_ENV.resendApiKey);
  if (!/^re_[A-Za-z0-9_-]{8,}$/u.test(apiKey)) {
    throw new Error(`${HOSTED_AUTH_ENV.resendApiKey} is not a valid Resend API key.`);
  }

  const storageStateDirectory = stateDirectory(environment, options.packageRoot ?? PACKAGE_ROOT);
  const account = (role: HostedAuthRole, email: string, filename: string): HostedAuthAccount => ({
    email,
    role,
    storageStatePath: path.join(storageStateDirectory, filename),
  });

  return {
    accounts: {
      owner: account("owner", ownerEmail, "owner.storage.json"),
      reviewerOne: account("reviewerOne", reviewerOneEmail, "reviewer-one.storage.json"),
      reviewerTwo: account("reviewerTwo", reviewerTwoEmail, "reviewer-two.storage.json"),
    },
    baseUrl,
    inbox: {
      apiKey,
      expectedFrom,
      pollIntervalMs: boundedInteger(environment, HOSTED_AUTH_ENV.pollIntervalMs, {
        value: 2_000,
        minimum: 250,
        maximum: 10_000,
      }),
      pollTimeoutMs: boundedInteger(environment, HOSTED_AUTH_ENV.pollTimeoutMs, {
        value: 90_000,
        minimum: 10_000,
        maximum: 240_000,
      }),
      provider: "resend",
    },
    storageStateDirectory,
  };
}
