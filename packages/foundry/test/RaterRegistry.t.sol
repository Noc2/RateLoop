// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";

contract RaterRegistryTest is Test {
    RaterRegistry internal registry;

    address internal admin = address(0xA11CE);
    address internal governance = address(0xB0B);
    address internal rater = address(0x1234);
    address internal otherRater = address(0x5678);
    address internal subject = address(0x9999);

    bytes32 internal constant METADATA_HASH = keccak256("metadata");
    bytes32 internal constant NULLIFIER_HASH = keccak256("self-nullifier");
    bytes32 internal constant SELF_SCOPE = keccak256("curyo-human-v1");
    bytes32 internal constant EVIDENCE_HASH = keccak256("evidence");
    bytes32 internal constant SEED_ROOT = keccak256("legacy-seed-root");

    function setUp() public {
        registry = new RaterRegistry(admin, governance);
    }

    function test_ConstructorGrantsGovernanceAndAdminRoles() public view {
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(registry.hasRole(registry.ADMIN_ROLE(), governance));
        assertTrue(registry.hasRole(registry.SELF_ATTESTOR_ROLE(), governance));
        assertTrue(registry.hasRole(registry.SEEDER_ROLE(), governance));
        assertTrue(registry.hasRole(registry.SCORER_ROLE(), governance));

        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.SELF_ATTESTOR_ROLE(), admin));
        assertTrue(registry.hasRole(registry.SEEDER_ROLE(), admin));
        assertTrue(registry.hasRole(registry.SCORER_ROLE(), admin));
    }

    function test_SetProfileStoresSelfReportedRaterType() public {
        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.AI, METADATA_HASH);

        RaterRegistry.RaterProfile memory profile = registry.getProfile(rater);
        assertEq(uint256(profile.raterType), uint256(RaterRegistry.RaterType.AI));
        assertEq(profile.metadataHash, METADATA_HASH);
        assertEq(profile.updatedAt, uint64(block.timestamp));
    }

    function test_AttestSelfCredentialStoresUniquenessCredential() public {
        uint64 expiresAt = uint64(block.timestamp + 90 days);

        vm.prank(admin);
        registry.attestSelfCredential(rater, NULLIFIER_HASH, SELF_SCOPE, expiresAt, 11_000, EVIDENCE_HASH);

        RaterRegistry.SelfCredential memory credential = registry.getSelfCredential(rater);
        assertTrue(credential.verified);
        assertFalse(credential.legacy);
        assertFalse(credential.revoked);
        assertEq(credential.nullifierHash, NULLIFIER_HASH);
        assertEq(credential.scope, SELF_SCOPE);
        assertEq(credential.verifiedAt, uint64(block.timestamp));
        assertEq(credential.expiresAt, expiresAt);
        assertEq(credential.multiplierBps, 11_000);
        assertEq(credential.evidenceHash, EVIDENCE_HASH);
        assertEq(registry.selfNullifierOwner(NULLIFIER_HASH), rater);
        assertTrue(registry.hasActiveSelfCredential(rater));
        assertEq(registry.credentialMultiplierBps(rater), 11_000);
    }

    function test_AttestSelfCredentialRejectsReusedNullifier() public {
        uint64 expiresAt = uint64(block.timestamp + 90 days);

        vm.prank(admin);
        registry.attestSelfCredential(rater, NULLIFIER_HASH, SELF_SCOPE, expiresAt, 11_000, EVIDENCE_HASH);

        vm.prank(admin);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        registry.attestSelfCredential(otherRater, NULLIFIER_HASH, SELF_SCOPE, expiresAt, 11_000, EVIDENCE_HASH);
    }

    function test_RevokeSelfCredentialClearsNullifierOwner() public {
        uint64 expiresAt = uint64(block.timestamp + 90 days);

        vm.startPrank(admin);
        registry.attestSelfCredential(rater, NULLIFIER_HASH, SELF_SCOPE, expiresAt, 11_000, EVIDENCE_HASH);
        registry.revokeSelfCredential(rater);
        vm.stopPrank();

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
