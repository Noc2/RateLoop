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
    address internal reporter = address(0xE11);
    address internal treasury = address(0xFEE);

    uint256 internal constant STAKE = 5e6;
    bytes32 internal constant VOTER1_ANCHOR = keccak256("voter-1-world-id");
    bytes32 internal constant VOTER2_ANCHOR = keccak256("voter-2-world-id");
    bytes32 internal constant EVIDENCE_HASH = keccak256("confidentiality evidence");

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
        registry.setQuestionRewardPoolEscrow(address(new MockQuestionRewardPoolEscrow()));
        confidentialityEscrow.grantRole(confidentialityEscrow.CONFIG_ROLE(), address(registry));

        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setCategoryRegistry(address(categoryRegistry));
        protocolConfig.setRaterRegistry(address(raterRegistry));
        protocolConfig.setConfidentialityEscrow(address(confidentialityEscrow));
        protocolConfig.setTreasury(treasury);
        _setTlockRoundConfig(protocolConfig, 1 hours, 7 days, 3, 100);

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
        shortEscrow.configure(
            contentId,
            IConfidentialityEscrow.ConfidentialityConfig({
                gated: true, bondAsset: shortEscrow.BOND_ASSET_LREP(), bondAmount: uint64(1e6), flags: 0
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

    function testAdvisoryVotesRejectedOnGatedContent() public {
        _submitGatedQuestion("advisory-padding", 0);
        uint256 contentId = _submitGatedQuestion("advisory", 0);
        _commitVote(voter1, contentId, true);
        uint256 roundId = engine.currentRoundId(contentId);
        assertNotEq(contentId, roundId);
        TestCommitArtifacts memory artifacts =
            _buildTestCommitArtifacts(address(engine), voter2, true, keccak256("advisory"), contentId);

        vm.prank(owner);
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

    function _submitGatedQuestion(string memory label, uint64 bondAmount) internal returns (uint256 contentId) {
        return _submitGatedQuestionWithAsset(label, confidentialityEscrow.BOND_ASSET_LREP(), bondAmount);
    }

    function _submitGatedQuestionWithAsset(string memory label, uint8 bondAsset, uint64 bondAmount)
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
                gated: true, bondAsset: bondAsset, bondAmount: bondAmount, flags: 0
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
