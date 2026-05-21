// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { console } from "forge-std/console.sol";
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
import { ProfileRegistry } from "../contracts/ProfileRegistry.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { QuestionRewardPoolEscrow } from "../contracts/QuestionRewardPoolEscrow.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { X402QuestionSubmitter } from "../contracts/X402QuestionSubmitter.sol";
import { LaunchDistributionPool } from "../contracts/LaunchDistributionPool.sol";
import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { MockWorldIDRouter } from "../contracts/mocks/MockWorldIDRouter.sol";
import { RateLoopGovernor } from "../contracts/governance/RateLoopGovernor.sol";

/// @notice Fresh RateLoop deployment script for World Chain.
/// @dev Rater identity is resolved through RaterRegistry; no separate proof-of-personhood token is deployed.
contract DeployRateLoop is ScaffoldETHDeploy {
    error UnsupportedWorldChain(uint256 chainId);

    uint256 public constant TIMELOCK_MIN_DELAY = 2 days;

    uint256 public constant TOTAL_SUPPLY_CAP = 100_000_000 * 1e6;
    uint256 public constant TREASURY_AMOUNT = 25_000_000 * 1e6;
    uint256 public constant LAUNCH_DISTRIBUTION_AMOUNT = TOTAL_SUPPLY_CAP - TREASURY_AMOUNT;
    bytes32 internal constant ERC1967_ADMIN_SLOT = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);

    address internal constant WORLD_CHAIN_MAINNET_USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address internal constant WORLD_CHAIN_SEPOLIA_USDC = 0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88;
    address internal constant WORLD_CHAIN_MAINNET_WORLD_ID_ROUTER = 0x17B354dD2595411ff79041f930e491A4Df39A278;
    address internal constant WORLD_CHAIN_SEPOLIA_WORLD_ID_ROUTER = 0x57f928158C3EE7CDad1e4D8642503c4D0201f611;
    uint64 internal constant WORLD_ID_CREDENTIAL_TTL_SECONDS = 365 days;
    string internal constant DEFAULT_WORLD_ID_ACTION = "rateloop-human-credential-v1";
    string internal constant LOCAL_WORLD_ID_APP_ID = "app_staging_rateloop_local";

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
        0xf3827d772c155f95a9fda8901ddd59591a082df5ac6efe3a479ddb1f5eeb202c;
    uint64 internal constant TESTNET_DRAND_GENESIS_TIME = 1_689_232_296;
    uint64 internal constant TESTNET_DRAND_PERIOD = 3;

    function _preBroadcastChecks() internal view override {
        if (block.chainid != 31337 && block.chainid != 480 && block.chainid != 4801) {
            revert UnsupportedWorldChain(block.chainid);
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
            address[] memory proposers = new address[](1);
            proposers[0] = deployer;
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

        if (!isLocalDev) {
            governor = new RateLoopGovernor(IVotes(address(lrepToken)), TimelockController(payable(governance)));
            governorAddr = address(governor);
            console.log("RateLoopGovernor deployed at:", governorAddr);

            TimelockController tc = TimelockController(payable(governance));
            tc.grantRole(tc.PROPOSER_ROLE(), governorAddr);
            tc.grantRole(tc.CANCELLER_ROLE(), governorAddr);
            tc.grantRole(tc.CANCELLER_ROLE(), deployer);
            lrepToken.setGovernor(governorAddr);
        }

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine votingEngineImpl = new RoundVotingEngine();
        RoundRewardDistributor rewardDistributorImpl = new RoundRewardDistributor();
        FrontendRegistry frontendRegistryImpl = new FrontendRegistry();
        ProfileRegistry profileRegistryImpl = new ProfileRegistry();
        ProtocolConfig protocolConfigImpl = new ProtocolConfig();
        QuestionRewardPoolEscrow questionRewardPoolEscrowImpl = new QuestionRewardPoolEscrow();
        FeedbackBonusEscrow feedbackBonusEscrowImpl = new FeedbackBonusEscrow();

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

        MockWorldIDRouter localWorldIdRouter;
        address worldIdRouterAddress = _resolveWorldIdRouterAddress(isLocalDev);
        if (isLocalDev) {
            localWorldIdRouter = new MockWorldIDRouter();
            worldIdRouterAddress = address(localWorldIdRouter);
            console.log("MockWorldIDRouter deployed at:", worldIdRouterAddress);
        }
        string memory worldIdAction = _resolveWorldIdAction();
        uint256 worldIdExternalNullifierHash = _resolveWorldIdExternalNullifierHash(isLocalDev, worldIdAction);
        bytes32 worldIdScope = keccak256(bytes(worldIdAction));

        address usdcTokenAddress;
        MockERC20 localUsdcToken;
        if (isLocalDev) {
            localUsdcToken = new MockERC20("USD Coin", "USDC", 6);
            usdcTokenAddress = address(localUsdcToken);
            console.log("Mock USDC deployed at:", usdcTokenAddress);
        } else {
            usdcTokenAddress = _resolveWorldChainUsdcAddress();
            console.log("Circle USDC resolved at:", usdcTokenAddress);
        }

        CategoryRegistry categoryRegistry = new CategoryRegistry(deployer, governance);
        ClusterPayoutOracle clusterPayoutOracle =
            new ClusterPayoutOracle(deployer, address(frontendRegistry), usdcTokenAddress);
        RaterRegistry raterRegistry = new RaterRegistry(
            deployer,
            governance,
            worldIdRouterAddress,
            worldIdScope,
            worldIdExternalNullifierHash,
            WORLD_ID_CREDENTIAL_TTL_SECONDS
        );
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

        TransparentUpgradeableProxy feedbackBonusEscrowProxy = new TransparentUpgradeableProxy(
            address(feedbackBonusEscrowImpl),
            governance,
            abi.encodeCall(
                FeedbackBonusEscrow.initialize,
                (governance, usdcTokenAddress, address(registry), address(votingEngine), address(raterRegistry))
            )
        );
        FeedbackBonusEscrow feedbackBonusEscrow = FeedbackBonusEscrow(address(feedbackBonusEscrowProxy));

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
        protocolConfig.setClusterPayoutOracle(address(clusterPayoutOracle));
        clusterPayoutOracle.setRoundPayoutSnapshotConsumer(
            clusterPayoutOracle.PAYOUT_DOMAIN_QUESTION_REWARD(), address(questionRewardPoolEscrow)
        );

        profileRegistry.setRaterRegistry(address(raterRegistry));

        frontendRegistry.setVotingEngine(address(votingEngine));
        frontendRegistry.initializeFeeCreditor(address(rewardDistributor));

        _seedCategories(categoryRegistry);
        protocolConfig.setConfig(20 minutes, 20 minutes, 3, 200);

        lrepToken.mint(governance, TREASURY_AMOUNT);
        console.log("Minted 25M LREP to governance treasury");

        LaunchDistributionPool launchDistributionPool =
            new LaunchDistributionPool(address(lrepToken), address(raterRegistry), governance);
        // M-Oracle-1 (PR #20): the launch-credit consumer pin on the oracle MUST be set BEFORE
        // `setClusterPayoutOracle` because `_validateClusterPayoutOracle` now verifies the new
        // oracle routes the launch-credit domain back to this pool. Bootstrap order:
        //   1. deploy launch pool (above)
        //   2. set oracle's consumer pin → launch pool
        //   3. setClusterPayoutOracle on the launch pool
        //   4. setRoundClusterReadyAtSource on the launch pool
        clusterPayoutOracle.setRoundPayoutSnapshotConsumer(
            clusterPayoutOracle.PAYOUT_DOMAIN_LAUNCH_CREDIT(), address(launchDistributionPool)
        );
        launchDistributionPool.setClusterPayoutOracle(address(clusterPayoutOracle));
        // M-Oracle-1: wire the launch pool to the voting engine so its
        // `roundPayoutSnapshotSourceReadyAt` view can authoritatively reject pre-source proposals
        // even before the first earned-rater credit has been pending-recorded.
        launchDistributionPool.setRoundClusterReadyAtSource(address(votingEngine));
        launchDistributionPool.setAuthorizedCaller(address(rewardDistributor), true);
        AdvisoryVoteRecorder advisoryVoteRecorder =
            new AdvisoryVoteRecorder(address(votingEngine), address(registry), governance);
        protocolConfig.setAdvisoryVoteRecorder(address(advisoryVoteRecorder));
        launchDistributionPool.setAuthorizedCaller(address(advisoryVoteRecorder), true);
        lrepToken.mint(deployer, LAUNCH_DISTRIBUTION_AMOUNT);
        lrepToken.approve(address(launchDistributionPool), LAUNCH_DISTRIBUTION_AMOUNT);
        launchDistributionPool.depositPool(LAUNCH_DISTRIBUTION_AMOUNT);
        protocolConfig.setLaunchDistributionPool(address(launchDistributionPool));
        console.log("LaunchDistributionPool deployed and funded with 75M LREP");
        console.log("ClusterPayoutOracle deployed at:", address(clusterPayoutOracle));
        console.log("AdvisoryVoteRecorder deployed at:", address(advisoryVoteRecorder));

        if (!isLocalDev) {
            address[] memory excludedHolders = _buildQuorumExcludedHolders(
                address(launchDistributionPool),
                address(rewardDistributor),
                address(votingEngine),
                governance,
                address(registry),
                address(frontendRegistry)
            );
            RateLoopGovernor(payable(governorAddr)).initializePools(excludedHolders);
            launchDistributionPool.transferOwnership(governance);
        }

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
        deployments.push(Deployment("FeedbackBonusEscrow", address(feedbackBonusEscrowProxy)));
        deployments.push(Deployment("FeedbackBonusEscrowProxyAdmin", _proxyAdmin(address(feedbackBonusEscrowProxy))));
        deployments.push(Deployment("CategoryRegistry", address(categoryRegistry)));
        deployments.push(Deployment("ClusterPayoutOracle", address(clusterPayoutOracle)));
        deployments.push(Deployment("RaterRegistry", address(raterRegistry)));
        if (isLocalDev) deployments.push(Deployment("MockWorldIDRouter", address(localWorldIdRouter)));
        deployments.push(Deployment("LaunchDistributionPool", address(launchDistributionPool)));
        deployments.push(Deployment("AdvisoryVoteRecorder", address(advisoryVoteRecorder)));
        if (isLocalDev) deployments.push(Deployment("MockERC20", usdcTokenAddress));

        if (!isLocalDev) {
            lrepToken.renounceRole(lrepToken.MINTER_ROLE(), deployer);
            lrepToken.renounceRole(lrepToken.CONFIG_ROLE(), deployer);
            registry.renounceRole(registry.CONFIG_ROLE(), deployer);
            registry.renounceRole(registry.PAUSER_ROLE(), deployer);
            protocolConfig.renounceRole(protocolConfig.CONFIG_ROLE(), deployer);
            frontendRegistry.renounceRole(frontendRegistry.ADMIN_ROLE(), deployer);
            profileRegistry.renounceRole(profileRegistry.ADMIN_ROLE(), deployer);
            categoryRegistry.renounceRole(categoryRegistry.ADMIN_ROLE(), deployer);
            raterRegistry.renounceRole(raterRegistry.ADMIN_ROLE(), deployer);
            raterRegistry.renounceRole(raterRegistry.SEEDER_ROLE(), deployer);
            clusterPayoutOracle.grantRole(clusterPayoutOracle.DEFAULT_ADMIN_ROLE(), governance);
            clusterPayoutOracle.grantRole(clusterPayoutOracle.CONFIG_ROLE(), governance);
            clusterPayoutOracle.grantRole(clusterPayoutOracle.ARBITER_ROLE(), governance);
            clusterPayoutOracle.setOracleConfig(
                clusterPayoutOracle.challengeWindow(), clusterPayoutOracle.challengeBond(), governance
            );
            clusterPayoutOracle.renounceRole(clusterPayoutOracle.ARBITER_ROLE(), deployer);
            clusterPayoutOracle.renounceRole(clusterPayoutOracle.CONFIG_ROLE(), deployer);
            clusterPayoutOracle.renounceRole(clusterPayoutOracle.DEFAULT_ADMIN_ROLE(), deployer);

            TimelockController tc = TimelockController(payable(governance));
            tc.revokeRole(tc.PROPOSER_ROLE(), deployer);
            tc.revokeRole(tc.CANCELLER_ROLE(), deployer);
            tc.renounceRole(tc.DEFAULT_ADMIN_ROLE(), deployer);
        } else {
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
        console.log("FeedbackBonusEscrow:", address(feedbackBonusEscrow));
        console.log("USDC token:", usdcTokenAddress);
        console.log("CategoryRegistry:", address(categoryRegistry));
        console.log("ClusterPayoutOracle:", address(clusterPayoutOracle));
        console.log("RaterRegistry:", address(raterRegistry));
        console.log("World ID Router:", worldIdRouterAddress);
        console.log("World ID External Nullifier Hash:", worldIdExternalNullifierHash);
        console.log("LaunchDistributionPool:", address(launchDistributionPool));
        console.log("AdvisoryVoteRecorder:", address(advisoryVoteRecorder));
        console.log("Governance:", governance);
    }

    function _proxyAdmin(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967_ADMIN_SLOT))));
    }

    function _resolveWorldChainUsdcAddress() internal view returns (address) {
        if (block.chainid == 480) return WORLD_CHAIN_MAINNET_USDC;
        if (block.chainid == 4801) return WORLD_CHAIN_SEPOLIA_USDC;
        revert UnsupportedWorldChain(block.chainid);
    }

    function _resolveWorldIdRouterAddress(bool isLocalDev) internal view returns (address) {
        if (isLocalDev) return address(0);
        if (block.chainid == 480) return WORLD_CHAIN_MAINNET_WORLD_ID_ROUTER;
        if (block.chainid == 4801) return WORLD_CHAIN_SEPOLIA_WORLD_ID_ROUTER;
        revert UnsupportedWorldChain(block.chainid);
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

    function _resolveWorldIdAction() internal view returns (string memory) {
        return vm.envOr("NEXT_PUBLIC_WORLD_ID_ACTION", DEFAULT_WORLD_ID_ACTION);
    }

    function _resolveWorldIdExternalNullifierHash(bool isLocalDev, string memory action)
        internal
        view
        returns (uint256)
    {
        uint256 overrideHash = vm.envOr("WORLD_ID_EXTERNAL_NULLIFIER_HASH", uint256(0));
        if (overrideHash != 0) return overrideHash;

        string memory appId = isLocalDev
            ? vm.envOr("NEXT_PUBLIC_WORLD_ID_APP_ID", LOCAL_WORLD_ID_APP_ID)
            : vm.envString("NEXT_PUBLIC_WORLD_ID_APP_ID");
        return _worldIdExternalNullifierHash(appId, action);
    }

    function _worldIdExternalNullifierHash(string memory appId, string memory action) internal pure returns (uint256) {
        uint256 appIdHash = _hashToField(bytes(appId));
        return _hashToField(abi.encodePacked(appIdHash, action));
    }

    function _hashToField(bytes memory value) internal pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }

    function _buildQuorumExcludedHolders(
        address launchDistribution,
        address rewardDistributor,
        address votingEngine,
        address treasury,
        address contentRegistry,
        address frontendRegistry
    ) internal pure returns (address[] memory holders) {
        address[] memory temp = new address[](6);
        uint256 count;
        count = _appendUnique(temp, count, launchDistribution);
        count = _appendUnique(temp, count, rewardDistributor);
        count = _appendUnique(temp, count, votingEngine);
        count = _appendUnique(temp, count, treasury);
        count = _appendUnique(temp, count, contentRegistry);
        count = _appendUnique(temp, count, frontendRegistry);

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
            raterRegistry.seedHumanCredential(testAccounts[i], type(uint64).max, anchorId, evidenceHash);
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
