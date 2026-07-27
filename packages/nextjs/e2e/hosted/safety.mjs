const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;

export const BASE_SEPOLIA_CHAIN_ID = "84532";
export const HARD_TESTNET_SPEND_CAP_ATOMIC = 10_000_000n;
export const HOSTED_RUN_MODES = ["smoke", "core", "funded"];
export const TOKENLESS_HOSTED_ORIGIN = "https://rateloop-tokenless.vercel.app";

export class HostedE2ESafetyError extends Error {
  constructor(errors) {
    super(`Hosted E2E safety checks failed:\n- ${errors.join("\n- ")}`);
    this.name = "HostedE2ESafetyError";
    this.errors = errors;
  }
}

function value(env, key) {
  const raw = env[key];
  return typeof raw === "string" ? raw.trim() : "";
}

function unsignedAtomic(raw, key, errors, { allowZero = false } = {}) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    errors.push(`${key} must be an unsigned base-10 atomic amount.`);
    return null;
  }
  const parsed = BigInt(raw);
  if (!allowZero && parsed === 0n) {
    errors.push(`${key} must be greater than zero.`);
    return null;
  }
  return parsed;
}

export function exactHostedTarget(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HostedE2ESafetyError(["E2E_BASE_URL must be an absolute URL."]);
  }
  const errors = [];
  if (parsed.protocol !== "https:") errors.push("E2E_BASE_URL must use HTTPS.");
  if (parsed.port || parsed.username || parsed.password) {
    errors.push("E2E_BASE_URL must not contain a port or credentials.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    errors.push("E2E_BASE_URL must identify the exact deployment origin without a path, query, or fragment.");
  }
  if (parsed.origin !== TOKENLESS_HOSTED_ORIGIN) {
    errors.push(`E2E_BASE_URL must be exactly ${TOKENLESS_HOSTED_ORIGIN}.`);
  }
  if (errors.length) throw new HostedE2ESafetyError(errors);
  return parsed.origin;
}

function dedicatedAddress(env, key, errors) {
  const address = value(env, key);
  if (!ADDRESS_PATTERN.test(address) || /^0x0{40}$/u.test(address.toLowerCase())) {
    errors.push(`${key} must be a dedicated non-zero EVM address.`);
    return null;
  }
  return address.toLowerCase();
}

export function assertFundedSpend(requestedAtomic, env = process.env) {
  const errors = [];
  if (value(env, "E2E_ALLOW_HOSTED_MUTATIONS") !== "true") {
    errors.push("E2E_ALLOW_HOSTED_MUTATIONS must be exactly true.");
  }
  if (value(env, "E2E_ALLOW_TESTNET_SPEND") !== "true") {
    errors.push("E2E_ALLOW_TESTNET_SPEND must be exactly true.");
  }
  if (value(env, "E2E_CHAIN_ID") !== BASE_SEPOLIA_CHAIN_ID) {
    errors.push(`E2E_CHAIN_ID must be exactly ${BASE_SEPOLIA_CHAIN_ID} (Base Sepolia).`);
  }
  const cap = unsignedAtomic(value(env, "E2E_TESTNET_SPEND_CAP_ATOMIC"), "E2E_TESTNET_SPEND_CAP_ATOMIC", errors);
  const requested = unsignedAtomic(String(requestedAtomic), "requested funded spend", errors);
  if (cap !== null && cap > HARD_TESTNET_SPEND_CAP_ATOMIC) {
    errors.push(`E2E_TESTNET_SPEND_CAP_ATOMIC exceeds the hard safety ceiling of ${HARD_TESTNET_SPEND_CAP_ATOMIC}.`);
  }
  if (cap !== null && requested !== null && requested > cap) {
    errors.push(`Requested funded spend ${requested} exceeds the configured atomic cap ${cap}.`);
  }
  if (errors.length) throw new HostedE2ESafetyError(errors);
  return { capAtomic: cap, requestedAtomic: requested };
}

export function validateHostedRun({ checkoutSha, env = process.env, mode }) {
  const errors = [];
  if (!HOSTED_RUN_MODES.includes(mode)) {
    errors.push(`mode must be one of ${HOSTED_RUN_MODES.join(", ")}.`);
  }

  let targetUrl = null;
  try {
    targetUrl = exactHostedTarget(value(env, "E2E_BASE_URL"));
  } catch (error) {
    if (error instanceof HostedE2ESafetyError) errors.push(...error.errors);
    else throw error;
  }

  const expectedSha = value(env, "E2E_EXPECTED_GIT_SHA");
  if (!SHA_PATTERN.test(expectedSha)) {
    errors.push("E2E_EXPECTED_GIT_SHA must be an exact lowercase 40-character SHA.");
  }
  if (!SHA_PATTERN.test(checkoutSha))
    errors.push("The checked-out commit must be an exact lowercase 40-character SHA.");
  if (SHA_PATTERN.test(expectedSha) && SHA_PATTERN.test(checkoutSha) && expectedSha !== checkoutSha) {
    errors.push("E2E_EXPECTED_GIT_SHA does not match the checked-out commit.");
  }

  if ((mode === "core" || mode === "funded") && value(env, "E2E_ALLOW_HOSTED_MUTATIONS") !== "true") {
    errors.push("E2E_ALLOW_HOSTED_MUTATIONS must be exactly true for a core hosted run.");
  }

  let spend = null;
  let dedicatedAddresses = null;
  if (mode === "funded") {
    try {
      spend = assertFundedSpend(value(env, "E2E_TESTNET_PLANNED_SPEND_ATOMIC"), env);
    } catch (error) {
      if (error instanceof HostedE2ESafetyError) errors.push(...error.errors);
      else throw error;
    }
    const addressKeys = [
      "E2E_TESTNET_FUNDER_ADDRESS",
      "E2E_TESTNET_REVIEWER_PAYOUT_ADDRESS",
      "E2E_TESTNET_AWARDER_ADDRESS",
      "E2E_TESTNET_KEEPER_ADDRESS",
    ];
    dedicatedAddresses = Object.fromEntries(addressKeys.map(key => [key, dedicatedAddress(env, key, errors)]));
    const configured = Object.values(dedicatedAddresses).filter(Boolean);
    if (new Set(configured).size !== configured.length) {
      errors.push("Funded-lane role addresses must be distinct dedicated accounts.");
    }
  }

  if (errors.length) throw new HostedE2ESafetyError([...new Set(errors)]);
  return {
    checkoutSha,
    dedicatedAddresses,
    expectedSha,
    mode,
    spend,
    targetUrl,
  };
}

export function safeHostedSummary(context) {
  return {
    chainId: context.mode === "funded" ? BASE_SEPOLIA_CHAIN_ID : null,
    checkoutSha: context.checkoutSha,
    dedicatedAddressRoles:
      context.dedicatedAddresses === null
        ? []
        : Object.entries(context.dedicatedAddresses)
            .filter(([, address]) => address !== null)
            .map(([key]) => key),
    expectedSha: context.expectedSha,
    mode: context.mode,
    spendCapAtomic: context.spend?.capAtomic?.toString() ?? null,
    targetUrl: context.targetUrl,
  };
}
