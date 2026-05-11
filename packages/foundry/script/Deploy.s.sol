// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ScaffoldETHDeploy} from "./DeployHelpers.s.sol";
import {console} from "forge-std/console.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {LoopReputation} from "../contracts/LoopReputation.sol";
import {ContentRegistry} from "../contracts/ContentRegistry.sol";
import {RoundVotingEngine} from "../contracts/RoundVotingEngine.sol";
import {RoundRewardDistributor} from "../contracts/RoundRewardDistributor.sol";
import {FrontendRegistry} from "../contracts/FrontendRegistry.sol";
import {CategoryRegistry} from "../contracts/CategoryRegistry.sol";
import {FeedbackBonusEscrow} from "../contracts/FeedbackBonusEscrow.sol";
import {ProfileRegistry} from "../contracts/ProfileRegistry.sol";
import {ProtocolConfig} from "../contracts/ProtocolConfig.sol";
import {QuestionRewardPoolEscrow} from "../contracts/QuestionRewardPoolEscrow.sol";
import {RaterDeclarationRegistry} from "../contracts/RaterDeclarationRegistry.sol";
import {RaterRegistry} from "../contracts/RaterRegistry.sol";
import {X402QuestionSubmitter} from "../contracts/X402QuestionSubmitter.sol";
import {VoterIdNFT} from "../contracts/VoterIdNFT.sol";
import {ParticipationPool} from "../contracts/ParticipationPool.sol";
import {LaunchDistributionPool} from "../contracts/LaunchDistributionPool.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {MockWorldIDRouter} from "../contracts/mocks/MockWorldIDRouter.sol";
import {CuryoGovernor} from "../contracts/governance/CuryoGovernor.sol";

