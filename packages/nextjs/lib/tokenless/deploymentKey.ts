export const TOKENLESS_V4_BASE_SEPOLIA_DEPLOYMENT_KEY_SQL_PATTERN_SOURCE =
  "^tokenless-v4:84532:0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{40}$";

export const TOKENLESS_V4_BASE_SEPOLIA_DEPLOYMENT_KEY_PATTERN = new RegExp(
  TOKENLESS_V4_BASE_SEPOLIA_DEPLOYMENT_KEY_SQL_PATTERN_SOURCE,
  "u",
);

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

export function normalizeCompleteTokenlessDeploymentKey(value: string) {
  const normalized = value.toLowerCase();
  if (!TOKENLESS_V4_BASE_SEPOLIA_DEPLOYMENT_KEY_PATTERN.test(normalized)) return null;
  if (normalized.split(":").slice(2).includes(ZERO_ADDRESS)) return null;
  return normalized;
}

export function buildTokenlessDeploymentKey(input: {
  chainId: number;
  panelAddress: string;
  issuerAddress: string;
  x402SubmitterAddress: string;
  feedbackBonusAddress: string;
}) {
  const deploymentKey = [
    "tokenless-v4",
    input.chainId,
    input.panelAddress,
    input.issuerAddress,
    input.x402SubmitterAddress,
    input.feedbackBonusAddress,
  ]
    .join(":")
    .toLowerCase();
  const normalized = normalizeCompleteTokenlessDeploymentKey(deploymentKey);
  if (!normalized) throw new Error("Cannot build an incomplete tokenless-v4 Base Sepolia deployment key.");
  return normalized;
}
