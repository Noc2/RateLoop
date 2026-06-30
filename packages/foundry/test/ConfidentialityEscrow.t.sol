// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { AdvisoryVoteRecorder } from "../contracts/AdvisoryVoteRecorder.sol";
import { ConfidentialityEscrow } from "../contracts/ConfidentialityEscrow.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { FrontendRegistry } from "../contracts/FrontendRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { Eip3009Authorization } from "../contracts/interfaces/IEip3009.sol";
import { IConfidentialityEscrow } from "../contracts/interfaces/IConfidentialityEscrow.sol";
import { IRaterIdentityRegistry } from "../contracts/interfaces/IRaterIdentityRegistry.sol";
import { VotePreflightLib } from "../contracts/libraries/VotePreflightLib.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";
import { MockQuestionRewardPoolEscrow } from "./mocks/MockQuestionRewardPoolEscrow.sol";

contract ConfidentialityEscrowTest is VotingTestBase {
    LoopReputation internal lrepToken;
    MockERC20 internal usdcToken;
    ContentRegistry internal registry;
    RoundVotingEngine internal engine;
    RoundRewardDistributor internal rewardDistributor;
    ProtocolConfig internal protocolConfig;
    RaterRegistry internal raterRegistry;
    ConfidentialityEscrow internal confidentialityEscrow;
    AdvisoryVoteRecorder internal advisoryRecorder;

    address internal owner = address(0xA11CE);
    address internal submitter = address(0xB0B);
    address internal voter1 = address(0xCAFE);
    address internal voter2 = address(0xD00D);
    address internal delegate = address(0xDE1E6A7E);
    address internal reporter = address(0xE11);
    address internal treasury = address(0xFEE);

    uint256 internal constant STAKE = 5e6;
    bytes32 internal constant VOTER1_ANCHOR = keccak256("voter-1-world-id");
    bytes32 internal constant VOTER2_ANCHOR = keccak256("voter-2-world-id");
    bytes32 internal constant DELEGATE_ANCHOR = keccak256("delegate-world-id");
    bytes32 internal constant EVIDENCE_HASH = keccak256("confidentiality evidence");
    bytes32 internal constant LOG_ROOT = keccak256("confidentiality log root");
    bytes32 internal constant LOG_ARTIFACT_HASH = keccak256("confidentiality log artifact");

    event ConfidentialityLogRootPublished(
        bytes32 indexed epochHash,
        bytes32 indexed merkleRoot,
        address indexed publisher,
        string epoch,
        bytes32 artifactHash,
        string artifactUri
    );

    struct FlaggedQuestionSubmission {
        string contextUrl;
        string title;
        string tags;
        bytes32 salt;
        ContentRegistry.SubmissionDetails details;
        ContentRegistry.SubmissionRewardTerms rewardTerms;
        RoundLib.RoundConfig roundConfig;
        ContentRegistry.QuestionSpecCommitment spec;
        IConfidentialityEscrow.ConfidentialityConfig confidentiality;
    }

    function _tlockEpochDuration() internal pure override returns (uint256) {
        return 1 hours;
    }

    function setUp() public {
        vm.warp(1_000_000);
        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);
        usdcToken = new MockERC20("USD Coin", "USDC", 6);

        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(new ContentRegistry()),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, treasury, address(lrepToken)))
                )
            )
        );
        protocolConfig = _deployProtocolConfig(owner);
        engine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(new RoundVotingEngine()),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(protocolConfig))
                    )
                )
            )
        );
        rewardDistributor = RoundRewardDistributor(
            address(
                new ERC1967Proxy(
                    address(new RoundRewardDistributor()),
                    abi.encodeCall(
                        RoundRewardDistributor.initialize,
                        (owner, address(lrepToken), address(engine), address(registry))
                    )
                )
            )
        );
        raterRegistry = _deployRaterRegistry(owner);
        confidentialityEscrow = ConfidentialityEscrow(
            address(
                new ERC1967Proxy(
                    address(new ConfidentialityEscrow()),
                    abi.encodeCall(
                        ConfidentialityEscrow.initialize,
                        (
                            owner,
                            owner,
                            address(lrepToken),
                            address(usdcToken),
                            address(registry),
                            address(protocolConfig),
                            treasury
                        )
                    )
                )
            )
        );

        MockCategoryRegistry categoryRegistry = new MockCategoryRegistry();
        categoryRegistry.seedDefaultTestCategories();
        registry.setVotingEngine(address(engine));
        registry.setProtocolConfig(address(protocolConfig));
        registry.setCategoryRegistry(address(categoryRegistry));
        registry.setQuestionRewardPoolEscrow(address(_newMockQuestionRewardPoolEscrow(registry)));

        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setCategoryRegistry(address(categoryRegistry));
        protocolConfig.setRaterRegistry(address(raterRegistry));
        protocolConfig.setTreasury(treasury);
        _setTlockRoundConfig(protocolConfig, 1 hours, 1 hours, 3, 100);

        advisoryRecorder = new AdvisoryVoteRecorder(address(engine), address(registry), owner);
        protocolConfig.setAdvisoryVoteRecorder(address(advisoryRecorder));

        FrontendRegistry frontendRegistry = FrontendRegistry(
            address(
                new ERC1967Proxy(
                    address(new FrontendRegistry()),
                    abi.encodeCall(FrontendRegistry.initialize, (owner, owner, address(lrepToken)))
                )
            )
        );
        frontendRegistry.setVotingEngine(address(engine));
        frontendRegistry.addFeeCreditor(address(rewardDistributor));
        protocolConfig.setFrontendRegistry(address(frontendRegistry));

        raterRegistry.setConfidentialityEscrow(address(confidentialityEscrow));
        protocolConfig.setConfidentialityEscrow(address(confidentialityEscrow));
        _seedRaterIdentity(raterRegistry, voter1, VOTER1_ANCHOR);
        _seedRaterIdentity(raterRegistry, voter2, VOTER2_ANCHOR);

        address[3] memory accounts = [submitter, voter1, voter2];
        for (uint256 i = 0; i < accounts.length; i++) {
            lrepToken.mint(accounts[i], 10_000e6);
            usdcToken.mint(accounts[i], 10_000e6);
        }
        vm.stopPrank();
    }

    function testConfigurePostReleaseAndSlashBond() public {
        uint256 contentId = _submitGatedQuestion("release", 1e6);

        IConfidentialityEscrow.ConfidentialityConfig memory config =
            confidentialityEscrow.confidentialityConfig(contentId);
        assertTrue(config.gated);
        assertEq(config.bondAsset, confidentialityEscrow.BOND_ASSET_LREP());
        assertEq(config.bondAmount, 1e6);

        bytes32 identityKey = _postLrepBond(contentId, voter1);
        assertTrue(confidentialityEscrow.hasActiveBond(contentId, identityKey));

        vm.prank(submitter);
        registry.cancelContent(contentId);
        vm.warp(block.timestamp + confidentialityEscrow.evidenceWindow());
        uint256 beforeBalance = lrepToken.balanceOf(voter1);
        confidentialityEscrow.releaseBond(contentId, identityKey);
        assertEq(lrepToken.balanceOf(voter1), beforeBalance + 1e6);
        assertFalse(confidentialityEscrow.hasActiveBond(contentId, identityKey));

        uint256 slashContentId = _submitGatedQuestion("slash", 2e6);
        bytes32 slashIdentityKey = _postLrepBond(slashContentId, voter2);
        uint256 reporterBefore = lrepToken.balanceOf(reporter);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);

        vm.prank(owner);
        confidentialityEscrow.slashBond(slashContentId, slashIdentityKey, "verified leak", EVIDENCE_HASH, reporter);

        assertEq(lrepToken.balanceOf(reporter), reporterBefore + 1e6);
        assertEq(lrepToken.balanceOf(treasury), treasuryBefore + 1e6);
        assertFalse(confidentialityEscrow.hasActiveBond(slashContentId, slashIdentityKey));
    }

    function testPrivateForeverBondReleasesUnderNormalPredicate() public {
        uint256 contentId = _submitPrivateForeverGatedQuestion("private-forever-release", 1e6);
        bytes32 identityKey = _postLrepBond(contentId, voter1);
        assertTrue(confidentialityEscrow.hasActiveBond(contentId, identityKey));

        IConfidentialityEscrow.ConfidentialityConfig memory config =
            confidentialityEscrow.confidentialityConfig(contentId);
        assertEq(config.flags, confidentialityEscrow.CONFIDENTIALITY_FLAG_PRIVATE_FOREVER());

        vm.prank(submitter);
        registry.cancelContent(contentId);
        vm.warp(block.timestamp + confidentialityEscrow.evidenceWindow());
        uint256 beforeBalance = lrepToken.balanceOf(voter1);
        confidentialityEscrow.releaseBond(contentId, identityKey);

        assertEq(lrepToken.balanceOf(voter1), beforeBalance + 1e6);
        assertFalse(confidentialityEscrow.hasActiveBond(contentId, identityKey));
    }

    function testPrivateForeverBondCanBeSlashedBeforeRelease() public {
        uint256 contentId = _submitPrivateForeverGatedQuestion("private-forever-slash", 2e6);
        bytes32 identityKey = _postLrepBond(contentId, voter2);

        uint256 reporterBefore = lrepToken.balanceOf(reporter);
        uint256 treasuryBefore = lrepToken.balanceOf(treasury);

        vm.prank(owner);
        confidentialityEscrow.slashBond(contentId, identityKey, "verified leak", EVIDENCE_HASH, reporter);

        assertEq(lrepToken.balanceOf(reporter), reporterBefore + 1e6);
        assertEq(lrepToken.balanceOf(treasury), treasuryBefore + 1e6);
        assertFalse(confidentialityEscrow.hasActiveBond(contentId, identityKey));
    }

    function testPrivateForeverBondCannotBeSlashedAfterRelease() public {
        uint256 contentId = _submitPrivateForeverGatedQuestion("private-forever-release-before-slash", 1e6);
        bytes32 identityKey = _postLrepBond(contentId, voter1);

        vm.prank(submitter);
        registry.cancelContent(contentId);
        vm.warp(block.timestamp + confidentialityEscrow.evidenceWindow());
        confidentialityEscrow.releaseBond(contentId, identityKey);

        vm.prank(owner);
        vm.expectRevert("No active bond");
        confidentialityEscrow.slashBond(contentId, identityKey, "late leak", EVIDENCE_HASH, reporter);
    }

    function testGatedQuestionConfiguresEscrowAndRoundSnapshotsEscrow() public {
        uint256 contentId = _submitGatedQuestion("snapshot-shape", 0);

        IConfidentialityEscrow.ConfidentialityConfig memory config =
            confidentialityEscrow.confidentialityConfig(contentId);
        assertTrue(config.gated);
        assertEq(config.bondAsset, confidentialityEscrow.BOND_ASSET_LREP());
        assertEq(config.bondAmount, 0);
        assertEq(config.flags, 0);

        vm.prank(voter1);
        engine.openRound(contentId);
        uint256 roundId = engine.currentRoundId(contentId);

        address snapshotEscrow = address(uint160(engine.roundConfidentialityEscrowSnapshotWord(contentId, roundId)));
        assertEq(snapshotEscrow, address(confidentialityEscrow));
    }

    function testConfigureOnlyAcceptsRegistryCaller() public {
        uint8 lrepAsset = confidentialityEscrow.BOND_ASSET_LREP();

        vm.prank(owner);
        vm.expectRevert("Invalid registry");
        confidentialityEscrow.configure(
            1000,
            IConfidentialityEscrow.ConfidentialityConfig({ gated: true, bondAsset: lrepAsset, bondAmount: 0, flags: 0 })
        );
    }

    function testConfigureRejectsUnsupportedFlags() public {
        uint8 lrepAsset = confidentialityEscrow.BOND_ASSET_LREP();

        vm.prank(address(registry));
        vm.expectRevert("Invalid flags");
        confidentialityEscrow.configure(
            1001,
            IConfidentialityEscrow.ConfidentialityConfig({ gated: true, bondAsset: lrepAsset, bondAmount: 0, flags: 2 })
        );
    }

    function testConfigureRejectsUngatedFlags() public {
        uint8 lrepAsset = confidentialityEscrow.BOND_ASSET_LREP();

        vm.prank(address(registry));
        vm.expectRevert("Ungated flags");
        confidentialityEscrow.configure(
            1002,
            IConfidentialityEscrow.ConfidentialityConfig({
                gated: false, bondAsset: lrepAsset, bondAmount: 0, flags: 1
            })
        );
    }

    function testRegistryRejectsUngatedConfidentialityFlags() public {
        FlaggedQuestionSubmission memory submission = _ungatedFlaggedQuestionSubmission();
        _reserveFlaggedQuestionSubmission(submission);

        vm.startPrank(submitter);
        vm.expectRevert();
        registry.submitQuestionWithRewardAndRoundConfig(
            submission.contextUrl,
            _emptyImageUrls(),
            "",
            submission.title,
            submission.tags,
            1,
            submission.details,
            submission.salt,
            submission.rewardTerms,
            submission.roundConfig,
            submission.spec,
            submission.confidentiality
        );
        vm.stopPrank();
    }

    function testGatedCommitRequiresCredentialAndBond() public {
        uint256 contentId = _submitGatedQuestion("commit-gate", 1e6);

        vm.expectRevert(VotePreflightLib.ConfidentialityBondRequired.selector);
        vm.prank(voter1);
        engine.openRound(contentId);

        _postLrepBond(contentId, voter1);
        _commitVote(voter1, contentId, true);

        address uncredentialed = address(0x5150);
        vm.prank(owner);
        lrepToken.mint(uncredentialed, 10_000e6);
        _expectCommitVoteRevert(
            uncredentialed, contentId, true, VotePreflightLib.ConfidentialityCredentialRequired.selector
        );
    }

    function testPostBondRejectsShortTransferReceipt() public {
        uint256 contentId =
            _submitGatedQuestionWithAsset("short-transfer", confidentialityEscrow.BOND_ASSET_USDC(), uint64(1e6));
        IRaterIdentityRegistry.ResolvedRater memory resolved = raterRegistry.resolveRater(voter1);

        usdcToken.setTransferShortfall(1);

        vm.startPrank(voter1);
        usdcToken.approve(address(confidentialityEscrow), 1e6);
        vm.expectRevert("Bad token");
        confidentialityEscrow.postBond(contentId);
        vm.stopPrank();

        assertFalse(confidentialityEscrow.hasActiveBond(contentId, resolved.identityKey));
        assertEq(usdcToken.balanceOf(address(confidentialityEscrow)), 0);
    }

    function testPostBondWithAuthorizationRejectsShortReceipt() public {
        uint256 authVoterKey = 0xA11CE123;
        address authVoter = vm.addr(authVoterKey);
        bytes32 authAnchor = keccak256("authorization-voter-world-id");

        vm.startPrank(owner);
        usdcToken.mint(authVoter, 10_000e6);
        _seedRaterIdentity(raterRegistry, authVoter, authAnchor);
        vm.stopPrank();

        uint256 contentId = _submitGatedQuestionWithAsset(
            "short-authorization", confidentialityEscrow.BOND_ASSET_USDC(), uint64(1e6)
        );
        IRaterIdentityRegistry.ResolvedRater memory resolved = raterRegistry.resolveRater(authVoter);
        Eip3009Authorization memory authorization = _bondAuthorization(authVoter, authVoterKey, 1e6);

        usdcToken.setAuthorizationTransferShortfall(1);

        vm.prank(authVoter);
        vm.expectRevert("Bad token");
        confidentialityEscrow.postBondWithAuthorization(contentId, authorization);

        assertFalse(confidentialityEscrow.hasActiveBond(contentId, resolved.identityKey));
        assertEq(usdcToken.balanceOf(address(confidentialityEscrow)), 0);
    }

    function testPostBondWithPermitRejectsShortTransferReceipt() public {
        ConfidentialityEscrow shortEscrow = ConfidentialityEscrow(
            address(
                new ERC1967Proxy(
                    address(new ConfidentialityEscrow()),
                    abi.encodeCall(
                        ConfidentialityEscrow.initialize,
                        (
                            address(this),
                            address(this),
                            address(usdcToken),
                            address(usdcToken),
                            address(registry),
                            address(protocolConfig),
                            treasury
                        )
                    )
                )
            )
        );
        uint256 contentId = 999;
        uint8 lrepAsset = shortEscrow.BOND_ASSET_LREP();
        assertTrue(shortEscrow.hasRole(shortEscrow.CONFIG_ROLE(), address(registry)));
        vm.prank(address(registry));
        shortEscrow.configure(
            contentId,
            IConfidentialityEscrow.ConfidentialityConfig({
                gated: true, bondAsset: lrepAsset, bondAmount: uint64(1e6), flags: 0
            })
        );
        IRaterIdentityRegistry.ResolvedRater memory resolved = raterRegistry.resolveRater(voter1);

        usdcToken.setTransferShortfall(1);

        vm.startPrank(voter1);
        usdcToken.approve(address(shortEscrow), 1e6);
        vm.expectRevert("Bad token");
        shortEscrow.postBondWithPermit(contentId, block.timestamp + 1 days, 0, bytes32(0), bytes32(0));
        vm.stopPrank();

        assertFalse(shortEscrow.hasActiveBond(contentId, resolved.identityKey));
        assertEq(usdcToken.balanceOf(address(shortEscrow)), 0);
    }

    function testZeroBondGatedCommitRecordsBanNexus() public {
        uint256 contentId = _submitGatedQuestion("zero-bond-nexus", 0);
        uint8 provider = uint8(RaterRegistry.HumanCredentialProvider.SeededHuman);

        assertFalse(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER1_ANCHOR));
        _commitVote(voter1, contentId, true);
        assertTrue(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER1_ANCHOR));

        vm.prank(owner);
        raterRegistry.banIdentity(
            RaterRegistry.HumanCredentialProvider.SeededHuman,
            VOTER1_ANCHOR,
            uint64(block.timestamp + 365 days),
            "verified leak",
            EVIDENCE_HASH
        );

        uint256 secondContentId = _submitGatedQuestion("zero-bond-blocked", 0);
        vm.expectRevert(VotePreflightLib.IdentityBanned.selector);
        vm.prank(voter1);
        engine.openRound(secondContentId);
    }

    function testZeroBondGatedCommitRecordsBanNexusForRoundRegistrySnapshotAfterRotation() public {
        uint256 contentId = _submitGatedQuestion("zero-bond-rotated-round-registry-nexus", 0);
        uint8 provider = uint8(RaterRegistry.HumanCredentialProvider.SeededHuman);

        vm.prank(voter2);
        engine.openRound(contentId);
        uint256 roundId = engine.currentRoundId(contentId);
        assertEq(engine.roundRaterRegistrySnapshot(contentId, roundId), address(raterRegistry));

        RaterRegistry replacementRegistry = _deployRaterRegistry(owner);
        vm.prank(owner);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        protocolConfig.setRaterRegistry(address(replacementRegistry));

        vm.prank(owner);
        replacementRegistry.setConfidentialityEscrow(address(confidentialityEscrow));

        vm.prank(owner);
        protocolConfig.setRaterRegistry(address(replacementRegistry));
        assertEq(protocolConfig.raterRegistry(), address(replacementRegistry));

        assertFalse(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER1_ANCHOR));
        _commitVoteWithoutOpeningRound(voter1, contentId, true);
        assertTrue(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER1_ANCHOR));

        vm.prank(owner);
        raterRegistry.banIdentity(
            RaterRegistry.HumanCredentialProvider.SeededHuman,
            VOTER1_ANCHOR,
            uint64(block.timestamp + 365 days),
            "verified leak after registry rotation",
            EVIDENCE_HASH
        );

        assertTrue(raterRegistry.isIdentityKeyBanned(raterRegistry.addressIdentityKey(voter1)));

        vm.prank(owner);
        replacementRegistry.banIdentity(
            RaterRegistry.HumanCredentialProvider.SeededHuman,
            VOTER1_ANCHOR,
            uint64(block.timestamp + 365 days),
            "replacement registry ban after rotation",
            keccak256("replacement-registry-ban")
        );
        bytes32 replacementCredentialKey =
            replacementRegistry.credentialIdentityKey(RaterRegistry.HumanCredentialProvider.SeededHuman, VOTER1_ANCHOR);
        assertTrue(replacementRegistry.isIdentityKeyBanned(replacementCredentialKey));
    }

    function testTrackedOldEngineCanCommitGatedVoteAfterVotingEngineRotation() public {
        uint256 contentId = _submitGatedQuestion("old-engine-gated-commit-after-rotation", 0);
        uint8 provider = uint8(RaterRegistry.HumanCredentialProvider.SeededHuman);

        vm.prank(voter1);
        engine.openRound(contentId);
        _commitVoteWithoutOpeningRound(voter1, contentId, true);
        uint256 roundId = engine.currentRoundId(contentId);

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        _rotateRegistryVotingEngine(replacementEngine);

        assertEq(registry.votingEngine(), address(replacementEngine));
        assertEq(registry.trackedVotingEngine(contentId), address(engine));
        assertFalse(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER2_ANCHOR));

        _commitVoteWithoutOpeningRound(voter2, contentId, false);

        assertTrue(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER2_ANCHOR));
        (, RoundLib.RoundState state, uint16 voteCount,, uint64 totalStake,,,) = engine.roundCore(contentId, roundId);
        assertEq(uint256(state), uint256(RoundLib.RoundState.Open));
        assertEq(voteCount, 2);
        assertEq(totalStake, uint64(2 * STAKE));
    }

    function testTrackedOldEngineTerminalRoundReleasesBondAfterVotingEngineRotation() public {
        uint256 contentId = _submitGatedQuestion("old-engine-bond-release-after-rotation", 1e6);
        bytes32 identityKey = _postLrepBond(contentId, voter1);

        vm.prank(voter1);
        engine.openRound(contentId);
        uint256 roundId = engine.currentRoundId(contentId);
        _commitVoteWithoutOpeningRound(voter1, contentId, true);

        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        _rotateRegistryVotingEngine(replacementEngine);

        assertEq(registry.votingEngine(), address(replacementEngine));
        assertEq(registry.trackedVotingEngine(contentId), address(engine));
        assertEq(replacementEngine.currentRoundId(contentId), 0);

        vm.warp(block.timestamp + 30 days);
        engine.cancelExpiredRound(contentId, roundId);

        uint256 beforeBalance = lrepToken.balanceOf(voter1);
        confidentialityEscrow.releaseBond(contentId, identityKey);

        assertEq(lrepToken.balanceOf(voter1), beforeBalance + 1e6);
        assertFalse(confidentialityEscrow.hasActiveBond(contentId, identityKey));
    }

    function testOldEngineCannotRecordGatedNexusForReplacementTrackedContentAfterRotation() public {
        RoundVotingEngine replacementEngine = _deployReplacementVotingEngine();
        _rotateRegistryVotingEngine(replacementEngine);

        uint256 contentId = _submitGatedQuestion("replacement-tracked-after-rotation", 0);
        assertEq(registry.trackedVotingEngine(contentId), address(replacementEngine));

        vm.prank(address(engine));
        vm.expectRevert("Not voting engine");
        confidentialityEscrow.recordConfidentialityNexusForRegistry(contentId, voter1, address(raterRegistry));
    }

    function testZeroBondGatedOpenRoundRecordsBanNexus() public {
        uint256 contentId = _submitGatedQuestion("zero-bond-open-nexus", 0);
        uint8 provider = uint8(RaterRegistry.HumanCredentialProvider.SeededHuman);

        assertFalse(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER1_ANCHOR));
        vm.prank(voter1);
        engine.openRound(contentId);
        assertTrue(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER1_ANCHOR));

        vm.prank(owner);
        raterRegistry.banIdentity(
            RaterRegistry.HumanCredentialProvider.SeededHuman,
            VOTER1_ANCHOR,
            uint64(block.timestamp + 365 days),
            "verified open leak",
            EVIDENCE_HASH
        );

        assertTrue(raterRegistry.isIdentityKeyBanned(raterRegistry.addressIdentityKey(voter1)));
    }

    function testZeroBondGatedAccessRecorderCreatesBanNexusWithoutCommit() public {
        uint256 contentId = _submitGatedQuestion("zero-bond-access", 0);
        uint8 provider = uint8(RaterRegistry.HumanCredentialProvider.SeededHuman);

        assertFalse(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER1_ANCHOR));
        vm.prank(owner);
        confidentialityEscrow.recordAccessNexus(contentId, voter1);
        assertTrue(confidentialityEscrow.hasConfidentialityNexus(provider, VOTER1_ANCHOR));

        vm.prank(owner);
        raterRegistry.banIdentity(
            RaterRegistry.HumanCredentialProvider.SeededHuman,
            VOTER1_ANCHOR,
            uint64(block.timestamp + 365 days),
            "verified view leak",
            EVIDENCE_HASH
        );

        assertTrue(raterRegistry.isIdentityKeyBanned(raterRegistry.addressIdentityKey(voter1)));
    }

    function testRecordAccessNexusRequiresRecorderRole() public {
        uint256 contentId = _submitGatedQuestion("zero-bond-access-role", 0);

        vm.expectRevert();
        vm.prank(voter1);
        confidentialityEscrow.recordAccessNexus(contentId, voter1);
    }

    function testRecordConfidentialityNexusForRegistryRevertsWhenPaused() public {
        uint256 contentId = _submitGatedQuestion("zero-bond-engine-paused", 0);

        vm.prank(owner);
        confidentialityEscrow.setPaused(true);

        vm.expectRevert();
        vm.prank(address(engine));
        confidentialityEscrow.recordConfidentialityNexusForRegistry(contentId, voter1, address(raterRegistry));
    }

    function testPublishLogRootRequiresRecorderRoleAndEmitsArtifactAnchor() public {
        string memory epoch = "2026-06-15";
        string memory artifactUri = "https://rateloop.ai/api/confidentiality/log-roots/2026-06-15/artifact";

        vm.prank(voter1);
        vm.expectRevert();
        confidentialityEscrow.publishLogRoot(epoch, LOG_ROOT, LOG_ARTIFACT_HASH, artifactUri);

        vm.expectEmit(true, true, true, true);
        emit ConfidentialityLogRootPublished(
            keccak256(bytes(epoch)), LOG_ROOT, owner, epoch, LOG_ARTIFACT_HASH, artifactUri
        );
        vm.prank(owner);
        confidentialityEscrow.publishLogRoot(epoch, LOG_ROOT, LOG_ARTIFACT_HASH, artifactUri);

        (
            bytes32 anchoredRoot,
            bytes32 anchoredArtifactHash,
            bytes32 anchoredArtifactUriHash,
            address publisher,
            uint64 publishedAt
        ) = confidentialityEscrow.logRootAnchors(keccak256(bytes(epoch)));
        assertEq(anchoredRoot, LOG_ROOT);
        assertEq(anchoredArtifactHash, LOG_ARTIFACT_HASH);
        assertEq(anchoredArtifactUriHash, keccak256(bytes(artifactUri)));
        assertEq(publisher, owner);
        assertEq(publishedAt, block.timestamp);

        vm.prank(owner);
        confidentialityEscrow.publishLogRoot(epoch, LOG_ROOT, LOG_ARTIFACT_HASH, artifactUri);

        vm.prank(owner);
        vm.expectRevert("Log root sealed");
        confidentialityEscrow.publishLogRoot(epoch, keccak256("changed root"), LOG_ARTIFACT_HASH, artifactUri);
    }

    function testPublishLogRootRejectsInvalidArtifact() public {
        vm.startPrank(owner);

        vm.expectRevert("Invalid epoch");
        confidentialityEscrow.publishLogRoot("", LOG_ROOT, LOG_ARTIFACT_HASH, "");

        vm.expectRevert("Invalid artifact");
        confidentialityEscrow.publishLogRoot("2026-06-15", LOG_ROOT, bytes32(0), "");

        vm.expectRevert("Invalid artifact URI");
        confidentialityEscrow.publishLogRoot(
            "2026-06-15",
            LOG_ROOT,
            LOG_ARTIFACT_HASH,
            "https://rateloop.ai/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );

        vm.stopPrank();
    }

    function testGatedQuestionRejectsPublicContextAndDetailsUrl() public {
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality =
            IConfidentialityEscrow.ConfidentialityConfig({
                gated: true, bondAsset: confidentialityEscrow.BOND_ASSET_LREP(), bondAmount: 0, flags: 0
            });
        ContentRegistry.SubmissionDetails memory privateDetails =
            ContentRegistry.SubmissionDetails({ detailsUrl: "", detailsHash: keccak256("private-details") });
        ContentRegistry.SubmissionDetails memory publicDetails = ContentRegistry.SubmissionDetails({
            detailsUrl: "https://example.com/private-details", detailsHash: keccak256("private-details")
        });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _defaultSubmissionRewardTerms(registry);
        RoundLib.RoundConfig memory roundConfig = _defaultQuestionRoundConfig(registry);
        ContentRegistry.QuestionSpecCommitment memory spec = _defaultQuestionSpec();
        string[] memory imageUrls = _emptyImageUrls();

        vm.expectRevert("Gated public refs");
        vm.prank(submitter);
        registry.submitQuestionWithRewardAndRoundConfig(
            "https://example.com/private-context",
            imageUrls,
            "",
            "Private question public context",
            "private",
            1,
            privateDetails,
            keccak256("private-context-salt"),
            rewardTerms,
            roundConfig,
            spec,
            confidentiality
        );

        vm.expectRevert("Gated public refs");
        vm.prank(submitter);
        registry.submitQuestionWithRewardAndRoundConfig(
            "",
            imageUrls,
            "",
            "Private question public details",
            "private",
            1,
            publicDetails,
            keccak256("private-details-salt"),
            rewardTerms,
            roundConfig,
            spec,
            confidentiality
        );
    }

    function testGatedQuestionRequiresPrivateDetailsHash() public {
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality =
            IConfidentialityEscrow.ConfidentialityConfig({
                gated: true, bondAsset: confidentialityEscrow.BOND_ASSET_LREP(), bondAmount: 0, flags: 0
            });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _defaultSubmissionRewardTerms(registry);
        RoundLib.RoundConfig memory roundConfig = _defaultQuestionRoundConfig(registry);
        ContentRegistry.QuestionSpecCommitment memory spec = _defaultQuestionSpec();
        string[] memory imageUrls = _emptyImageUrls();

        vm.expectRevert("Gated details hash required");
        vm.prank(submitter);
        registry.submitQuestionWithRewardAndRoundConfig(
            "",
            imageUrls,
            "",
            "Private question missing hash",
            "private",
            1,
            _emptySubmissionDetails(),
            keccak256("missing-private-details-hash"),
            rewardTerms,
            roundConfig,
            spec,
            confidentiality
        );
    }

    function testBanDerivesKeysAndBlocksGatedCommitButNotRelease() public {
        uint256 contentId = _submitGatedQuestion("ban", 1e6);
        bytes32 identityKey = _postLrepBond(contentId, voter1);

        vm.prank(owner);
        raterRegistry.banIdentity(
            RaterRegistry.HumanCredentialProvider.SeededHuman,
            VOTER1_ANCHOR,
            uint64(block.timestamp + 365 days),
            "verified leak",
            EVIDENCE_HASH
        );

        bytes32 credentialKey =
            raterRegistry.credentialIdentityKey(RaterRegistry.HumanCredentialProvider.SeededHuman, VOTER1_ANCHOR);
        bytes32 launchKey =
            raterRegistry.launchHumanIdentityKey(RaterRegistry.HumanCredentialProvider.SeededHuman, VOTER1_ANCHOR);
        assertTrue(raterRegistry.isIdentityKeyBanned(identityKey));
        assertTrue(raterRegistry.isIdentityKeyBanned(credentialKey));
        assertTrue(raterRegistry.isIdentityKeyBanned(launchKey));
        assertTrue(raterRegistry.isIdentityKeyBanned(raterRegistry.addressIdentityKey(voter1)));

        uint256 secondContentId = _submitGatedQuestion("ban-commit", 1e6);
        _postLrepBond(secondContentId, voter2);
        _commitVote(voter2, secondContentId, true);
        _expectCommitVoteRevert(voter1, secondContentId, true, VotePreflightLib.IdentityBanned.selector);

        vm.prank(submitter);
        registry.cancelContent(contentId);
        vm.warp(block.timestamp + confidentialityEscrow.evidenceWindow());
        confidentialityEscrow.releaseBond(contentId, identityKey);
    }

    function testBannedDelegateCannotPostBondForUnbannedHolder() public {
        uint256 contentId = _submitGatedQuestion("delegate-ban-bond", 1e6);

        vm.startPrank(owner);
        _seedRaterIdentity(raterRegistry, delegate, DELEGATE_ANCHOR);
        raterRegistry.revokeHumanCredential(delegate);
        lrepToken.mint(delegate, 10_000e6);
        vm.stopPrank();

        vm.prank(voter1);
        raterRegistry.setDelegate(delegate);
        vm.prank(delegate);
        raterRegistry.acceptDelegate();

        IRaterIdentityRegistry.ResolvedRater memory resolved = raterRegistry.resolveRater(delegate);
        assertTrue(resolved.delegated);
        assertEq(resolved.holder, voter1);
        assertTrue(resolved.hasActiveHumanCredential);

        vm.prank(owner);
        raterRegistry.banKnownCredentialNullifier(
            RaterRegistry.HumanCredentialProvider.SeededHuman,
            DELEGATE_ANCHOR,
            uint64(block.timestamp + 365 days),
            "delegate leak",
            EVIDENCE_HASH
        );

        assertTrue(raterRegistry.isIdentityKeyBanned(raterRegistry.addressIdentityKey(delegate)));
        assertFalse(raterRegistry.isIdentityKeyBanned(resolved.identityKey));

        vm.startPrank(delegate);
        lrepToken.approve(address(confidentialityEscrow), 1_000e6);
        vm.expectRevert("Identity banned");
        confidentialityEscrow.postBond(contentId);
        vm.stopPrank();
    }

    function testAdvisoryVotesRejectedOnGatedContent() public {
        _submitGatedQuestion("advisory-padding", 0);
        uint256 contentId = _submitGatedQuestion("advisory", 0);
        _commitVote(voter1, contentId, true);
        uint256 roundId = engine.currentRoundId(contentId);
        assertNotEq(contentId, roundId);
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(engine), voter2, true, keccak256("advisory"), contentId);

        vm.prank(owner);
        vm.expectRevert(ProtocolConfig.InvalidConfig.selector);
        protocolConfig.setConfidentialityEscrow(address(0));

        vm.expectRevert(AdvisoryVoteRecorder.ConfidentialityGated.selector);
        vm.prank(voter2);
        advisoryRecorder.recordAdvisoryVote(
            contentId,
            (roundId << 16) | artifacts.roundReferenceRatingBps,
            artifacts.targetRound,
            DEFAULT_DRAND_CHAIN_HASH,
            artifacts.commitHash,
            artifacts.ciphertext
        );
    }

    function testUnbondedOpenRoundCannotRelockReleasableBond() public {
        uint256 contentId = _submitGatedQuestion("release-grief", 1e6);
        bytes32 identityKey = _postLrepBond(contentId, voter1);

        vm.prank(voter1);
        engine.openRound(contentId);
        uint256 roundId = engine.currentRoundId(contentId);

        vm.warp(block.timestamp + 30 days);
        engine.cancelExpiredRound(contentId, roundId);

        vm.expectRevert(VotePreflightLib.ConfidentialityBondRequired.selector);
        vm.prank(voter2);
        engine.openRound(contentId);

        uint256 beforeBalance = lrepToken.balanceOf(voter1);
        confidentialityEscrow.releaseBond(contentId, identityKey);
        assertEq(lrepToken.balanceOf(voter1), beforeBalance + 1e6);
        assertFalse(confidentialityEscrow.hasActiveBond(contentId, identityKey));
    }

    function testBondedEmptyOpenRoundCannotRelockReleasableBond() public {
        uint256 contentId = _submitGatedQuestion("bonded-release-grief", 1e6);
        bytes32 identityKey = _postLrepBond(contentId, voter1);

        vm.prank(voter1);
        engine.openRound(contentId);
        uint256 firstRoundId = engine.currentRoundId(contentId);

        vm.warp(block.timestamp + 30 days);
        engine.cancelExpiredRound(contentId, firstRoundId);

        _postLrepBond(contentId, voter2);
        vm.prank(voter2);
        engine.openRound(contentId);

        uint256 beforeBalance = lrepToken.balanceOf(voter1);
        confidentialityEscrow.releaseBond(contentId, identityKey);
        assertEq(lrepToken.balanceOf(voter1), beforeBalance + 1e6);
        assertFalse(confidentialityEscrow.hasActiveBond(contentId, identityKey));
    }

    function _submitGatedQuestion(string memory label, uint64 bondAmount) internal returns (uint256 contentId) {
        return _submitGatedQuestionWithAsset(label, confidentialityEscrow.BOND_ASSET_LREP(), bondAmount);
    }

    function _submitPrivateForeverGatedQuestion(string memory label, uint64 bondAmount)
        internal
        returns (uint256 contentId)
    {
        return _submitGatedQuestionWithAssetAndFlags(
            label,
            confidentialityEscrow.BOND_ASSET_LREP(),
            bondAmount,
            confidentialityEscrow.CONFIDENTIALITY_FLAG_PRIVATE_FOREVER()
        );
    }

    function _ungatedFlaggedQuestionSubmission() internal view returns (FlaggedQuestionSubmission memory submission) {
        submission.contextUrl = "https://example.com/ungated-flags";
        submission.title = "Public question";
        submission.tags = "public";
        submission.salt = keccak256("ungated-confidentiality-flags");
        submission.details = ContentRegistry.SubmissionDetails({ detailsUrl: "", detailsHash: bytes32(0) });
        submission.rewardTerms = _defaultSubmissionRewardTerms(registry);
        submission.roundConfig = _defaultQuestionRoundConfig(registry);
        submission.spec = _defaultQuestionSpec();
        submission.confidentiality = IConfidentialityEscrow.ConfidentialityConfig({
            gated: false, bondAsset: confidentialityEscrow.BOND_ASSET_LREP(), bondAmount: 0, flags: 1
        });
    }

    function _reserveFlaggedQuestionSubmission(FlaggedQuestionSubmission memory submission) internal {
        bytes32 submissionKey = _questionSubmissionKey(
            submission.contextUrl, _emptyImageUrls(), "", submission.title, submission.tags, 1, submission.details
        );
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            keccak256(abi.encode(_emptyImageUrls(), "")),
            submission.title,
            submission.tags,
            submission.details,
            1,
            submission.salt,
            submitter,
            submission.rewardTerms,
            submission.roundConfig,
            submission.spec,
            _hashConfidentiality(submission.confidentiality)
        );

        vm.startPrank(submitter);
        lrepToken.approve(registry.questionRewardPoolEscrow(), submission.rewardTerms.amount);
        registry.reserveSubmission(revealCommitment);
        vm.warp(block.timestamp + 1);
        vm.stopPrank();
    }

    function _submitGatedQuestionWithAsset(string memory label, uint8 bondAsset, uint64 bondAmount)
        internal
        returns (uint256 contentId)
    {
        return _submitGatedQuestionWithAssetAndFlags(label, bondAsset, bondAmount, 0);
    }

    function _submitGatedQuestionWithAssetAndFlags(string memory label, uint8 bondAsset, uint64 bondAmount, uint8 flags)
        internal
        returns (uint256 contentId)
    {
        string memory contextUrl = "";
        string memory title = string.concat("Private question ", label);
        ContentRegistry.SubmissionDetails memory details = ContentRegistry.SubmissionDetails({
            detailsUrl: "", detailsHash: keccak256(abi.encodePacked("private-details", label))
        });
        bytes32 salt = keccak256(abi.encodePacked(label, block.timestamp, block.number));
        IConfidentialityEscrow.ConfidentialityConfig memory confidentiality =
            IConfidentialityEscrow.ConfidentialityConfig({
                gated: true, bondAsset: bondAsset, bondAmount: bondAmount, flags: flags
            });
        ContentRegistry.SubmissionRewardTerms memory rewardTerms = _defaultSubmissionRewardTerms(registry);
        RoundLib.RoundConfig memory roundConfig = _defaultQuestionRoundConfig(registry);
        bytes32 submissionKey = _questionSubmissionKey(contextUrl, _emptyImageUrls(), "", title, "private", 1, details);
        bytes32 revealCommitment = _questionRevealCommitment(
            submissionKey,
            keccak256(abi.encode(_emptyImageUrls(), "")),
            title,
            "private",
            details,
            1,
            salt,
            submitter,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec(),
            _hashConfidentiality(confidentiality)
        );
        vm.startPrank(submitter);
        lrepToken.approve(registry.questionRewardPoolEscrow(), rewardTerms.amount);
        registry.reserveSubmission(revealCommitment);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
        vm.prank(submitter);
        contentId = registry.submitQuestionWithRewardAndRoundConfig(
            contextUrl,
            _emptyImageUrls(),
            "",
            title,
            "private",
            1,
            details,
            salt,
            rewardTerms,
            roundConfig,
            _defaultQuestionSpec(),
            confidentiality
        );
    }

    function _bondAuthorization(address from, uint256 signerKey, uint256 value)
        internal
        view
        returns (Eip3009Authorization memory authorization)
    {
        authorization = Eip3009Authorization({
            from: from,
            to: address(confidentialityEscrow),
            value: value,
            validAfter: block.timestamp - 1,
            validBefore: block.timestamp + 1 days,
            nonce: keccak256(abi.encodePacked("confidentiality-bond", from, value, block.timestamp)),
            v: 0,
            r: bytes32(0),
            s: bytes32(0)
        });
        (authorization.v, authorization.r, authorization.s) = vm.sign(
            signerKey,
            usdcToken.receiveWithAuthorizationDigest(
                authorization.from,
                authorization.to,
                authorization.value,
                authorization.validAfter,
                authorization.validBefore,
                authorization.nonce
            )
        );
    }

    function _hashConfidentiality(IConfidentialityEscrow.ConfidentialityConfig memory confidentiality)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                confidentiality.gated, confidentiality.bondAsset, confidentiality.bondAmount, confidentiality.flags
            )
        );
    }

    function _postLrepBond(uint256 contentId, address voter) internal returns (bytes32 identityKey) {
        vm.startPrank(voter);
        lrepToken.approve(address(confidentialityEscrow), 1_000e6);
        identityKey = confidentialityEscrow.postBond(contentId);
        vm.stopPrank();
    }

    function _deployReplacementVotingEngine() internal returns (RoundVotingEngine replacementEngine) {
        replacementEngine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(new RoundVotingEngine()),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(protocolConfig))
                    )
                )
            )
        );
    }

    function _rotateRegistryVotingEngine(RoundVotingEngine replacementEngine) internal {
        vm.startPrank(owner);
        registry.pause();
        registry.setVotingEngine(address(replacementEngine));
        registry.unpause();
        vm.stopPrank();
    }

    function _commitVote(address voter, uint256 contentId, bool isUp) internal returns (bytes32 commitKey) {
        return _commitTestVote(
            DirectTestCommitRequest({
                engine: engine,
                lrepToken: lrepToken,
                voter: voter,
                contentId: contentId,
                isUp: isUp,
                stake: STAKE,
                frontend: address(0),
                salt: keccak256(abi.encodePacked("confidentiality-commit", voter, contentId, isUp, block.timestamp))
            })
        );
    }

    function _commitVoteWithoutOpeningRound(address voter, uint256 contentId, bool isUp)
        internal
        returns (bytes32 commitKey)
    {
        bytes32 salt = keccak256(
            abi.encodePacked("confidentiality-current-round", voter, contentId, isUp, block.timestamp)
        );
        TestCommitArtifacts memory artifacts = _buildTestCommitArtifacts(address(engine), voter, isUp, salt, contentId);
        uint256 currentRoundId = engine.currentRoundId(contentId);
        assertGt(currentRoundId, 0);
        if (currentRoundId != artifacts.roundId) {
            artifacts.roundId = currentRoundId;
            uint16 roundReferenceRatingBps = _roundReferenceRatingBpsForRound(engine, contentId, currentRoundId);
            if (roundReferenceRatingBps != 0) {
                artifacts.roundReferenceRatingBps = roundReferenceRatingBps;
            }
            artifacts.commitHash = _commitHash(
                isUp,
                salt,
                voter,
                contentId,
                artifacts.roundId,
                artifacts.roundReferenceRatingBps,
                artifacts.targetRound,
                artifacts.drandChainHash,
                artifacts.ciphertext
            );
            artifacts.commitKey = _commitKey(voter, artifacts.commitHash);
        }

        vm.startPrank(voter);
        lrepToken.approve(address(engine), STAKE);
        engine.commitVote(
            contentId,
            _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();

        _rememberTestReveal(artifacts.commitKey, isUp, salt);
        return artifacts.commitKey;
    }

    function _expectCommitVoteRevert(address voter, uint256 contentId, bool isUp, bytes4 selector) internal {
        bytes32 salt = keccak256(abi.encodePacked("confidentiality-revert", voter, contentId, isUp, block.timestamp));
        TestCommitArtifacts memory artifacts = _buildTestCommitArtifacts(address(engine), voter, isUp, salt, contentId);
        uint256 currentRoundId = engine.currentRoundId(contentId);
        if (currentRoundId != 0 && currentRoundId != artifacts.roundId) {
            artifacts.roundId = currentRoundId;
            uint16 roundReferenceRatingBps = _roundReferenceRatingBpsForRound(engine, contentId, currentRoundId);
            if (roundReferenceRatingBps != 0) {
                artifacts.roundReferenceRatingBps = roundReferenceRatingBps;
            }
            artifacts.commitHash = _commitHash(
                isUp,
                salt,
                voter,
                contentId,
                artifacts.roundId,
                artifacts.roundReferenceRatingBps,
                artifacts.targetRound,
                artifacts.drandChainHash,
                artifacts.ciphertext
            );
        }

        vm.startPrank(voter);
        lrepToken.approve(address(engine), STAKE);
        vm.expectRevert(selector);
        engine.commitVote(
            contentId,
            _roundContext(artifacts.roundId, artifacts.roundReferenceRatingBps),
            artifacts.targetRound,
            artifacts.drandChainHash,
            artifacts.commitHash,
            artifacts.ciphertext,
            STAKE,
            address(0)
        );
        vm.stopPrank();
    }
}