/// @notice Fresh RateLoop deployment script for World Chain.
/// @dev Optional identity can be wired later by governance; no required proof-of-personhood faucet is deployed here.
contract DeployRateLoop is ScaffoldETHDeploy {
    error UnsupportedWorldChain(uint256 chainId);

    uint256 public constant TIMELOCK_MIN_DELAY = 2 days;

    uint256 public constant TOTAL_SUPPLY_CAP = 100_000_000 * 1e6;
    uint256 public constant CONSENSUS_POOL_AMOUNT = 4_000_000 * 1e6;
    uint256 public constant TREASURY_AMOUNT = 32_000_000 * 1e6;
    uint256 public constant PARTICIPATION_POOL_AMOUNT = 12_000_000 * 1e6;
    uint256 public constant LAUNCH_DISTRIBUTION_AMOUNT =
        TOTAL_SUPPLY_CAP - CONSENSUS_POOL_AMOUNT - TREASURY_AMOUNT - PARTICIPATION_POOL_AMOUNT;
    uint256 public constant MIN_AI_DECLARATION_BOND = 100 * 1e6;
    uint256 public constant AI_DECLARATION_CHALLENGE_BOND = 25 * 1e6;

    address internal constant WORLD_CHAIN_MAINNET_USDC = 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1;
    address internal constant WORLD_CHAIN_SEPOLIA_USDC = 0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88;
    address internal constant WORLD_CHAIN_MAINNET_WORLD_ID_ROUTER = 0x17B354dD2595411ff79041f930e491A4Df39A278;
    address internal constant WORLD_CHAIN_SEPOLIA_WORLD_ID_ROUTER = 0x57f928158C3EE7CDad1e4D8642503c4D0201f611;
    uint64 internal constant WORLD_ID_CREDENTIAL_TTL_SECONDS = 365 days;
    string internal constant DEFAULT_WORLD_ID_ACTION = "rateloop-human-credential-v1";
    string internal constant LOCAL_WORLD_ID_APP_ID = "app_staging_rateloop_local";

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
        CuryoGovernor governor;

        if (isLocalDev) {
            governance = deployer;
            governorAddr = deployer;
            console.log("Local dev: deployer is governance + treasury");
        } else {
            address[] memory proposers = new address[](1);
            proposers[0] = deployer;
            address[] memory executors = new address[](1);
            executors[0] = address(0);

            timelock = new TimelockController(TIMELOCK_MIN_DELAY, proposers, executors, deployer);
            governance = address(timelock);
            console.log("TimelockController deployed at:", governance);
        }

        LoopReputation lrepToken = new LoopReputation(deployer, governance);
        console.log("LoopReputation deployed at:", address(lrepToken));

        if (!isLocalDev) {
            governor = new CuryoGovernor(IVotes(address(lrepToken)), TimelockController(payable(governance)));
            governorAddr = address(governor);
            console.log("CuryoGovernor deployed at:", governorAddr);

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

        TransparentUpgradeableProxy protocolConfigProxy = new TransparentUpgradeableProxy(
            address(protocolConfigImpl), governance, abi.encodeCall(ProtocolConfig.initialize, (deployer, governance))
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

        CategoryRegistry categoryRegistry = new CategoryRegistry(deployer, governance);
        RaterRegistry raterRegistry = new RaterRegistry(
            deployer,
            governance,
            worldIdRouterAddress,
            worldIdScope,
            worldIdExternalNullifierHash,
            WORLD_ID_CREDENTIAL_TTL_SECONDS
        );
        RaterDeclarationRegistry raterDeclarationRegistry = new RaterDeclarationRegistry(
            deployer, governance, lrepToken, governance, MIN_AI_DECLARATION_BOND, AI_DECLARATION_CHALLENGE_BOND
        );
        VoterIdNFT optionalIdentity = new VoterIdNFT(deployer, governance);
        optionalIdentity.setStakeRecorder(address(votingEngine));

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
                    address(optionalIdentity)
                )
            )
        );
        QuestionRewardPoolEscrow questionRewardPoolEscrow =
            QuestionRewardPoolEscrow(address(questionRewardPoolEscrowProxy));

        X402QuestionSubmitter x402QuestionSubmitter =
            new X402QuestionSubmitter(registry, usdcTokenAddress, address(questionRewardPoolEscrow));

        TransparentUpgradeableProxy feedbackBonusEscrowProxy = new TransparentUpgradeableProxy(
            address(feedbackBonusEscrowImpl),
            governance,
            abi.encodeCall(
                FeedbackBonusEscrow.initialize,
                (governance, usdcTokenAddress, address(registry), address(votingEngine), address(optionalIdentity))
            )
        );
        FeedbackBonusEscrow feedbackBonusEscrow = FeedbackBonusEscrow(address(feedbackBonusEscrowProxy));

        registry.setVotingEngine(address(votingEngine));
        registry.setProtocolConfig(address(protocolConfig));
        registry.setCategoryRegistry(address(categoryRegistry));
        registry.setQuestionRewardPoolEscrow(address(questionRewardPoolEscrow));
        registry.grantRole(registry.X402_GATEWAY_ROLE(), address(x402QuestionSubmitter));

        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setFrontendRegistry(address(frontendRegistry));
        protocolConfig.setCategoryRegistry(address(categoryRegistry));
        protocolConfig.setVoterIdNFT(address(optionalIdentity));
        protocolConfig.setRaterRegistry(address(raterRegistry));

        registry.setVoterIdNFT(address(optionalIdentity));
        frontendRegistry.setVoterIdNFT(address(optionalIdentity));
        profileRegistry.setVoterIdNFT(address(optionalIdentity));

        frontendRegistry.setVotingEngine(address(votingEngine));
        frontendRegistry.initializeFeeCreditor(address(rewardDistributor));

        _seedCategories(categoryRegistry);
        lrepToken.setPredictionContracts(address(votingEngine), address(rewardDistributor));
        protocolConfig.setConfig(20 minutes, 7 days, 3, 200);

        lrepToken.mint(deployer, CONSENSUS_POOL_AMOUNT);
        lrepToken.approve(address(votingEngine), CONSENSUS_POOL_AMOUNT);
        votingEngine.addToConsensusReserve(CONSENSUS_POOL_AMOUNT);
        console.log("Funded 4M LREP to consensus reserve");

        lrepToken.mint(governance, TREASURY_AMOUNT);
        console.log("Minted 32M LREP to governance treasury");

        ParticipationPool participationPool = new ParticipationPool(address(lrepToken), governance);
        participationPool.setAuthorizedCaller(address(rewardDistributor), true);
        lrepToken.mint(deployer, PARTICIPATION_POOL_AMOUNT);
        lrepToken.approve(address(participationPool), PARTICIPATION_POOL_AMOUNT);
        participationPool.depositPool(PARTICIPATION_POOL_AMOUNT);
        protocolConfig.setParticipationPool(address(participationPool));
        console.log("ParticipationPool deployed and funded with 12M LREP");

        LaunchDistributionPool launchDistributionPool =
            new LaunchDistributionPool(address(lrepToken), address(raterRegistry), governance);
        launchDistributionPool.setAuthorizedCaller(address(rewardDistributor), true);
        lrepToken.mint(deployer, LAUNCH_DISTRIBUTION_AMOUNT);
        lrepToken.approve(address(launchDistributionPool), LAUNCH_DISTRIBUTION_AMOUNT);
        launchDistributionPool.depositPool(LAUNCH_DISTRIBUTION_AMOUNT);
        protocolConfig.setLaunchDistributionPool(address(launchDistributionPool));
        console.log("LaunchDistributionPool deployed and funded with 52M LREP");

        if (!isLocalDev) {
            address[] memory excludedHolders = _buildQuorumExcludedHolders(
                address(launchDistributionPool),
                address(participationPool),
                address(rewardDistributor),
                address(votingEngine),
                governance,
                address(registry),
                address(frontendRegistry)
            );
            CuryoGovernor(payable(governorAddr)).initializePools(excludedHolders);
            participationPool.transferOwnership(governance);
            launchDistributionPool.transferOwnership(governance);
        }

        if (isLocalDev) {
            _fundLocalDevAccounts(lrepToken, localUsdcToken, optionalIdentity);
        }

        deployments.push(Deployment("LoopReputation", address(lrepToken)));
        if (address(timelock) != address(0)) deployments.push(Deployment("TimelockController", address(timelock)));
        if (address(governor) != address(0)) deployments.push(Deployment("CuryoGovernor", address(governor)));
        deployments.push(Deployment("FrontendRegistry", address(frontendRegistryProxy)));
        deployments.push(Deployment("ProfileRegistry", address(profileRegistryProxy)));
        deployments.push(Deployment("ContentRegistry", address(registryProxy)));
        deployments.push(Deployment("RoundVotingEngine", address(votingEngineProxy)));
        deployments.push(Deployment("ProtocolConfig", address(protocolConfigProxy)));
        deployments.push(Deployment("RoundRewardDistributor", address(rewardDistributorProxy)));
        deployments.push(Deployment("QuestionRewardPoolEscrow", address(questionRewardPoolEscrowProxy)));
        deployments.push(Deployment("X402QuestionSubmitter", address(x402QuestionSubmitter)));
        deployments.push(Deployment("FeedbackBonusEscrow", address(feedbackBonusEscrowProxy)));
        deployments.push(Deployment("CategoryRegistry", address(categoryRegistry)));
        deployments.push(Deployment("RaterRegistry", address(raterRegistry)));
        if (isLocalDev) deployments.push(Deployment("MockWorldIDRouter", address(localWorldIdRouter)));
        deployments.push(Deployment("RaterDeclarationRegistry", address(raterDeclarationRegistry)));
        deployments.push(Deployment("VoterIdNFT", address(optionalIdentity)));
        deployments.push(Deployment("ParticipationPool", address(participationPool)));
        deployments.push(Deployment("LaunchDistributionPool", address(launchDistributionPool)));
        if (isLocalDev) deployments.push(Deployment("MockERC20", usdcTokenAddress));

        if (!isLocalDev) {
            lrepToken.renounceRole(lrepToken.MINTER_ROLE(), deployer);
            lrepToken.renounceRole(lrepToken.CONFIG_ROLE(), deployer);
            registry.renounceRole(registry.CONFIG_ROLE(), deployer);
            protocolConfig.renounceRole(protocolConfig.CONFIG_ROLE(), deployer);
            frontendRegistry.renounceRole(frontendRegistry.ADMIN_ROLE(), deployer);
            profileRegistry.renounceRole(profileRegistry.ADMIN_ROLE(), deployer);
            categoryRegistry.renounceRole(categoryRegistry.ADMIN_ROLE(), deployer);
            raterRegistry.renounceRole(raterRegistry.ADMIN_ROLE(), deployer);
            raterRegistry.renounceRole(raterRegistry.SEEDER_ROLE(), deployer);
            raterRegistry.renounceRole(raterRegistry.SCORER_ROLE(), deployer);
            raterDeclarationRegistry.renounceRole(raterDeclarationRegistry.CONFIG_ROLE(), deployer);
            raterDeclarationRegistry.renounceRole(raterDeclarationRegistry.PROBE_ROLE(), deployer);
            raterDeclarationRegistry.renounceRole(raterDeclarationRegistry.CHALLENGE_RESOLVER_ROLE(), deployer);
            optionalIdentity.transferOwnership(governance);

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
        console.log("RaterRegistry:", address(raterRegistry));
        console.log("World ID Router:", worldIdRouterAddress);
        console.log("World ID External Nullifier Hash:", worldIdExternalNullifierHash);
        console.log("RaterDeclarationRegistry:", address(raterDeclarationRegistry));
        console.log("Optional identity NFT:", address(optionalIdentity));
        console.log("ParticipationPool:", address(participationPool));
        console.log("LaunchDistributionPool:", address(launchDistributionPool));
        console.log("Governance:", governance);
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
        address participationPool,
        address rewardDistributor,
        address votingEngine,
        address treasury,
        address contentRegistry,
        address frontendRegistry
    ) internal pure returns (address[] memory holders) {
        address[] memory temp = new address[](7);
        uint256 count;
        count = _appendUnique(temp, count, launchDistribution);
        count = _appendUnique(temp, count, participationPool);
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

    function _fundLocalDevAccounts(LoopReputation lrepToken, MockERC20 localUsdcToken, VoterIdNFT optionalIdentity)
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

        optionalIdentity.addMinter(deployer);
        for (uint256 i = 0; i < testAccounts.length; i++) {
            optionalIdentity.mint(testAccounts[i], i + 100);
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

        string[] memory safetySubcats = new string[](8);
        safetySubcats[0] = "Trust";
        safetySubcats[1] = "Spam";
        safetySubcats[2] = "Harassment";
        safetySubcats[3] = "Moderation";
        safetySubcats[4] = "Privacy";
        safetySubcats[5] = "Disclosure";
        safetySubcats[6] = "Risk";
        safetySubcats[7] = "Policy";
        registry.addCategory("Trust", "trust", safetySubcats);

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
contract DeployScript is DeployRateLoop {}
