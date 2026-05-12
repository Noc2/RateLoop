// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {RaterRegistry} from "../contracts/RaterRegistry.sol";
import {MockWorldIDRouter} from "../contracts/mocks/MockWorldIDRouter.sol";

contract RaterRegistryTest is Test {
    RaterRegistry internal registry;
    MockWorldIDRouter internal worldIdRouter;

    address internal admin = address(0xA11CE);
    address internal governance = address(0xB0B);
    address internal rater = address(0x1234);
    address internal otherRater = address(0x5678);
    address internal subject = address(0x9999);

    bytes32 internal constant METADATA_HASH = keccak256("metadata");
    bytes32 internal constant NULLIFIER_HASH = keccak256("self-nullifier");
    bytes32 internal constant SELF_SCOPE = keccak256("rateloop-human-v1");
    bytes32 internal constant EVIDENCE_HASH = keccak256("evidence");
    bytes32 internal constant ALGORITHM_HASH = keccak256("cluster-algorithm-v1");
    bytes32 internal constant MODEL_VERSION_HASH = keccak256("cluster-model-v1.0.0");
    bytes32 internal constant SCORE_ROOT = keccak256("cluster-score-root");
    bytes32 internal constant RESOLUTION_HASH = keccak256("cluster-challenge-resolution");
    bytes32 internal constant SEED_ROOT = keccak256("legacy-seed-root");
    uint256 internal constant WORLD_ID_EXTERNAL_NULLIFIER_HASH = 12_345;
    uint64 internal constant WORLD_ID_CREDENTIAL_TTL = 365 days;

    event ProfileFollowed(address indexed follower, address indexed target, uint64 followedAt);
    event ProfileUnfollowed(address indexed follower, address indexed target, uint64 unfollowedAt);

    function setUp() public {
        worldIdRouter = new MockWorldIDRouter();
        registry = new RaterRegistry(
            admin,
            governance,
            address(worldIdRouter),
            SELF_SCOPE,
            WORLD_ID_EXTERNAL_NULLIFIER_HASH,
            WORLD_ID_CREDENTIAL_TTL
        );
    }

    function test_ConstructorGrantsGovernanceAndAdminRoles() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(registry.hasRole(registry.ADMIN_ROLE(), governance));
        assertTrue(registry.hasRole(registry.SEEDER_ROLE(), governance));
        assertTrue(registry.hasRole(registry.SCORER_ROLE(), governance));
        assertTrue(registry.hasRole(registry.CLUSTER_CHALLENGE_RESOLVER_ROLE(), governance));

        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.SEEDER_ROLE(), admin));
        assertTrue(registry.hasRole(registry.SCORER_ROLE(), admin));
        assertTrue(registry.hasRole(registry.CLUSTER_CHALLENGE_RESOLVER_ROLE(), admin));
    }

    function test_SetProfileStoresSelfReportedRaterType() public {
        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.AI, METADATA_HASH);

        RaterRegistry.RaterProfile memory profile = registry.getProfile(rater);
        assertEq(uint256(profile.raterType), uint256(RaterRegistry.RaterType.AI));
        assertEq(profile.metadataHash, METADATA_HASH);
        assertEq(profile.updatedAt, uint64(block.timestamp));
    }

    function test_FollowProfileStoresPublicRelationshipAndCounts() public {
        vm.prank(rater);
        vm.expectEmit(true, true, false, true);
        emit ProfileFollowed(rater, subject, uint64(block.timestamp));
        registry.followProfile(subject);

        assertTrue(registry.isFollowing(rater, subject));
        assertEq(registry.followingCount(rater), 1);
        assertEq(registry.followerCount(subject), 1);

        vm.prank(rater);
        registry.followProfile(subject);

        assertEq(registry.followingCount(rater), 1);
        assertEq(registry.followerCount(subject), 1);
    }

    function test_UnfollowProfileClearsPublicRelationshipAndCounts() public {
        vm.prank(rater);
        registry.followProfile(subject);

        vm.prank(rater);
        vm.expectEmit(true, true, false, true);
        emit ProfileUnfollowed(rater, subject, uint64(block.timestamp));
        registry.unfollowProfile(subject);

        assertFalse(registry.isFollowing(rater, subject));
        assertEq(registry.followingCount(rater), 0);
        assertEq(registry.followerCount(subject), 0);

        vm.prank(rater);
        registry.unfollowProfile(subject);

        assertEq(registry.followingCount(rater), 0);
        assertEq(registry.followerCount(subject), 0);
    }

    function test_FollowProfileRejectsInvalidTargets() public {
        vm.startPrank(rater);

        vm.expectRevert(RaterRegistry.InvalidAddress.selector);
        registry.followProfile(address(0));

        vm.expectRevert(RaterRegistry.InvalidAddress.selector);
        registry.followProfile(rater);

        vm.expectRevert(RaterRegistry.InvalidAddress.selector);
        registry.unfollowProfile(address(0));

        vm.expectRevert(RaterRegistry.InvalidAddress.selector);
        registry.unfollowProfile(rater);

        vm.stopPrank();
    }

    function test_AttestSelfCredentialWithProofStoresUniquenessCredentialForSender() public {
        uint256[8] memory proof;
        uint256 nullifierHash = uint256(NULLIFIER_HASH);

        vm.prank(rater);
        registry.attestSelfCredentialWithProof(1, nullifierHash, proof);

        RaterRegistry.SelfCredential memory credential = registry.getSelfCredential(rater);
        assertTrue(credential.verified);
        assertFalse(credential.legacy);
        assertFalse(credential.revoked);
        assertEq(credential.nullifierHash, NULLIFIER_HASH);
        assertEq(credential.scope, SELF_SCOPE);
        assertEq(credential.verifiedAt, uint64(block.timestamp));
        assertEq(credential.expiresAt, uint64(block.timestamp + WORLD_ID_CREDENTIAL_TTL));
        assertEq(credential.multiplierBps, registry.WORLD_ID_MULTIPLIER_BPS());
        assertTrue(credential.evidenceHash != bytes32(0));
        assertEq(registry.selfNullifierOwner(NULLIFIER_HASH), rater);
        assertTrue(registry.hasActiveSelfCredential(rater));
        assertEq(registry.credentialMultiplierBps(rater), registry.BASE_MULTIPLIER_BPS());
    }

    function test_AttestSelfCredentialWithProofUsesMsgSenderSignal() public {
        uint256[8] memory proof;
        uint256 expectedSignalHash = registry.worldIdSignalHash(rater);

        assertEq(expectedSignalHash, registry.hashToField(abi.encodePacked(rater)));
        worldIdRouter.setExpectedSignalHash(expectedSignalHash);
        worldIdRouter.setExpectedExternalNullifierHash(WORLD_ID_EXTERNAL_NULLIFIER_HASH);

        vm.prank(rater);
        registry.attestSelfCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
    }

    function test_AttestSelfCredentialWithProofRejectsReusedNullifier() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.attestSelfCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        registry.attestSelfCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
    }

    function test_AttestSelfCredentialWithProofRejectsIdentitySwitchWhileActive() public {
        uint256[8] memory proof;

        vm.startPrank(rater);
        registry.attestSelfCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestSelfCredentialWithProof(1, uint256(keccak256("other-nullifier")), proof);
        vm.stopPrank();
    }

    function test_AttestSelfCredentialWithProofBubblesInvalidProof() public {
        uint256[8] memory proof;
        worldIdRouter.setShouldReject(true);

        vm.prank(rater);
        vm.expectRevert(MockWorldIDRouter.InvalidMockWorldIdProof.selector);
        registry.attestSelfCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
    }

    function test_RevokeSelfCredentialClearsNullifierOwner() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.attestSelfCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(admin);
        registry.revokeSelfCredential(rater);

        RaterRegistry.SelfCredential memory credential = registry.getSelfCredential(rater);
        assertTrue(credential.revoked);
        assertFalse(registry.hasActiveSelfCredential(rater));
        assertEq(registry.credentialMultiplierBps(rater), registry.BASE_MULTIPLIER_BPS());
        assertEq(registry.selfNullifierOwner(NULLIFIER_HASH), address(0));
    }

    function test_SeedLegacySelfCredentialSetsSunsetCredentialAndTrustSeed() public {
        uint64 sunsetAt = uint64(block.timestamp + 180 days);

        vm.prank(admin);
        registry.seedLegacySelfCredential(rater, sunsetAt, 10_750, 2_500, SEED_ROOT, EVIDENCE_HASH);

        RaterRegistry.SelfCredential memory credential = registry.getSelfCredential(rater);
        assertTrue(credential.verified);
        assertTrue(credential.legacy);
        assertEq(credential.expiresAt, sunsetAt);
        assertEq(credential.multiplierBps, 10_750);

        RaterRegistry.TrustSeed memory seed = registry.getTrustSeed(rater);
        assertTrue(seed.active);
        assertEq(seed.seededAt, uint64(block.timestamp));
        assertEq(seed.sunsetAt, sunsetAt);
        assertEq(seed.trustBudgetBps, 2_500);
        assertEq(seed.seedRoot, SEED_ROOT);
        assertTrue(registry.hasActiveTrustSeed(rater));
    }

    function test_SeedLegacySelfCredentialExpiresSeedTrust() public {
        uint64 sunsetAt = uint64(block.timestamp + 7 days);

        vm.prank(admin);
        registry.seedLegacySelfCredential(rater, sunsetAt, 10_500, 1_000, SEED_ROOT, EVIDENCE_HASH);

        vm.warp(sunsetAt + 1);

        assertFalse(registry.hasActiveSelfCredential(rater));
        assertFalse(registry.hasActiveTrustSeed(rater));
        assertEq(registry.credentialMultiplierBps(rater), registry.BASE_MULTIPLIER_BPS());
    }

    function test_SetClusterScoreStoresScorerVersionedDiscount() public {
        bytes32 clusterId = keccak256("cluster-a");

        vm.prank(admin);
        registry.setClusterScore(rater, clusterId, 7_500, 42);

        RaterRegistry.ClusterScore memory cluster = registry.getClusterScore(rater);
        assertEq(cluster.clusterId, clusterId);
        assertEq(cluster.discountBps, 7_500);
        assertEq(cluster.scorerEpoch, 42);
        assertEq(cluster.updatedAt, uint64(block.timestamp));
    }

    function test_PublishClusterScoreStoresVersionedCurrentAndHistory() public {
        bytes32 clusterId = keccak256("cluster-a");
        uint64 challengeWindowEndsAt = uint64(block.timestamp + 2 days);
        RaterRegistry.ClusterScoreMetadata memory metadata = RaterRegistry.ClusterScoreMetadata({
            algorithmHash: ALGORITHM_HASH,
            modelVersionHash: MODEL_VERSION_HASH,
            scoreRoot: SCORE_ROOT,
            evidenceHash: bytes32(0),
            challengeWindowEndsAt: challengeWindowEndsAt
        });

        vm.prank(admin);
        bytes32 scoreKey = registry.publishClusterScore(rater, clusterId, 7_500, 42, metadata);

        assertEq(scoreKey, registry.clusterScoreKey(rater, 42, ALGORITHM_HASH, MODEL_VERSION_HASH));

        RaterRegistry.ClusterScore memory legacyCluster = registry.getClusterScore(rater);
        assertEq(legacyCluster.clusterId, clusterId);
        assertEq(legacyCluster.discountBps, 7_500);
        assertEq(legacyCluster.scorerEpoch, 42);

        RaterRegistry.VersionedClusterScore memory current = registry.getVersionedClusterScore(rater);
        assertEq(current.clusterId, clusterId);
        assertEq(current.discountBps, 7_500);
        assertEq(current.scorerEpoch, 42);
        assertEq(current.updatedAt, uint64(block.timestamp));
        assertEq(current.algorithmHash, ALGORITHM_HASH);
        assertEq(current.modelVersionHash, MODEL_VERSION_HASH);
        assertEq(current.scoreRoot, SCORE_ROOT);
        assertEq(current.evidenceHash, bytes32(0));
        assertEq(current.challengeWindowEndsAt, challengeWindowEndsAt);
        assertEq(current.scoreKey, scoreKey);

        RaterRegistry.VersionedClusterScore memory historical =
            registry.getClusterScoreAt(rater, 42, ALGORITHM_HASH, MODEL_VERSION_HASH);
        assertEq(historical.scoreKey, scoreKey);
        assertEq(historical.discountBps, 7_500);
    }

    function test_PublishClusterScoreRejectsIncompleteMetadata() public {
        bytes32 clusterId = keccak256("cluster-a");
        RaterRegistry.ClusterScoreMetadata memory metadata = RaterRegistry.ClusterScoreMetadata({
            algorithmHash: ALGORITHM_HASH,
            modelVersionHash: MODEL_VERSION_HASH,
            scoreRoot: bytes32(0),
            evidenceHash: bytes32(0),
            challengeWindowEndsAt: uint64(block.timestamp + 2 days)
        });

        vm.prank(admin);
        vm.expectRevert(RaterRegistry.InvalidClusterScore.selector);
        registry.publishClusterScore(rater, clusterId, 7_500, 42, metadata);

        metadata.scoreRoot = SCORE_ROOT;
        metadata.challengeWindowEndsAt = uint64(block.timestamp);

        vm.prank(admin);
        vm.expectRevert(RaterRegistry.InvalidClusterScore.selector);
        registry.publishClusterScore(rater, clusterId, 7_500, 42, metadata);
    }

    function test_ClusterScoreChallengeIsBondlessAndResolvable() public {
        bytes32 clusterId = keccak256("cluster-a");
        RaterRegistry.ClusterScoreMetadata memory metadata = RaterRegistry.ClusterScoreMetadata({
            algorithmHash: ALGORITHM_HASH,
            modelVersionHash: MODEL_VERSION_HASH,
            scoreRoot: SCORE_ROOT,
            evidenceHash: bytes32(0),
            challengeWindowEndsAt: uint64(block.timestamp + 2 days)
        });

        vm.prank(admin);
        bytes32 scoreKey = registry.publishClusterScore(rater, clusterId, 7_500, 42, metadata);

        vm.prank(otherRater);
        uint256 challengeId =
            registry.openClusterScoreChallenge(rater, 42, ALGORITHM_HASH, MODEL_VERSION_HASH, EVIDENCE_HASH);

        assertEq(challengeId, 1);
        RaterRegistry.ClusterScoreChallenge memory challenge = registry.getClusterScoreChallenge(challengeId);
        assertEq(challenge.challenger, otherRater);
        assertEq(challenge.rater, rater);
        assertEq(challenge.scorerEpoch, 42);
        assertEq(challenge.algorithmHash, ALGORITHM_HASH);
        assertEq(challenge.modelVersionHash, MODEL_VERSION_HASH);
        assertEq(challenge.scoreKey, scoreKey);
        assertEq(challenge.evidenceHash, EVIDENCE_HASH);
        assertEq(challenge.openedAt, uint64(block.timestamp));
        assertEq(uint256(challenge.status), uint256(RaterRegistry.ClusterScoreChallengeStatus.Open));

        vm.prank(admin);
        registry.resolveClusterScoreChallenge(challengeId, true, RESOLUTION_HASH);

        challenge = registry.getClusterScoreChallenge(challengeId);
        assertEq(uint256(challenge.status), uint256(RaterRegistry.ClusterScoreChallengeStatus.Sustained));
        assertEq(challenge.resolutionHash, RESOLUTION_HASH);
        assertEq(challenge.resolvedAt, uint64(block.timestamp));
    }

    function test_ClusterScoreChallengeRequiresOpenWindow() public {
        bytes32 clusterId = keccak256("cluster-a");
        RaterRegistry.ClusterScoreMetadata memory metadata = RaterRegistry.ClusterScoreMetadata({
            algorithmHash: ALGORITHM_HASH,
            modelVersionHash: MODEL_VERSION_HASH,
            scoreRoot: SCORE_ROOT,
            evidenceHash: bytes32(0),
            challengeWindowEndsAt: uint64(block.timestamp + 1)
        });

        vm.prank(admin);
        registry.publishClusterScore(rater, clusterId, 7_500, 42, metadata);

        vm.warp(block.timestamp + 2);

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.InvalidChallenge.selector);
        registry.openClusterScoreChallenge(rater, 42, ALGORITHM_HASH, MODEL_VERSION_HASH, EVIDENCE_HASH);
    }

    function test_TrustAttestationIsBoundedAndRevocable() public {
        uint64 expiresAt = uint64(block.timestamp + 30 days);

        vm.prank(rater);
        bytes32 attestationId = registry.setTrustAttestation(subject, 1, 100e6, 11_500, expiresAt, METADATA_HASH);

        assertEq(attestationId, registry.trustAttestationId(rater, subject, 1));
        RaterRegistry.TrustAttestation memory attestation = registry.getTrustAttestation(attestationId);
        assertEq(attestation.issuer, rater);
        assertEq(attestation.subject, subject);
        assertEq(attestation.categoryId, 1);
        assertEq(attestation.trustBudget, 100e6);
        assertEq(attestation.maxBoostBps, 11_500);
        assertEq(attestation.expiresAt, expiresAt);
        assertEq(attestation.metadataHash, METADATA_HASH);
        assertFalse(attestation.revoked);

        vm.prank(rater);
        registry.revokeTrustAttestation(subject, 1);

        attestation = registry.getTrustAttestation(attestationId);
        assertTrue(attestation.revoked);
    }

    function test_TrustAttestationRejectsInvalidBoosts() public {
        vm.startPrank(rater);

        vm.expectRevert(RaterRegistry.InvalidMultiplier.selector);
        registry.setTrustAttestation(subject, 1, 100e6, 20_000, uint64(block.timestamp + 30 days), METADATA_HASH);

        vm.expectRevert(RaterRegistry.InvalidTrustAttestation.selector);
        registry.setTrustAttestation(rater, 1, 100e6, 11_000, uint64(block.timestamp + 30 days), METADATA_HASH);

        vm.stopPrank();
    }
}
