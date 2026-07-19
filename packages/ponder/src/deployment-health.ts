import {
  isAddressEqual,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type { TokenlessDeployment } from "./protocol-deployment";

const panelHealthAbi = parseAbi([
  "function usdc() view returns (address)",
  "function credentialIssuer() view returns (address)",
  "function beaconVerifier() view returns (address)",
  "function SCORING_VERSION() view returns (uint8)",
  "function BASE_PAY_BPS() view returns (uint16)",
  "function MAXIMUM_COMMITS() view returns (uint32)",
]);

const feedbackBonusHealthAbi = parseAbi([
  "function usdc() view returns (address)",
  "function credentialIssuer() view returns (address)",
]);

const adapterHealthAbi = parseAbi([
  "function usdc() view returns (address)",
  "function panel() view returns (address)",
]);

export interface TokenlessDeploymentHealthClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBytecode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(args: Record<string, unknown>): Promise<unknown>;
}

export interface ValidatedTokenlessDeploymentHealth {
  chainId: number;
  chainHead: bigint;
  startBlock: number;
  usdcAddress: Address;
  adapterConfigured: boolean;
}

function deployed(code: Hex | undefined) {
  return Boolean(code && code !== "0x");
}

function addressResult(value: unknown, label: string): Address {
  if (typeof value !== "string") {
    throw new Error(`${label} did not return an address.`);
  }
  return value as Address;
}

export async function validateTokenlessDeploymentOnChain(
  client: TokenlessDeploymentHealthClient,
  deployment: TokenlessDeployment,
): Promise<ValidatedTokenlessDeploymentHealth> {
  const adapterConfigured = !isAddressEqual(
    deployment.adapterAddress,
    zeroAddress,
  );
  const [chainId, chainHead, panelCode, issuerCode, feedbackBonusCode, beaconVerifierCode] =
    await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.getBytecode({ address: deployment.panelAddress }),
      client.getBytecode({ address: deployment.issuerAddress }),
      client.getBytecode({ address: deployment.feedbackBonusAddress }),
      client.getBytecode({ address: deployment.beaconVerifierAddress }),
    ]);

  if (chainId !== deployment.chainId) {
    throw new Error(
      `Ponder RPC reports chain ${chainId}, expected ${deployment.chainId}.`,
    );
  }
  if (chainHead < BigInt(deployment.startBlock)) {
    throw new Error(
      `Ponder deployment block ${deployment.startBlock} is ahead of chain head ${chainHead}.`,
    );
  }
  for (const [label, code] of [
    ["TokenlessPanel", panelCode],
    ["CredentialIssuer", issuerCode],
    ["TokenlessFeedbackBonus", feedbackBonusCode],
    ["BeaconVerifier", beaconVerifierCode],
  ] as const) {
    if (!deployed(code)) throw new Error(`${label} has no deployed bytecode.`);
  }

  const [
    panelIssuerRaw,
    panelUsdcRaw,
    scoringVersion,
    basePayBps,
    maximumCommits,
    bonusIssuerRaw,
    bonusUsdcRaw,
    panelBeaconVerifierRaw,
  ] = await Promise.all([
    client.readContract({
      address: deployment.panelAddress,
      abi: panelHealthAbi,
      functionName: "credentialIssuer",
    }),
    client.readContract({
      address: deployment.panelAddress,
      abi: panelHealthAbi,
      functionName: "usdc",
    }),
    client.readContract({
      address: deployment.panelAddress,
      abi: panelHealthAbi,
      functionName: "SCORING_VERSION",
    }),
    client.readContract({
      address: deployment.panelAddress,
      abi: panelHealthAbi,
      functionName: "BASE_PAY_BPS",
    }),
    client.readContract({
      address: deployment.panelAddress,
      abi: panelHealthAbi,
      functionName: "MAXIMUM_COMMITS",
    }),
    client.readContract({
      address: deployment.feedbackBonusAddress,
      abi: feedbackBonusHealthAbi,
      functionName: "credentialIssuer",
    }),
    client.readContract({
      address: deployment.feedbackBonusAddress,
      abi: feedbackBonusHealthAbi,
      functionName: "usdc",
    }),
    client.readContract({
      address: deployment.panelAddress,
      abi: panelHealthAbi,
      functionName: "beaconVerifier",
    }),
  ]);
  const panelIssuer = addressResult(
    panelIssuerRaw,
    "TokenlessPanel credentialIssuer",
  );
  const panelUsdc = addressResult(panelUsdcRaw, "TokenlessPanel usdc");
  const bonusIssuer = addressResult(
    bonusIssuerRaw,
    "TokenlessFeedbackBonus credentialIssuer",
  );
  const bonusUsdc = addressResult(bonusUsdcRaw, "TokenlessFeedbackBonus usdc");
  const panelBeaconVerifier = addressResult(
    panelBeaconVerifierRaw,
    "TokenlessPanel beaconVerifier",
  );
  if (!isAddressEqual(panelBeaconVerifier, deployment.beaconVerifierAddress)) {
    throw new Error(
      "Tokenless panel beacon verifier wiring does not match the deployment identity.",
    );
  }
  if (
    !isAddressEqual(panelIssuer, deployment.issuerAddress) ||
    !isAddressEqual(bonusIssuer, deployment.issuerAddress)
  ) {
    throw new Error(
      "Tokenless panel and Feedback Bonus issuer wiring does not match the deployment identity.",
    );
  }
  if (!isAddressEqual(panelUsdc, bonusUsdc)) {
    throw new Error(
      "Tokenless panel and Feedback Bonus do not share the same USDC contract.",
    );
  }
  if (
    Number(scoringVersion) !== 2 ||
    Number(basePayBps) !== 8_000 ||
    Number(maximumCommits) !== 500
  ) {
    throw new Error(
      "TokenlessPanel mechanism constants do not match tokenless-v4.",
    );
  }
  const usdcCode = await client.getBytecode({ address: panelUsdc });
  if (!deployed(usdcCode))
    throw new Error("Tokenless USDC has no deployed bytecode.");

  if (adapterConfigured) {
    const [adapterCode, adapterPanelRaw, adapterUsdcRaw] = await Promise.all([
      client.getBytecode({ address: deployment.adapterAddress }),
      client.readContract({
        address: deployment.adapterAddress,
        abi: adapterHealthAbi,
        functionName: "panel",
      }),
      client.readContract({
        address: deployment.adapterAddress,
        abi: adapterHealthAbi,
        functionName: "usdc",
      }),
    ]);
    if (!deployed(adapterCode)) {
      throw new Error("X402PanelSubmitter has no deployed bytecode.");
    }
    const adapterPanel = addressResult(
      adapterPanelRaw,
      "X402PanelSubmitter panel",
    );
    const adapterUsdc = addressResult(
      adapterUsdcRaw,
      "X402PanelSubmitter usdc",
    );
    if (
      !isAddressEqual(adapterPanel, deployment.panelAddress) ||
      !isAddressEqual(adapterUsdc, panelUsdc)
    ) {
      throw new Error(
        "X402PanelSubmitter wiring does not match the tokenless panel and USDC.",
      );
    }
  }

  return {
    chainId,
    chainHead,
    startBlock: deployment.startBlock,
    usdcAddress: panelUsdc,
    adapterConfigured,
  };
}
