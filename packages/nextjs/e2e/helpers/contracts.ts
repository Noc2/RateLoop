/**
 * Contract addresses for local Anvil (chain 31337).
 *
 * Reads from the auto-generated deployedContracts.ts so addresses stay in sync
 * after redeploys.  The import uses a relative path because the E2E tests run
 * outside the Next.js bundler (no `~~/*` alias).
 */
import deployedContracts from "@rateloop/contracts/deployedContracts";

const chain31337 = (deployedContracts as Record<number, Record<string, { address: string }>>)[31337];
const reputationContract = chain31337.LoopReputation;

export const CONTRACT_ADDRESSES = {
  LoopReputation: reputationContract.address,
  AdvisoryVoteRecorder: chain31337.AdvisoryVoteRecorder.address,
  ContentRegistry: chain31337.ContentRegistry.address,
  RoundVotingEngine: chain31337.RoundVotingEngine.address,
  RoundRewardDistributor: chain31337.RoundRewardDistributor.address,
  FrontendRegistry: chain31337.FrontendRegistry.address,
  ClusterPayoutOracle: chain31337.ClusterPayoutOracle.address,
  ConfidentialityEscrow: chain31337.ConfidentialityEscrow.address,
  CategoryRegistry: chain31337.CategoryRegistry.address,
  QuestionRewardPoolEscrow: chain31337.QuestionRewardPoolEscrow.address,
  RaterRegistry: chain31337.RaterRegistry.address,
  MockERC20: chain31337.MockERC20.address,
} as const;
