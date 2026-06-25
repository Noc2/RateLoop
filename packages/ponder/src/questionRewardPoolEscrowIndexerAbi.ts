import { QuestionRewardPoolEscrowAbi } from "@rateloop/contracts/abis";
import { parseAbi } from "viem";

const bundleRecoveryAndMonitoringEvents = parseAbi([
  "event RejectedSnapshotBundleRoundSetRecovered(uint256 indexed bundleId, uint256 indexed roundSetIndex, uint256 allocationReturned)",
  "event RecoveredSnapshotBundleRoundSetReopened(uint256 indexed bundleId, uint256 indexed roundSetIndex, bytes32 newWeightRoot)",
  "event QuestionBundleTerminalSkipped(uint256 indexed bundleId, uint256 indexed contentId, uint256 indexed roundId, uint8 reasonCode)",
]);

export const QuestionRewardPoolEscrowIndexerAbi = [
  ...QuestionRewardPoolEscrowAbi,
  ...bundleRecoveryAndMonitoringEvents,
] as const;
