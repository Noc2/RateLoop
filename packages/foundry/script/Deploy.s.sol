// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { console } from "forge-std/console.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { AdvisoryVoteRecorder } from "../contracts/AdvisoryVoteRecorder.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { CategoryRegistry } from "../contracts/CategoryRegistry.sol";
import { FeedbackBonusEscrow } from "../contracts/FeedbackBonusEscrow.sol";
import { FeedbackRegistry } from "../contracts/FeedbackRegistry.sol";
import { ProfileRegistry } from "../contracts/ProfileRegistry.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { QuestionRewardPoolEscrow } from "../contracts/QuestionRewardPoolEscrow.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { X402QuestionSubmitter } from "../contracts/X402QuestionSubmitter.sol";
import { LaunchDistributionPool } from "../contracts/LaunchDistributionPool.sol";
import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { MockWorldIDVerifier } from "../contracts/mocks/MockWorldIDVerifier.sol";
import { RateLoopGovernor } from "../contracts/governance/RateLoopGovernor.sol";

/// @notice Fresh RateLoop deployment script for World Chain.
/// @dev Rater identity is resolved through RaterRegistry; no separate proof-of-personhood token is deployed.
contract DeployRateLoop is ScaffoldETHDeploy {
    error UnsupportedWorldChain(uint256 chainId);
    error WorldIdVerifierHasNoCode(address verifier);
    error MainnetWorldIdVerifierOverrideNotAllowed(address verifier);
    uint256 public constant TIMELOCK_MIN_DELAY = 2 days;

    uint256 public constant TOTAL_SUPPLY_CAP = 100_000_000 * 1e6;
    uint256 public constant TREASURY_AMOUNT = 25_000_000 * 1e6;
    uint256 public constant LAUNCH_DISTRIBUTION_AMOUNT = TOTAL_SUPPLY_CAP - TREASURY_AMOUNT;
    uint256 public constant WORLD_CHAIN_SEPOLIA_TEST_LREP_AMOUNT = 250 * 1e6;
    bytes32 public constant LEGACY_CONTRIBUTOR_ROOT =
        0xcaa28d15e6c6c1bb47d347a413cb808e40c38a7e43171ce9a131983a92b97d18;
    uint256 public constant LEGACY_CONTRIBUTOR_ALLOCATION_TOTAL = 9_000_000 * 1e6;
    bytes32 internal constant ERC1967_ADMIN_SLOT = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);

    address internal constant WORLD_CHAIN_MAINNET_USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address internal constant WORLD_CHAIN_SEPOLIA_USDC = 0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88;
    address internal constant WORLD_CHAIN_WORLD_ID_V4_VERIFIER = 0x00000000009E00F9FE82CfeeBB4556686da094d7;
    string internal constant WORLD_ID_V4_VERIFIER_ADDRESS_ENV = "WORLD_ID_V4_VERIFIER_ADDRESS";
    uint64 internal constant WORLD_ID_CREDENTIAL_TTL_SECONDS = 365 days;
    uint64 internal constant WORLD_ID_PRESENCE_TTL_SECONDS = 15 minutes;
    uint64 internal constant DEFAULT_WORLD_ID_V4_RP_ID = 1;
    uint64 internal constant DEFAULT_WORLD_ID_ISSUER_SCHEMA_ID = 1;
    string internal constant DEFAULT_WORLD_ID_ACTION = "rateloop-human-credential-v1";
    string internal constant DEFAULT_WORLD_ID_PRESENCE_ACTION = "rateloop-human-presence-v1";

    // DRAND-1 (2026-05-21 testnet-readiness audit): per-chain drand `(chainHash, genesisTime,
    // period)` triples. `quicknet` (mainnet) and `quicknet-t` (testnet) are independent drand
    // chains with different BLS G1 public keys — encrypting with one and validating against the
    // other silently fails, so every chain must commit to its own values at deploy time.
    // Mainnet values mirror `ProtocolConfig.MAINNET_DRAND_*` constants; duplicated here because
    // they're referenced at deploy time before the contract is constructed. Source:
    // https://docs.drand.love/blog/2023/10/16/quicknet-is-live/
    bytes32 internal constant MAINNET_DRAND_CHAIN_HASH =
        0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
    uint64 internal constant MAINNET_DRAND_GENESIS_TIME = 1_692_803_367;
    uint64 internal constant MAINNET_DRAND_PERIOD = 3;
    bytes32 internal constant TESTNET_DRAND_CHAIN_HASH =
        0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5;
    uint64 internal constant TESTNET_DRAND_GENESIS_TIME = 1_689_232_296;
    uint64 internal constant TESTNET_DRAND_PERIOD = 3;

    struct WorldIdDeployConfig {
        address verifier;
        uint64 rpId;
        uint256 credentialAction;
        uint256 presenceAction;
        uint64 credentialTtl;
        uint64 presenceTtl;
        uint64 issuerSchemaId;
        uint256 credentialGenesisIssuedAtMin;
    }

    function _preBroadcastChecks() internal view override {
        if (block.chainid != 31337 && block.chainid != 480 && block.chainid != 4801) {
            revert UnsupportedWorldChain(block.chainid);
        }
        if (block.chainid == 480 || block.chainid == 4801) {
            _validateUsdcToken(_resolveWorldChainUsdcAddress());
            _resolveWorldIdVerifierAddress(false);
        }
    }

    function run() external ScaffoldEthDeployerRunner {
        bool isLocalDev = block.chainid == 31337;

        address governance;
        address governorAddr;
        TimelockController timelock;
        RateLoopGovernor governor;

        if (isLocalDev) {
            governance = deployer;
            governorAddr = deployer;
            console.log("Local dev: deployer is governance + treasury");
        } else {
            address[] memory proposers = new address[](0);
            address[] memory executors = new address[](1);
            // L-Gov-A: open-executor pattern (`address(0)` in the executors set) lets anyone
            // call `execute` once the timelock delay elapses. Documented as a deliberate trade-off
            // against single-point-of-failure executor multisig downtime, but it does mean MEV
            // bots can race to extract embedded MEV from queued proposals (e.g. parameter-change
            // vs snapshot-or-claim races, pool migrations). Runbook for governance: every queued
            // proposal MUST be MEV-safe under arbitrary executor identity. If a proposal is
            // sequence-sensitive against external state, gate it on the same block via an
            // off-chain commit-reveal or convert to a multisig-only flow before queuing.
            executors[0] = address(0);

            timelock = new TimelockController(TIMELOCK_MIN_DELAY, proposers, executors, deployer);
            governance = address(timelock);
            console.log("TimelockController deployed at:", governance);
        }

        LoopReputation lrepToken = new LoopReputation(deployer, governance);
        console.log("LoopReputation deployed at:", address(lrepToken));

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine votingEngineImpl = new RoundVotingEngine();
        RoundRewardDistributor rewardDistributorImpl = new RoundRewardDistributor();
        FrontendRegistry frontendRegistryImpl = new FrontendRegistry();
        ProfileRegistry profileRegistryImpl = new ProfileRegistry();
        ProtocolConfig protocolConfigImpl = new ProtocolConfig();
        QuestionRewardPoolEscrow questionRewardPoolEscrowImpl = new QuestionRewardPoolEscrow();
        FeedbackBonusEscrow feedbackBonusEscrowImpl = new FeedbackBonusEscrow();
        FeedbackRegistry feedbackRegistryImpl = new FeedbackRegistry();

        TransparentUpgradeableProxy frontendRegistryProxy = new TransparentUpgradeableProxy(
            address(frontendRegistryImpl),
            governance,
            abi.encodeCall(FrontendRegistry.initialize, (deployer, governance, address(lrepToken)))
        );
        FrontendRegistry frontendRegistry = FrontendRegistry(address(frontendRegistryProxy));

        TransparentUpgradeableProxy profileRegistryProxy = new TransparentUpgradeableProxy(
            address(profileRegistryImpl), governance, abi.encodeCall(ProfileRegistry.initialize, (deployer, governance))
        );
        ProfileRegistry profileRegistry = ProfileRegistry(address(profileRegistryProxy));

        TransparentUpgradeableProxy registryProxy = new TransparentUpgradeableProxy(
            address(registryImpl),
            governance,
            abi.encodeCall(
                ContentRegistry.initializeWithTreasury, (deployer, governance, governance, address(lrepToken))
            )
        );
        ContentRegistry registry = ContentRegistry(address(registryProxy));

        // DRAND-1 (2026-05-21 testnet-readiness audit): use the drand-aware initializer so the
        // testnet path (chainId 4801) explicitly commits to `quicknet-t` instead of silently
        // inheriting the mainnet `quicknet` defaults. Mainnet (480) keeps the mainnet defaults.
        // Local dev (31337) also uses mainnet defaults — the local Anvil chain doesn't actually
        // validate drand signatures end-to-end, so the value is cosmetic there.
        (bytes32 chainDrandHash, uint64 chainDrandGenesis, uint64 chainDrandPeriod) = _resolveDrandConfig();
        TransparentUpgradeableProxy protocolConfigProxy = new TransparentUpgradeableProxy(
            address(protocolConfigImpl),
            governance,
            abi.encodeCall(
                ProtocolConfig.initializeWithDrandConfig,
                (deployer, governance, governance, chainDrandHash, chainDrandGenesis, chainDrandPeriod)
            )
        );
        ProtocolConfig protocolConfig = ProtocolConfig(address(protocolConfigProxy));

        TransparentUpgradeableProxy votingEngineProxy = new TransparentUpgradeableProxy(
            address(votingEngineImpl),
            governance,
            abi.encodeCall(
                RoundVotingEngine.initialize,
                (governance, address(lrepToken), address(registry), address(protocolConfig))
            )
        );
        RoundVotingEngine votingEngine = RoundVotingEngine(address(votingEngineProxy));

        TransparentUpgradeableProxy rewardDistributorProxy = new TransparentUpgradeableProxy(
            address(rewardDistributorImpl),
            governance,
            abi.encodeCall(
                RoundRewardDistributor.initialize,
                (governance, address(lrepToken), address(votingEngine), address(registry))
            )
        );
        RoundRewardDistributor rewardDistributor = RoundRewardDistributor(address(rewardDistributorProxy));

        MockWorldIDVerifier worldIdMockVerifier;
        address worldIdVerifierAddress = _resolveWorldIdVerifierAddress(isLocalDev);
        bool deployWorldIdMockVerifier = _shouldDeployWorldIdMockVerifier(isLocalDev, worldIdVerifierAddress);
        if (deployWorldIdMockVerifier) {
            worldIdMockVerifier = new MockWorldIDVerifier();
            worldIdVerifierAddress = address(worldIdMockVerifier);
            console.log("MockWorldIDVerifier deployed at:", worldIdVerifierAddress);
        } else if (worldIdVerifierAddress == address(0)) {
            console.log("World ID v4 verifier unavailable; deploying with World ID verifier disabled");
        } else {
            console.log("World ID v4 verifier resolved at:", worldIdVerifierAddress);
        }
        WorldIdDeployConfig memory worldIdConfig = _resolveWorldIdDeployConfig(worldIdVerifierAddress);

        address usdcTokenAddress;
        MockERC20 localUsdcToken;
        if (isLocalDev) {
            localUsdcToken = new MockERC20("USD Coin", "USDC", 6);
            usdcTokenAddress = address(localUsdcToken);
            console.log("Mock USDC deployed at:", usdcTokenAddress);
        } else {
            usdcTokenAddress = _resolveWorldChainUsdcAddress();
            _validateUsdcToken(usdcTokenAddress);
            console.log("Circle USDC resolved at:", usdcTokenAddress);
        }

        CategoryRegistry categoryRegistry = new CategoryRegistry(deployer, governance);
        RaterRegistry raterRegistryImpl = new RaterRegistry(
            deployer,
            governance,
            worldIdConfig.verifier,
            worldIdConfig.rpId,
            worldIdConfig.credentialAction,
            worldIdConfig.presenceAction,
            worldIdConfig.credentialTtl,
            worldIdConfig.presenceTtl,
            worldIdConfig.issuerSchemaId,
            worldIdConfig.credentialGenesisIssuedAtMin
        );
        TransparentUpgradeableProxy raterRegistryProxy = new TransparentUpgradeableProxy(
            address(raterRegistryImpl),
            governance,
            abi.encodeCall(
                RaterRegistry.initialize,
                (
                    deployer,
                    governance,
                    worldIdConfig.verifier,
                    worldIdConfig.rpId,
                    worldIdConfig.credentialAction,
                    worldIdConfig.presenceAction,
                    worldIdConfig.credentialTtl,
                    worldIdConfig.presenceTtl,
                    worldIdConfig.issuerSchemaId,
                    worldIdConfig.credentialGenesisIssuedAtMin
                )
            )
        );
        RaterRegistry raterRegistry = RaterRegistry(address(raterRegistryProxy));
        TransparentUpgradeableProxy questionRewardPoolEscrowProxy = new TransparentUpgradeableProxy(
            address(questionRewardPoolEscrowImpl),
            governance,
            abi.encodeCall(
                QuestionRewardPoolEscrow.initialize,
                (
                    governance,
                    address(lrepToken),
                    usdcTokenAddress,
                    address(registry),
                    address(votingEngine),
                    address(raterRegistry)
                )
            )
        );
        QuestionRewardPoolEscrow questionRewardPoolEscrow =
            QuestionRewardPoolEscrow(address(questionRewardPoolEscrowProxy));

        X402QuestionSubmitter x402QuestionSubmitter =
            new X402QuestionSubmitter(registry, usdcTokenAddress, address(questionRewardPoolEscrow), governance);

        TransparentUpgradeableProxy feedbackRegistryProxy = new TransparentUpgradeableProxy(
            address(feedbackRegistryImpl),
            governance,
            abi.encodeCall(FeedbackRegistry.initialize, (deployer, governance, address(votingEngine)))
        );
        FeedbackRegistry feedbackRegistry = FeedbackRegistry(address(feedbackRegistryProxy));

        TransparentUpgradeableProxy feedbackBonusEscrowProxy = new TransparentUpgradeableProxy(
            address(feedbackBonusEscrowImpl),
            governance,
            abi.encodeCall(
                FeedbackBonusEscrow.initialize,
                (
                    governance,
                    address(lrepToken),
                    usdcTokenAddress,
                    address(registry),
                    address(votingEngine),
                    address(raterRegistry),
                    address(feedbackRegistry)
                )
            )
        );
        FeedbackBonusEscrow feedbackBonusEscrow = FeedbackBonusEscrow(address(feedbackBonusEscrowProxy));
        if (!isLocalDev) {
            feedbackRegistry.renounceRole(feedbackRegistry.CONFIG_ROLE(), deployer);
        }

        // Bracket the first setVotingEngine AND setQuestionRewardPoolEscrow calls with
        // pause/unpause so the deploy script exercises the same observable state as a future
        // rotation (L-Identity-5, L-Identity-7).
        registry.pause();
        registry.setVotingEngine(address(votingEngine));
        registry.setQuestionRewardPoolEscrow(address(questionRewardPoolEscrow));
        registry.unpause();
        registry.setProtocolConfig(address(protocolConfig));
        registry.setCategoryRegistry(address(categoryRegistry));
        registry.grantRole(registry.X402_GATEWAY_ROLE(), address(x402QuestionSubmitter));

        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setFrontendRegistry(address(frontendRegistry));
        protocolConfig.setCategoryRegistry(address(categoryRegistry));
        protocolConfig.setRaterRegistry(address(raterRegistry));
        if (!isLocalDev) {
            registry.renounceRole(registry.CONFIG_ROLE(), deployer);
            registry.renounceRole(registry.PAUSER_ROLE(), deployer);
        }

        profileRegistry.setRaterRegistry(address(raterRegistry));
        if (!isLocalDev) {
            profileRegistry.renounceRole(profileRegistry.ADMIN_ROLE(), deployer);
        }

        frontendRegistry.setVotingEngine(address(votingEngine));
        frontendRegistry.initializeFeeCreditor(address(rewardDistributor));
        if (!isLocalDev) {
            frontendRegistry.renounceRole(frontendRegistry.ADMIN_ROLE(), deployer);
        }

        _seedCategories(categoryRegistry);
        if (!isLocalDev) {
            categoryRegistry.renounceRole(categoryRegistry.ADMIN_ROLE(), deployer);
        }
        protocolConfig.setConfig(20 minutes, 20 minutes, 3, 100);

        lrepToken.mint(governance, _treasuryMintAmountForChain(block.chainid));
        console.log("Minted LREP treasury allocation");

        LaunchDistributionPool launchDistributionPool =
            new LaunchDistributionPool(address(lrepToken), address(raterRegistry), governance);
        raterRegistry.grantRole(raterRegistry.LAUNCH_CONSUMER_ROLE(), address(launchDistributionPool));
        if (block.chainid == 4801) {
            _fundWorldChainSepoliaTestingAccounts(lrepToken, raterRegistry);
        }
        if (!isLocalDev) {
            _renounceRaterRegistryDeployerRoles(raterRegistry, deployer);
        }
        ClusterPayoutOracle clusterPayoutOracle =
            new ClusterPayoutOracle(deployer, address(frontendRegistry), usdcTokenAddress);
        // M-Oracle-1 (PR #20): the launch-credit consumer pin on the oracle MUST be set BEFORE
        // `setClusterPayoutOracle` because `_validateClusterPayoutOracle` now verifies the new
        // oracle routes the launch-credit domain back to this pool. Bootstrap order:
        //   1. deploy launch pool (above)
        //   2. set oracle's consumer pin → launch pool
        //   3. setRoundClusterReadyAtSource on the launch pool
        //   4. setClusterPayoutOracle on the launch pool
        clusterPayoutOracle.setRoundPayoutSnapshotConsumer(
            clusterPayoutOracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(questionRewardPoolEscrow)
        );
        clusterPayoutOracle.setRoundPayoutSnapshotConsumer(
            clusterPayoutOracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(launchDistributionPool)
        );
        if (!isLocalDev) {
            clusterPayoutOracle.grantRole(clusterPayoutOracle.DEFAULT_ADMIN_ROLE(), governance);
            clusterPayoutOracle.grantRole(clusterPayoutOracle.CONFIG_ROLE(), governance);
            clusterPayoutOracle.grantRole(clusterPayoutOracle.ARBITER_ROLE(), governance);
            clusterPayoutOracle.setOracleConfig(
                clusterPayoutOracle.challengeWindow(), clusterPayoutOracle.challengeBond(), governance
            );
            clusterPayoutOracle.renounceRole(clusterPayoutOracle.ARBITER_ROLE(), deployer);
            clusterPayoutOracle.renounceRole(clusterPayoutOracle.CONFIG_ROLE(), deployer);
            clusterPayoutOracle.renounceRole(clusterPayoutOracle.DEFAULT_ADMIN_ROLE(), deployer);
        }
        protocolConfig.setClusterPayoutOracle(address(clusterPayoutOracle));
        // M-Oracle-1: wire the launch pool to the voting engine so its
        // `roundPayoutSnapshotSourceReadyAt` view can authoritatively reject pre-source proposals
        // even before the first earned-rater credit has been pending-recorded.
        launchDistributionPool.setRoundClusterReadyAtSource(address(votingEngine));
        launchDistributionPool.setClusterPayoutOracle(address(clusterPayoutOracle));
        launchDistributionPool.setAuthorizedCaller(address(rewardDistributor), true);
        AdvisoryVoteRecorder advisoryVoteRecorder =
            new AdvisoryVoteRecorder(address(votingEngine), address(registry), governance);
        protocolConfig.setAdvisoryVoteRecorder(address(advisoryVoteRecorder));
        launchDistributionPool.setAuthorizedCaller(address(advisoryVoteRecorder), true);

        if (!isLocalDev) {
            address[] memory excludedHolders = _buildQuorumExcludedHolders(
                address(launchDistributionPool),
                address(rewardDistributor),
                address(votingEngine),
                governance,
                address(registry),
                address(frontendRegistry),
                address(questionRewardPoolEscrow),
                address(feedbackBonusEscrow)
            );
            governor = new RateLoopGovernor(
                IVotes(address(lrepToken)), TimelockController(payable(governance)), excludedHolders
            );
            governorAddr = address(governor);
            console.log("RateLoopGovernor deployed at:", governorAddr);

            TimelockController tc = TimelockController(payable(governance));
            tc.grantRole(tc.PROPOSER_ROLE(), governorAddr);
            tc.grantRole(tc.CANCELLER_ROLE(), governorAddr);
            lrepToken.setGovernor(governorAddr);
        }

        _fundLaunchDistributionPool(lrepToken, launchDistributionPool);
        _activateLegacyContributorRoot(launchDistributionPool);
        if (!isLocalDev) {
            launchDistributionPool.transferOwnership(governance);
            TimelockController tc = TimelockController(payable(governance));
            tc.renounceRole(tc.DEFAULT_ADMIN_ROLE(), deployer);
            lrepToken.renounceRole(lrepToken.CONFIG_ROLE(), deployer);
            lrepToken.renounceRole(lrepToken.MINTER_ROLE(), deployer);
        }
        protocolConfig.setLaunchDistributionPool(address(launchDistributionPool));
        if (!isLocalDev) {
            protocolConfig.renounceRole(protocolConfig.CONFIG_ROLE(), deployer);
        }
        console.log("LaunchDistributionPool deployed and funded with 75M LREP");
        console.log("ClusterPayoutOracle deployed at:", address(clusterPayoutOracle));
        console.log("AdvisoryVoteRecorder deployed at:", address(advisoryVoteRecorder));

        if (isLocalDev) {
            _fundLocalDevAccounts(lrepToken, localUsdcToken, raterRegistry);
        }

        deployments.push(Deployment("LoopReputation", address(lrepToken)));
        if (address(timelock) != address(0)) deployments.push(Deployment("TimelockController", address(timelock)));
        if (address(governor) != address(0)) deployments.push(Deployment("RateLoopGovernor", address(governor)));
        deployments.push(Deployment("FrontendRegistry", address(frontendRegistryProxy)));
        deployments.push(Deployment("FrontendRegistryProxyAdmin", _proxyAdmin(address(frontendRegistryProxy))));
        deployments.push(Deployment("ProfileRegistry", address(profileRegistryProxy)));
        deployments.push(Deployment("ProfileRegistryProxyAdmin", _proxyAdmin(address(profileRegistryProxy))));
        deployments.push(Deployment("ContentRegistry", address(registryProxy)));
        deployments.push(Deployment("ContentRegistryProxyAdmin", _proxyAdmin(address(registryProxy))));
        deployments.push(Deployment("RoundVotingEngine", address(votingEngineProxy)));
        deployments.push(Deployment("RoundVotingEngineProxyAdmin", _proxyAdmin(address(votingEngineProxy))));
        deployments.push(Deployment("ProtocolConfig", address(protocolConfigProxy)));
        deployments.push(Deployment("ProtocolConfigProxyAdmin", _proxyAdmin(address(protocolConfigProxy))));
        deployments.push(Deployment("RoundRewardDistributor", address(rewardDistributorProxy)));
        deployments.push(Deployment("RoundRewardDistributorProxyAdmin", _proxyAdmin(address(rewardDistributorProxy))));
        deployments.push(Deployment("QuestionRewardPoolEscrow", address(questionRewardPoolEscrowProxy)));
        deployments.push(
            Deployment("QuestionRewardPoolEscrowProxyAdmin", _proxyAdmin(address(questionRewardPoolEscrowProxy)))
        );
        deployments.push(Deployment("X402QuestionSubmitter", address(x402QuestionSubmitter)));
        deployments.push(Deployment("FeedbackRegistry", address(feedbackRegistryProxy)));
        deployments.push(Deployment("FeedbackRegistryProxyAdmin", _proxyAdmin(address(feedbackRegistryProxy))));
        deployments.push(Deployment("FeedbackBonusEscrow", address(feedbackBonusEscrowProxy)));
        deployments.push(Deployment("FeedbackBonusEscrowProxyAdmin", _proxyAdmin(address(feedbackBonusEscrowProxy))));
        deployments.push(Deployment("CategoryRegistry", address(categoryRegistry)));
        deployments.push(Deployment("ClusterPayoutOracle", address(clusterPayoutOracle)));
        deployments.push(Deployment("RaterRegistry", address(raterRegistryProxy)));
        deployments.push(Deployment("RaterRegistryProxyAdmin", _proxyAdmin(address(raterRegistryProxy))));
        if (address(worldIdMockVerifier) != address(0)) {
            deployments.push(Deployment("MockWorldIDVerifier", address(worldIdMockVerifier)));
        }
        deployments.push(Deployment("LaunchDistributionPool", address(launchDistributionPool)));
        deployments.push(Deployment("AdvisoryVoteRecorder", address(advisoryVoteRecorder)));
        if (isLocalDev) deployments.push(Deployment("MockERC20", usdcTokenAddress));

        if (isLocalDev) {
            lrepToken.revokeRole(lrepToken.MINTER_ROLE(), deployer);
        }

        console.log("=== RateLoop Protocol Deployed ===");
        console.log("LoopReputation:", address(lrepToken));
        console.log("FrontendRegistry:", address(frontendRegistry));
        console.log("ProfileRegistry:", address(profileRegistry));
        console.log("ContentRegistry:", address(registry));
        console.log("RoundVotingEngine:", address(votingEngine));
        console.log("ProtocolConfig:", address(protocolConfig));
        console.log("RoundRewardDistributor:", address(rewardDistributor));
        console.log("QuestionRewardPoolEscrow:", address(questionRewardPoolEscrow));
        console.log("X402QuestionSubmitter:", address(x402QuestionSubmitter));
        console.log("FeedbackRegistry:", address(feedbackRegistry));
        console.log("FeedbackBonusEscrow:", address(feedbackBonusEscrow));
        console.log("USDC token:", usdcTokenAddress);
        console.log("CategoryRegistry:", address(categoryRegistry));
        console.log("ClusterPayoutOracle:", address(clusterPayoutOracle));
        console.log("RaterRegistry:", address(raterRegistry));
        console.log("World ID v4 Verifier:", worldIdConfig.verifier);
        console.log("World ID RP ID:", worldIdConfig.rpId);
        console.log("World ID Credential Action:", worldIdConfig.credentialAction);
        console.log("World ID Presence Action:", worldIdConfig.presenceAction);
        console.log("LaunchDistributionPool:", address(launchDistributionPool));
        console.log("AdvisoryVoteRecorder:", address(advisoryVoteRecorder));
        console.log("Governance:", governance);
    }

    function _activateLegacyContributorRoot(LaunchDistributionPool launchDistributionPool) internal {
        launchDistributionPool.setLegacyContributorRoot(LEGACY_CONTRIBUTOR_ROOT, LEGACY_CONTRIBUTOR_ALLOCATION_TOTAL);
    }

    function _fundLaunchDistributionPool(LoopReputation lrepToken, LaunchDistributionPool launchDistributionPool)
        internal
    {
        lrepToken.mint(address(launchDistributionPool), LAUNCH_DISTRIBUTION_AMOUNT);
        launchDistributionPool.accountPrefundedPoolDeposit(LAUNCH_DISTRIBUTION_AMOUNT);
    }

    function _proxyAdmin(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967_ADMIN_SLOT))));
    }

    function _resolveWorldChainUsdcAddress() internal view returns (address) {
        if (block.chainid == 480) return WORLD_CHAIN_MAINNET_USDC;
        if (block.chainid == 4801) return WORLD_CHAIN_SEPOLIA_USDC;
        revert UnsupportedWorldChain(block.chainid);
    }

    function _validateUsdcToken(address token) internal view {
        require(token.code.length > 0, "USDC has no code on this chain");
        try IERC20Metadata(token).decimals() returns (uint8 decimals_) {
            require(decimals_ == 6, "USDC must use 6 decimals");
        } catch {
            revert("USDC decimals probe failed");
        }
    }

    function _resolveWorldIdVerifierAddress(bool isLocalDev) internal view returns (address) {
        bool hasOverride = vm.envExists(WORLD_ID_V4_VERIFIER_ADDRESS_ENV);
        address verifierOverride = hasOverride ? vm.envOr(WORLD_ID_V4_VERIFIER_ADDRESS_ENV, address(0)) : address(0);
        return _resolveWorldIdVerifierAddressForChain(isLocalDev, hasOverride, verifierOverride);
    }

    function _resolveWorldIdVerifierAddressForChain(bool isLocalDev, bool hasOverride, address verifierOverride)
        internal
        view
        returns (address)
    {
        if (isLocalDev) return address(0);
        if (block.chainid == 480) {
            if (hasOverride && verifierOverride != WORLD_CHAIN_WORLD_ID_V4_VERIFIER) {
                revert MainnetWorldIdVerifierOverrideNotAllowed(verifierOverride);
            }
            return _resolveWorldIdVerifierCandidate(WORLD_CHAIN_WORLD_ID_V4_VERIFIER, true);
        }
        if (block.chainid == 4801) {
            address verifier = hasOverride ? verifierOverride : WORLD_CHAIN_WORLD_ID_V4_VERIFIER;
            return _resolveWorldIdVerifierCandidate(verifier, hasOverride);
        }
        revert UnsupportedWorldChain(block.chainid);
    }

    function _resolveWorldIdVerifierCandidate(address verifier, bool requireLiveCode) internal view returns (address) {
        if (verifier == address(0)) return address(0);
        if (verifier.code.length > 0) return verifier;
        if (requireLiveCode) revert WorldIdVerifierHasNoCode(verifier);
        return address(0);
    }

    function _shouldDeployWorldIdMockVerifier(bool isLocalDev, address) internal pure returns (bool) {
        return isLocalDev;
    }

    function _resolveWorldIdDeployConfig(address verifier) internal view returns (WorldIdDeployConfig memory config) {
        config.verifier = verifier;
        if (verifier == address(0)) return config;

        config.rpId = _resolveWorldIdRpId();
        config.credentialAction = _resolveWorldIdCredentialAction();
        config.presenceAction = _resolveWorldIdPresenceAction();
        config.credentialTtl = WORLD_ID_CREDENTIAL_TTL_SECONDS;
        config.presenceTtl = WORLD_ID_PRESENCE_TTL_SECONDS;
        config.issuerSchemaId = _resolveWorldIdIssuerSchemaId();
        config.credentialGenesisIssuedAtMin = _resolveWorldIdCredentialGenesisIssuedAtMin();
    }

    /// @notice Per-chain drand `(chainHash, genesisTime, period)` resolver. Mainnet (480) and local dev
    ///         (31337) use the mainnet `quicknet` defaults from ProtocolConfig; testnet (4801) commits to
    ///         `quicknet-t`.
    function _resolveDrandConfig() internal view returns (bytes32 chainHash, uint64 genesisTime, uint64 period) {
        if (block.chainid == 4801) {
            return (TESTNET_DRAND_CHAIN_HASH, TESTNET_DRAND_GENESIS_TIME, TESTNET_DRAND_PERIOD);
        }
        // chainId 480 (mainnet) and 31337 (local dev) use the same mainnet `quicknet` chain hash.
        return (MAINNET_DRAND_CHAIN_HASH, MAINNET_DRAND_GENESIS_TIME, MAINNET_DRAND_PERIOD);
    }

    function _resolveWorldIdRpId() internal view returns (uint64) {
        return uint64(vm.envOr("WORLD_ID_V4_RP_ID", uint256(DEFAULT_WORLD_ID_V4_RP_ID)));
    }

    function _resolveWorldIdCredentialAction() internal view returns (uint256) {
        string memory action = vm.envOr("NEXT_PUBLIC_WORLD_ID_CREDENTIAL_ACTION", DEFAULT_WORLD_ID_ACTION);
        return uint256(keccak256(bytes(action)));
    }

    function _resolveWorldIdPresenceAction() internal view returns (uint256) {
        return
            uint256(
                keccak256(bytes(vm.envOr("NEXT_PUBLIC_WORLD_ID_PRESENCE_ACTION", DEFAULT_WORLD_ID_PRESENCE_ACTION)))
            );
    }

    function _resolveWorldIdIssuerSchemaId() internal view returns (uint64) {
        return uint64(vm.envOr("WORLD_ID_V4_ISSUER_SCHEMA_ID", uint256(DEFAULT_WORLD_ID_ISSUER_SCHEMA_ID)));
    }

    function _resolveWorldIdCredentialGenesisIssuedAtMin() internal view returns (uint256) {
        return vm.envOr("WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN", uint256(0));
    }

    function _renounceRaterRegistryDeployerRoles(RaterRegistry raterRegistry, address temporaryDeployer) internal {
        raterRegistry.renounceRole(raterRegistry.ADMIN_ROLE(), temporaryDeployer);
        raterRegistry.renounceRole(raterRegistry.SEEDER_ROLE(), temporaryDeployer);
    }

    function _buildQuorumExcludedHolders(
        address launchDistribution,
        address rewardDistributor,
        address votingEngine,
        address treasury,
        address contentRegistry,
        address frontendRegistry,
        address questionRewardPoolEscrow,
        address feedbackBonusEscrow
    ) internal pure returns (address[] memory holders) {
        address[] memory temp = new address[](8);
        uint256 count;
        count = _appendUnique(temp, count, launchDistribution);
        count = _appendUnique(temp, count, rewardDistributor);
        count = _appendUnique(temp, count, votingEngine);
        count = _appendUnique(temp, count, treasury);
        count = _appendUnique(temp, count, contentRegistry);
        count = _appendUnique(temp, count, frontendRegistry);
        count = _appendUnique(temp, count, questionRewardPoolEscrow);
        count = _appendUnique(temp, count, feedbackBonusEscrow);

        holders = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            holders[i] = temp[i];
        }
    }

    function _appendUnique(address[] memory holders, uint256 count, address candidate) internal pure returns (uint256) {
        if (candidate == address(0)) return count;
        for (uint256 i = 0; i < count; i++) {
            if (holders[i] == candidate) return count;
        }
        holders[count] = candidate;
        return count + 1;
    }

    function _worldChainSepoliaTestingAccounts() internal pure returns (address[4] memory accounts) {
        accounts = [
            0xfa9605A2c38a0B4f16f689FDD07B63F295b86d1C,
            0x113aFCbA5C5Ee43125C2a24c8E06dd9b4dA38f15,
            0xf51BA40d80c7687A6A46c6A279ec145069A9da10,
            0x623F82Ef0Fa750AB28D8912C53690B04826874bE
        ];
    }

    function _worldChainSepoliaTestingLrepTotal() internal pure returns (uint256) {
        return WORLD_CHAIN_SEPOLIA_TEST_LREP_AMOUNT * _worldChainSepoliaTestingAccounts().length;
    }

    function _treasuryMintAmountForChain(uint256 chainId) internal pure returns (uint256) {
        if (chainId == 4801) {
            return TREASURY_AMOUNT - _worldChainSepoliaTestingLrepTotal();
        }
        return TREASURY_AMOUNT;
    }

    function _fundWorldChainSepoliaTestingAccounts(LoopReputation lrepToken, RaterRegistry raterRegistry) internal {
        address[4] memory testAccounts = _worldChainSepoliaTestingAccounts();
        for (uint256 i = 0; i < testAccounts.length; i++) {
            address account = testAccounts[i];
            lrepToken.mint(account, WORLD_CHAIN_SEPOLIA_TEST_LREP_AMOUNT);
            bytes32 anchorId = keccak256(abi.encodePacked("rateloop:worldchain-sepolia-human-v1", account));
            bytes32 evidenceHash = keccak256(abi.encodePacked("rateloop:worldchain-sepolia-evidence-v1", account));
            raterRegistry.seedHumanCredential(
                account, uint64(block.timestamp + WORLD_ID_CREDENTIAL_TTL_SECONDS), anchorId, evidenceHash
            );
        }
        console.log("Funded World Chain Sepolia test human accounts:", testAccounts.length);
    }

    function _fundLocalDevAccounts(LoopReputation lrepToken, MockERC20 localUsdcToken, RaterRegistry raterRegistry)
        internal
    {
        uint256 testAmount = 1000 * 1e6;
        address[9] memory testAccounts = [
            0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
            0x90F79bf6EB2c4f870365E785982E1f101E93b906,
            0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65,
            0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc,
            0x976EA74026E726554dB657fA54763abd0C3a0aa9,
            0x14dC79964da2C08b23698B3D3cc7Ca32193d9955,
            0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f,
            0xa0Ee7A142d267C1f36714E4a8F75612F20a79720,
            0xBcd4042DE499D14e55001CcbB24a551F3b954096
        ];

        for (uint256 i = 0; i < testAccounts.length; i++) {
            lrepToken.transfer(testAccounts[i], testAmount);
            localUsdcToken.mint(testAccounts[i], 10_000 * 1e6);
        }

        for (uint256 i = 0; i < testAccounts.length; i++) {
            bytes32 anchorId = keccak256(abi.encodePacked("rateloop:local-dev-human-v1", testAccounts[i]));
            bytes32 evidenceHash = keccak256(abi.encodePacked("rateloop:local-dev-evidence-v1", testAccounts[i]));
            raterRegistry.seedHumanCredential(
                testAccounts[i], uint64(block.timestamp + WORLD_ID_CREDENTIAL_TTL_SECONDS), anchorId, evidenceHash
            );
        }
    }

    function _seedCategories(CategoryRegistry registry) internal {
        string[] memory productSubcats = new string[](8);
        productSubcats[0] = "Value";
        productSubcats[1] = "Quality";
        productSubcats[2] = "Usability";
        productSubcats[3] = "Durability";
        productSubcats[4] = "Design";
        productSubcats[5] = "Support";
        productSubcats[6] = "Safety";
        productSubcats[7] = "Sustainability";
        registry.addCategory("Products", "products", productSubcats);

        string[] memory placesTravelSubcats = new string[](13);
        placesTravelSubcats[0] = "Restaurants";
        placesTravelSubcats[1] = "Cafes";
        placesTravelSubcats[2] = "Nightlife";
        placesTravelSubcats[3] = "Hotels";
        placesTravelSubcats[4] = "Attractions";
        placesTravelSubcats[5] = "Itineraries";
        placesTravelSubcats[6] = "Service";
        placesTravelSubcats[7] = "Atmosphere";
        placesTravelSubcats[8] = "Accessibility";
        placesTravelSubcats[9] = "Value";
        placesTravelSubcats[10] = "Local Tips";
        placesTravelSubcats[11] = "Family";
        placesTravelSubcats[12] = "Solo Travel";
        registry.addCategory("Places & Travel", "places-travel", placesTravelSubcats);

        string[] memory softwareSubcats = new string[](12);
        softwareSubcats[0] = "Web Apps";
        softwareSubcats[1] = "Mobile Apps";
        softwareSubcats[2] = "Developer Tools";
        softwareSubcats[3] = "Repos";
        softwareSubcats[4] = "Libraries";
        softwareSubcats[5] = "APIs";
        softwareSubcats[6] = "Smart Contracts";
        softwareSubcats[7] = "Productivity";
        softwareSubcats[8] = "Onboarding";
        softwareSubcats[9] = "Performance";
        softwareSubcats[10] = "Trust";
        softwareSubcats[11] = "Pricing";
        registry.addCategory("Software", "software", softwareSubcats);

        string[] memory mediaSubcats = new string[](8);
        mediaSubcats[0] = "Images";
        mediaSubcats[1] = "YouTube";
        mediaSubcats[2] = "Education";
        mediaSubcats[3] = "Entertainment";
        mediaSubcats[4] = "Art";
        mediaSubcats[5] = "Photography";
        mediaSubcats[6] = "Audio";
        mediaSubcats[7] = "Culture";
        registry.addCategory("Media", "media", mediaSubcats);

        string[] memory designSubcats = new string[](8);
        designSubcats[0] = "Visual Design";
        designSubcats[1] = "Brand";
        designSubcats[2] = "Typography";
        designSubcats[3] = "Layout";
        designSubcats[4] = "Accessibility";
        designSubcats[5] = "Photography";
        designSubcats[6] = "Fashion";
        designSubcats[7] = "Architecture";
        registry.addCategory("Design", "design", designSubcats);

        string[] memory aiAnswerSubcats = new string[](8);
        aiAnswerSubcats[0] = "Helpfulness";
        aiAnswerSubcats[1] = "Clarity";
        aiAnswerSubcats[2] = "Safety";
        aiAnswerSubcats[3] = "Creativity";
        aiAnswerSubcats[4] = "Reasoning";
        aiAnswerSubcats[5] = "Code";
        aiAnswerSubcats[6] = "Images";
        aiAnswerSubcats[7] = "Research";
        registry.addCategory("AI Answers", "ai-answers", aiAnswerSubcats);

        string[] memory textSubcats = new string[](13);
        textSubcats[0] = "Developer Docs";
        textSubcats[1] = "Getting Started";
        textSubcats[2] = "API Reference";
        textSubcats[3] = "Tutorials";
        textSubcats[4] = "Articles";
        textSubcats[5] = "Research";
        textSubcats[6] = "Policy";
        textSubcats[7] = "Copywriting";
        textSubcats[8] = "Accuracy";
        textSubcats[9] = "Completeness";
        textSubcats[10] = "Readability";
        textSubcats[11] = "Troubleshooting";
        textSubcats[12] = "Examples";
        registry.addCategory("Text", "text", textSubcats);

        string[] memory opinionSubcats = new string[](8);
        opinionSubcats[0] = "Taste";
        opinionSubcats[1] = "Usefulness";
        opinionSubcats[2] = "Interesting";
        opinionSubcats[3] = "Clear";
        opinionSubcats[4] = "Fun";
        opinionSubcats[5] = "Convincing";
        opinionSubcats[6] = "Worthwhile";
        opinionSubcats[7] = "Other";
        registry.addCategory("General", "general", opinionSubcats);
    }
}

/// @notice Main deployment entrypoint used by scaffold-eth/yarn deploy.
contract DeployScript is DeployRateLoop { }
