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
    bytes32 internal constant HUMAN_SCOPE = keccak256("rateloop-human-v1");
    bytes32 internal constant EVIDENCE_HASH = keccak256("evidence");
    bytes32 internal constant CURYO_ANCHOR_ID = keccak256("curyo-self-verified-anchor");
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
            HUMAN_SCOPE,
            WORLD_ID_EXTERNAL_NULLIFIER_HASH,
            WORLD_ID_CREDENTIAL_TTL
        );
    }

    function test_ConstructorGrantsGovernanceAndAdminRoles() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(registry.hasRole(registry.ADMIN_ROLE(), governance));
        assertTrue(registry.hasRole(registry.SEEDER_ROLE(), governance));

        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.SEEDER_ROLE(), admin));
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

    function test_AttestHumanCredentialWithProofStoresUniquenessCredentialForSender() public {
        uint256[8] memory proof;
        uint256 nullifierHash = uint256(NULLIFIER_HASH);

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, nullifierHash, proof);

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertTrue(credential.verified);
        assertFalse(credential.revoked);
        assertEq(uint256(credential.provider), uint256(RaterRegistry.HumanCredentialProvider.WorldId));
        assertEq(credential.nullifierHash, NULLIFIER_HASH);
        assertEq(credential.scope, HUMAN_SCOPE);
        assertEq(credential.verifiedAt, uint64(block.timestamp));
        assertEq(credential.expiresAt, uint64(block.timestamp + WORLD_ID_CREDENTIAL_TTL));
        assertTrue(credential.evidenceHash != bytes32(0));
        assertEq(registry.humanNullifierOwner(NULLIFIER_HASH), rater);
        assertTrue(registry.hasActiveHumanCredential(rater));
    }

    function test_AttestHumanCredentialWithProofUsesMsgSenderSignal() public {
        uint256[8] memory proof;
        uint256 expectedSignalHash = registry.worldIdSignalHash(rater);

        assertEq(expectedSignalHash, registry.hashToField(abi.encodePacked(rater)));
        worldIdRouter.setExpectedSignalHash(expectedSignalHash);
        worldIdRouter.setExpectedExternalNullifierHash(WORLD_ID_EXTERNAL_NULLIFIER_HASH);

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
    }

    function test_AttestHumanCredentialWithProofRejectsReusedNullifier() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
    }

    function test_AttestHumanCredentialWithProofRejectsIdentitySwitchWhileActive() public {
        uint256[8] memory proof;

        vm.startPrank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestHumanCredentialWithProof(1, uint256(keccak256("other-nullifier")), proof);
        vm.stopPrank();
    }

    function test_AttestHumanCredentialWithProofBubblesInvalidProof() public {
        uint256[8] memory proof;
        worldIdRouter.setShouldReject(true);

        vm.prank(rater);
        vm.expectRevert(MockWorldIDRouter.InvalidMockWorldIdProof.selector);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
    }

    function test_RevokeHumanCredentialClearsNullifierOwner() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(admin);
        registry.revokeHumanCredential(rater);

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertTrue(credential.revoked);
        assertFalse(registry.hasActiveHumanCredential(rater));
        assertEq(registry.humanNullifierOwner(NULLIFIER_HASH), address(0));
    }

    function test_SeedHumanCredentialStoresCuryoSelfVerifiedAccountAsVerifiedHuman() public {
        uint64 expiresAt = uint64(block.timestamp + 180 days);

        vm.prank(admin);
        registry.seedHumanCredential(rater, expiresAt, CURYO_ANCHOR_ID, EVIDENCE_HASH);

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertTrue(credential.verified);
        assertFalse(credential.revoked);
        assertEq(uint256(credential.provider), uint256(RaterRegistry.HumanCredentialProvider.CuryoSelfVerifiedSeed));
        assertEq(credential.nullifierHash, CURYO_ANCHOR_ID);
        assertEq(credential.scope, registry.CURYO_SELF_VERIFIED_SCOPE());
        assertEq(credential.expiresAt, expiresAt);
        assertEq(credential.evidenceHash, EVIDENCE_HASH);
        assertEq(registry.humanNullifierOwner(CURYO_ANCHOR_ID), rater);
        assertTrue(registry.hasActiveHumanCredential(rater));
    }

    function test_SetTrustSeedIsSeparateFromHumanCredentialSeeding() public {
        uint64 sunsetAt = uint64(block.timestamp + 180 days);

        vm.prank(admin);
        registry.setTrustSeed(rater, sunsetAt, SEED_ROOT);

        RaterRegistry.TrustSeed memory seed = registry.getTrustSeed(rater);
        assertTrue(seed.active);
        assertEq(seed.seededAt, uint64(block.timestamp));
        assertEq(seed.sunsetAt, sunsetAt);
        assertEq(seed.seedRoot, SEED_ROOT);
        assertTrue(registry.hasActiveTrustSeed(rater));
    }

    function test_SeedHumanCredentialExpiresLikeWorldIdHumanUnit() public {
        uint64 expiresAt = uint64(block.timestamp + 7 days);

        vm.prank(admin);
        registry.seedHumanCredential(rater, expiresAt, CURYO_ANCHOR_ID, EVIDENCE_HASH);

        vm.warp(expiresAt + 1);

        assertFalse(registry.hasActiveHumanCredential(rater));
    }

    function test_TrustAttestationIsRevocable() public {
        uint64 expiresAt = uint64(block.timestamp + 30 days);

        vm.prank(rater);
        bytes32 attestationId = registry.setTrustAttestation(subject, 1, 11_500, expiresAt, METADATA_HASH);

        assertEq(attestationId, registry.trustAttestationId(rater, subject, 1));
        RaterRegistry.TrustAttestation memory attestation = registry.getTrustAttestation(attestationId);
        assertEq(attestation.issuer, rater);
        assertEq(attestation.subject, subject);
        assertEq(attestation.categoryId, 1);
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
        registry.setTrustAttestation(subject, 1, 20_000, uint64(block.timestamp + 30 days), METADATA_HASH);

        vm.expectRevert(RaterRegistry.InvalidTrustAttestation.selector);
        registry.setTrustAttestation(rater, 1, 11_000, uint64(block.timestamp + 30 days), METADATA_HASH);

        vm.stopPrank();
    }
}
