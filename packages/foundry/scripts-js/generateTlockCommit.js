import { Buffer } from "buffer";
import {
  createPublicClient,
  encodePacked,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { mainnetClient, timelockEncrypt } from "tlock-js";
import { deriveTlockCommitTargetRound } from "./tlockTargetRound.js";

function usage() {
  console.error(
    "Usage: node scripts-js/generateTlockCommit.js <rpcUrl> <votingEngine> <contentRegistry> <contentId> <isUp:true|false> <saltHex> <voterAddress> [predictedUpBps] [commitTimestampSeconds]"
  );
  process.exit(1);
}

const [
  rpcUrlArg,
  votingEngineArg,
  contentRegistryArg,
  contentIdArg,
  isUpArg,
  saltArg,
  voterArg,
  predictedUpBpsArg,
  commitTimestampArg,
] = process.argv.slice(2);

if (
  !rpcUrlArg ||
  !votingEngineArg ||
  !contentRegistryArg ||
  !contentIdArg ||
  !isUpArg ||
  !saltArg ||
  !voterArg
) {
  usage();
}

if (isUpArg !== "true" && isUpArg !== "false") {
  usage();
}

const votingEngineAbi = parseAbi([
  "function protocolConfig() view returns (address)",
  "function currentRoundId(uint256 contentId) view returns (uint256)",
  "function previewCommitContext(uint256 contentId) view returns (uint256 openRoundId, uint16 referenceRatingBps)",
  "function roundConfigSnapshot(uint256 contentId, uint256 roundId) view returns (uint32 epochDuration, uint32 maxDuration, uint16 minVoters, uint16 maxVoters)",
  "function roundCore(uint256 contentId, uint256 roundId) view returns (uint48 startTime, uint8 state, uint16 voteCount, uint16 revealedCount, uint64 totalStake, uint48 thresholdReachedAt, uint48 settledAt)",
]);
const contentRegistryAbi = parseAbi([
  "function getContentRoundConfig(uint256 contentId) view returns (uint32 epochDuration, uint32 maxDuration, uint16 minVoters, uint16 maxVoters)",
]);
const protocolConfigAbi = parseAbi([
  "function drandChainHash() view returns (bytes32)",
  "function drandGenesisTime() view returns (uint64)",
  "function drandPeriod() view returns (uint64)",
]);

const rpcUrl = rpcUrlArg;
const votingEngine = getAddress(votingEngineArg);
const contentRegistry = getAddress(contentRegistryArg);
const contentId = BigInt(contentIdArg);
const isUp = isUpArg === "true";
const salt = saltArg.startsWith("0x") ? saltArg : `0x${saltArg}`;
const voter = getAddress(voterArg);
const predictedUpBps =
  predictedUpBpsArg == null ? 5_000 : Number.parseInt(predictedUpBpsArg, 10);
const commitTimestampOverride =
  commitTimestampArg == null ? null : BigInt(commitTimestampArg);

if (salt.length !== 66) {
  throw new Error("saltHex must be 32 bytes");
}
if (
  !Number.isInteger(predictedUpBps) ||
  predictedUpBps < 0 ||
  predictedUpBps > 10_000
) {
  throw new Error("predictedUpBps must be an integer from 0 to 10000");
}
if (commitTimestampOverride != null && commitTimestampOverride <= 0n) {
  throw new Error("commitTimestampSeconds must be greater than zero");
}

const chainClient = createPublicClient({ transport: http(rpcUrl) });
const protocolConfig = await chainClient.readContract({
  address: votingEngine,
  abi: votingEngineAbi,
  functionName: "protocolConfig",
});
const drandChainHash = await chainClient.readContract({
  address: protocolConfig,
  abi: protocolConfigAbi,
  functionName: "drandChainHash",
});
const drandGenesisTimeRaw = await chainClient.readContract({
  address: protocolConfig,
  abi: protocolConfigAbi,
  functionName: "drandGenesisTime",
});
const drandGenesisTime = BigInt(drandGenesisTimeRaw);
const drandPeriodRaw = await chainClient.readContract({
  address: protocolConfig,
  abi: protocolConfigAbi,
  functionName: "drandPeriod",
});
const drandPeriod = BigInt(drandPeriodRaw);
const [previewRoundId, roundReferenceRatingBps] =
  await chainClient.readContract({
    address: votingEngine,
    abi: votingEngineAbi,
    functionName: "previewCommitContext",
    args: [contentId],
  });
const currentRoundId = await chainClient.readContract({
  address: votingEngine,
  abi: votingEngineAbi,
  functionName: "currentRoundId",
  args: [contentId],
});
const latestBlock = await chainClient.getBlock({ blockTag: "latest" });

let activeRoundStartTime = null;
let epochDuration = 0n;
if (currentRoundId === previewRoundId && currentRoundId > 0n) {
  const round = await chainClient.readContract({
    address: votingEngine,
    abi: votingEngineAbi,
    functionName: "roundCore",
    args: [contentId, currentRoundId],
  });
  const [startTime, state] = round;
  if (BigInt(state) === 0n && BigInt(startTime) > 0n) {
    activeRoundStartTime = BigInt(startTime);
  }

  const [snapshotEpochDuration] = await chainClient.readContract({
    address: votingEngine,
    abi: votingEngineAbi,
    functionName: "roundConfigSnapshot",
    args: [contentId, previewRoundId],
  });
  epochDuration = BigInt(snapshotEpochDuration);
}

if (epochDuration === 0n) {
  const [contentEpochDuration] = await chainClient.readContract({
    address: contentRegistry,
    abi: contentRegistryAbi,
    functionName: "getContentRoundConfig",
    args: [contentId],
  });
  epochDuration = BigInt(contentEpochDuration);
}

const commitTimestamp = commitTimestampOverride ?? latestBlock.timestamp;
const targetRound = deriveTlockCommitTargetRound({
  commitTimestamp,
  activeRoundStartTime,
  epochDuration,
  drandGenesisTime,
  drandPeriod,
});

const plaintext = Buffer.alloc(36);
plaintext[0] = 2;
plaintext[1] = isUp ? 1 : 0;
plaintext[2] = predictedUpBps >> 8;
plaintext[3] = predictedUpBps & 0xff;
Buffer.from(salt.slice(2), "hex").copy(plaintext, 4);

const client = mainnetClient();
const chainInfo = await client.chain().info();
const liveDrandChainHash = `0x${chainInfo.hash}`;
if (
  liveDrandChainHash.toLowerCase() !== drandChainHash.toLowerCase() ||
  BigInt(chainInfo.genesis_time) !== drandGenesisTime ||
  BigInt(chainInfo.period) !== drandPeriod
) {
  throw new Error(
    `On-chain drand config (${drandChainHash}, ${drandGenesisTime}, ${drandPeriod}) does not match tlock-js mainnet chain (${liveDrandChainHash}, ${chainInfo.genesis_time}, ${chainInfo.period})`
  );
}
const armored = await timelockEncrypt(Number(targetRound), plaintext, client);

const ciphertext = `0x${Buffer.from(armored, "utf-8").toString("hex")}`;
const commitHash = keccak256(
  encodePacked(
    [
      "bool",
      "uint16",
      "bytes32",
      "address",
      "uint256",
      "uint256",
      "uint16",
      "uint64",
      "bytes32",
      "bytes32",
    ],
    [
      isUp,
      predictedUpBps,
      salt,
      voter,
      contentId,
      previewRoundId,
      roundReferenceRatingBps,
      targetRound,
      drandChainHash,
      keccak256(ciphertext),
    ]
  )
);

process.stdout.write(
  `${commitHash}\n${ciphertext}\n${targetRound}\n${drandChainHash}\n${roundReferenceRatingBps}\n${previewRoundId}\n`
);
