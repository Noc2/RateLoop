// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { console } from "forge-std/console.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { IVotes } from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { MeshReputation } from "../contracts/MeshReputation.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { CategoryRegistry } from "../contracts/CategoryRegistry.sol";
import { FeedbackBonusEscrow } from "../contracts/FeedbackBonusEscrow.sol";
import { ProfileRegistry } from "../contracts/ProfileRegistry.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { QuestionRewardPoolEscrow } from "../contracts/QuestionRewardPoolEscrow.sol";
import { RaterDeclarationRegistry } from "../contracts/RaterDeclarationRegistry.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { X402QuestionSubmitter } from "../contracts/X402QuestionSubmitter.sol";
import { VoterIdNFT } from "../contracts/VoterIdNFT.sol";
import { ParticipationPool } from "../contracts/ParticipationPool.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { CuryoGovernor } from "../contracts/governance/CuryoGovernor.sol";

/// @notice Fresh RateMesh deployment script for Celo.
/// @dev Optional identity can be wired later by governance; no required Self.xyz faucet is deployed here.
contract DeployRateMesh is ScaffoldETHDeploy {
    error UnsupportedCeloChain(uint256 chainId);
    error InvalidLaunchDistributionRecipient();

    uint256 public constant TIMELOCK_MIN_DELAY = 2 days;

    uint256 public constant TOTAL_SUPPLY_CAP = 100_000_000 * 1e6;
    uint256 public constant CONSENSUS_POOL_AMOUNT = 4_000_000 * 1e6;
    uint256 public constant TREASURY_AMOUNT = 32_000_000 * 1e6;
    uint256 public constant PARTICIPATION_POOL_AMOUNT = 12_000_000 * 1e6;
    uint256 public constant LAUNCH_DISTRIBUTION_AMOUNT =
        TOTAL_SUPPLY_CAP - CONSENSUS_POOL_AMOUNT - TREASURY_AMOUNT - PARTICIPATION_POOL_AMOUNT;
    uint256 public constant MIN_AI_DECLARATION_BOND = 100 * 1e6;
    uint256 public constant AI_DECLARATION_CHALLENGE_BOND = 25 * 1e6;

    address internal constant CELO_MAINNET_USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    address internal constant CELO_SEPOLIA_USDC = 0x01C5C0122039549AD1493B8220cABEdD739BC44E;

    function _preBroadcastChecks() internal view override {
        if (block.chainid != 31337 && block.chainid != 42220 && block.chainid != 11142220) {
            revert UnsupportedCeloChain(block.chainid);
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

        MeshReputation mrepToken = new MeshReputation(deployer, governance);
        console.log("MeshReputation deployed at:", address(mrepToken));

        if (!isLocalDev) {
            governor = new CuryoGovernor(IVotes(address(mrepToken)), TimelockController(payable(governance)));
            governorAddr = address(governor);
            console.log("CuryoGovernor deployed at:", governorAddr);

            TimelockController tc = TimelockController(payable(governance));
            tc.grantRole(tc.PROPOSER_ROLE(), governorAddr);
            tc.grantRole(tc.CANCELLER_ROLE(), governorAddr);
            tc.grantRole(tc.CANCELLER_ROLE(), deployer);
            mrepToken.setGovernor(governorAddr);
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
            abi.encodeCall(FrontendRegistry.initialize, (deployer, governance, address(mrepToken)))
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
                ContentRegistry.initializeWithTreasury, (deployer, governance, governance, address(mrepToken))
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
                (governance, address(mrepToken), address(registry), address(protocolConfig))
            )
        );
        RoundVotingEngine votingEngine = RoundVotingEngine(address(votingEngineProxy));

        TransparentUpgradeableProxy rewardDistributorProxy = new TransparentUpgradeableProxy(
            address(rewardDistributorImpl),
            governance,
            abi.encodeCall(
                RoundRewardDistributor.initialize,
                (governance, address(mrepToken), address(votingEngine), address(registry))
            )
        );
        RoundRewardDistributor rewardDistributor = RoundRewardDistributor(address(rewardDistributorProxy));

        CategoryRegistry categoryRegistry = new CategoryRegistry(deployer, governance);
        RaterRegistry raterRegistry = new RaterRegistry(deployer, governance);
        RaterDeclarationRegistry raterDeclarationRegistry = new RaterDeclarationRegistry(
            deployer, governance, mrepToken, governance, MIN_AI_DECLARATION_BOND, AI_DECLARATION_CHALLENGE_BOND
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
            usdcTokenAddress = _resolveCeloUsdcAddress();
            console.log("Circle USDC resolved at:", usdcTokenAddress);
        }

        TransparentUpgradeableProxy questionRewardPoolEscrowProxy = new TransparentUpgradeableProxy(
            address(questionRewardPoolEscrowImpl),
            governance,
            abi.encodeCall(
                QuestionRewardPoolEscrow.initialize,
                (
                    governance,
                    address(mrepToken),
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

        registry.setVoterIdNFT(address(optionalIdentity));
        frontendRegistry.setVoterIdNFT(address(optionalIdentity));
        profileRegistry.setVoterIdNFT(address(optionalIdentity));

        frontendRegistry.setVotingEngine(address(votingEngine));
        frontendRegistry.initializeFeeCreditor(address(rewardDistributor));

        _seedCategories(categoryRegistry);
        mrepToken.setPredictionContracts(address(votingEngine), address(rewardDistributor));
        protocolConfig.setConfig(20 minutes, 7 days, 3, 200);

        mrepToken.mint(deployer, CONSENSUS_POOL_AMOUNT);
        mrepToken.approve(address(votingEngine), CONSENSUS_POOL_AMOUNT);
        votingEngine.addToConsensusReserve(CONSENSUS_POOL_AMOUNT);
        console.log("Funded 4M MREP to consensus reserve");

        mrepToken.mint(governance, TREASURY_AMOUNT);
        console.log("Minted 32M MREP to governance treasury");

        ParticipationPool participationPool = new ParticipationPool(address(mrepToken), governance);
        participationPool.setAuthorizedCaller(address(rewardDistributor), true);
        mrepToken.mint(deployer, PARTICIPATION_POOL_AMOUNT);
        mrepToken.approve(address(participationPool), PARTICIPATION_POOL_AMOUNT);
        participationPool.depositPool(PARTICIPATION_POOL_AMOUNT);
        protocolConfig.setParticipationPool(address(participationPool));
        console.log("ParticipationPool deployed and funded with 12M MREP");

        address launchDistributionRecipient = vm.envOr("LAUNCH_DISTRIBUTION_RECIPIENT", governance);
        if (launchDistributionRecipient == address(0)) revert InvalidLaunchDistributionRecipient();
        mrepToken.mint(launchDistributionRecipient, LAUNCH_DISTRIBUTION_AMOUNT);
        console.log("Minted 52M MREP launch distribution pool:", launchDistributionRecipient);

        if (!isLocalDev) {
            address[] memory excludedHolders = _buildQuorumExcludedHolders(
                launchDistributionRecipient,
                address(participationPool),
                address(rewardDistributor),
                address(votingEngine),
                governance,
                address(registry),
                address(frontendRegistry)
            );
            CuryoGovernor(payable(governorAddr)).initializePools(excludedHolders);
            participationPool.transferOwnership(governance);
        }

        if (isLocalDev) {
            _fundLocalDevAccounts(mrepToken, localUsdcToken, optionalIdentity);
        }

        deployments.push(Deployment("MeshReputation", address(mrepToken)));
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
        deployments.push(Deployment("RaterDeclarationRegistry", address(raterDeclarationRegistry)));
        deployments.push(Deployment("VoterIdNFT", address(optionalIdentity)));
        deployments.push(Deployment("ParticipationPool", address(participationPool)));
        if (isLocalDev) deployments.push(Deployment("MockERC20", usdcTokenAddress));

        if (!isLocalDev) {
            mrepToken.renounceRole(mrepToken.MINTER_ROLE(), deployer);
            mrepToken.renounceRole(mrepToken.CONFIG_ROLE(), deployer);
            registry.renounceRole(registry.CONFIG_ROLE(), deployer);
            protocolConfig.renounceRole(protocolConfig.CONFIG_ROLE(), deployer);
            frontendRegistry.renounceRole(frontendRegistry.ADMIN_ROLE(), deployer);
            profileRegistry.renounceRole(profileRegistry.ADMIN_ROLE(), deployer);
            categoryRegistry.renounceRole(categoryRegistry.ADMIN_ROLE(), deployer);
            raterRegistry.renounceRole(raterRegistry.ADMIN_ROLE(), deployer);
            raterRegistry.renounceRole(raterRegistry.SELF_ATTESTOR_ROLE(), deployer);
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
            mrepToken.revokeRole(mrepToken.MINTER_ROLE(), deployer);
        }

        console.log("=== RateMesh Protocol Deployed ===");
        console.log("MeshReputation:", address(mrepToken));
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
        console.log("RaterDeclarationRegistry:", address(raterDeclarationRegistry));
        console.log("Optional identity NFT:", address(optionalIdentity));
        console.log("ParticipationPool:", address(participationPool));
        console.log("Governance:", governance);
    }

    function _resolveCeloUsdcAddress() internal view returns (address) {
        if (block.chainid == 42220) return CELO_MAINNET_USDC;
        if (block.chainid == 11142220) return CELO_SEPOLIA_USDC;
        revert UnsupportedCeloChain(block.chainid);
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

    function _fundLocalDevAccounts(MeshReputation mrepToken, MockERC20 localUsdcToken, VoterIdNFT optionalIdentity)
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
            mrepToken.transfer(testAccounts[i], testAmount);
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
contract DeployScript is DeployRateMesh { }
