// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { IRaterIdentityRegistry } from "../contracts/interfaces/IRaterIdentityRegistry.sol";
import { MockWorldIDRouter } from "../contracts/mocks/MockWorldIDRouter.sol";

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
    bytes32 internal constant SEEDED_ANCHOR_ID = keccak256("seeded-human-anchor");
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

    function _credentialKey(RaterRegistry.HumanCredentialProvider provider, bytes32 nullifierHash)
        internal
        view
        returns (bytes32)
    {
        return registry.credentialIdentityKey(provider, nullifierHash);
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

    function test_SetProfileRejectsAiTypeForActiveHumanCredential() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.ActiveHumanCredentialRequiresHumanProfile.selector);
        registry.setProfile(RaterRegistry.RaterType.AI, METADATA_HASH);

        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.Human, METADATA_HASH);

        RaterRegistry.RaterProfile memory profile = registry.getProfile(rater);
        assertEq(uint256(profile.raterType), uint256(RaterRegistry.RaterType.Human));
        assertEq(profile.metadataHash, METADATA_HASH);
    }

    function test_SetProfileAllowsTeamAndHybridForActiveHumanCredential() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.Team, METADATA_HASH);

        RaterRegistry.RaterProfile memory teamProfile = registry.getProfile(rater);
        assertEq(uint256(teamProfile.raterType), uint256(RaterRegistry.RaterType.Team));
        assertEq(teamProfile.metadataHash, METADATA_HASH);

        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.Hybrid, METADATA_HASH);

        RaterRegistry.RaterProfile memory hybridProfile = registry.getProfile(rater);
        assertEq(uint256(hybridProfile.raterType), uint256(RaterRegistry.RaterType.Hybrid));
        assertEq(hybridProfile.metadataHash, METADATA_HASH);
    }

    function test_AttestHumanCredentialForcesAiProfileToHumanAndPreservesMetadataHash() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.AI, METADATA_HASH);

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        RaterRegistry.RaterProfile memory profile = registry.getProfile(rater);
        assertEq(uint256(profile.raterType), uint256(RaterRegistry.RaterType.Human));
        assertEq(profile.metadataHash, METADATA_HASH);
    }

    function test_AttestHumanCredentialPreservesTeamAndHybridProfileTypes() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.Team, METADATA_HASH);

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        RaterRegistry.RaterProfile memory teamProfile = registry.getProfile(rater);
        assertEq(uint256(teamProfile.raterType), uint256(RaterRegistry.RaterType.Team));
        assertEq(teamProfile.metadataHash, METADATA_HASH);

        bytes32 otherNullifier = keccak256("other-nullifier");
        vm.prank(otherRater);
        registry.setProfile(RaterRegistry.RaterType.Hybrid, METADATA_HASH);

        vm.prank(otherRater);
        registry.attestHumanCredentialWithProof(1, uint256(otherNullifier), proof);

        RaterRegistry.RaterProfile memory hybridProfile = registry.getProfile(otherRater);
        assertEq(uint256(hybridProfile.raterType), uint256(RaterRegistry.RaterType.Hybrid));
        assertEq(hybridProfile.metadataHash, METADATA_HASH);
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
        uint256 signalHash = registry.worldIdSignalHash(rater);

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
        assertEq(
            credential.evidenceHash,
            keccak256(abi.encodePacked("world-id-v3", block.chainid, address(worldIdRouter), uint256(1), signalHash))
        );
        assertEq(
            registry.humanNullifierOwnerByProvider(RaterRegistry.HumanCredentialProvider.WorldId, NULLIFIER_HASH), rater
        );
        assertTrue(registry.hasActiveHumanCredential(rater));
    }

    function test_WorldIdSignalHashMatchesStablePackedAddressVector() public view {
        assertEq(
            registry.worldIdSignalHash(rater),
            408645922159002731750469755377061467244027247537768494763546378565345730312
        );
    }

    function test_GovernanceCanUpdateWorldIdVerifierConfig() public {
        MockWorldIDRouter replacementRouter = new MockWorldIDRouter();
        bytes32 replacementScope = keccak256("rateloop-human-v2");
        uint256 replacementExternalNullifierHash = 67_890;
        uint64 replacementTtl = 30 days;
        uint256[8] memory proof;
        uint256 signalHash = registry.worldIdSignalHash(rater);

        vm.prank(governance);
        registry.setWorldIdVerifierConfig(
            address(replacementRouter), replacementScope, replacementExternalNullifierHash, replacementTtl
        );

        assertEq(address(registry.worldIdRouter()), address(replacementRouter));
        assertEq(registry.worldIdScope(), replacementScope);
        assertEq(registry.worldIdExternalNullifierHash(), replacementExternalNullifierHash);
        assertEq(registry.worldIdCredentialTtl(), replacementTtl);

        replacementRouter.setExpectedSignalHash(signalHash);
        replacementRouter.setExpectedExternalNullifierHash(replacementExternalNullifierHash);

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(2, uint256(NULLIFIER_HASH), proof);

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertEq(credential.scope, replacementScope);
        assertEq(credential.expiresAt, uint64(block.timestamp + replacementTtl));
        assertEq(
            credential.evidenceHash,
            keccak256(
                abi.encodePacked("world-id-v3", block.chainid, address(replacementRouter), uint256(2), signalHash)
            )
        );
    }

    function test_OnlyGovernanceCanUpdateWorldIdVerifierConfig() public {
        MockWorldIDRouter replacementRouter = new MockWorldIDRouter();

        vm.prank(admin);
        vm.expectRevert();
        registry.setWorldIdVerifierConfig(address(replacementRouter), HUMAN_SCOPE, 99, WORLD_ID_CREDENTIAL_TTL);
    }

    function test_WorldIdVerifierConfigRejectsInvalidUpdates() public {
        MockWorldIDRouter replacementRouter = new MockWorldIDRouter();

        vm.startPrank(governance);
        vm.expectRevert(RaterRegistry.InvalidAddress.selector);
        registry.setWorldIdVerifierConfig(address(0), HUMAN_SCOPE, 99, WORLD_ID_CREDENTIAL_TTL);

        vm.expectRevert(RaterRegistry.InvalidAddress.selector);
        registry.setWorldIdVerifierConfig(address(0xBEEF), HUMAN_SCOPE, 99, WORLD_ID_CREDENTIAL_TTL);

        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.setWorldIdVerifierConfig(address(replacementRouter), bytes32(0), 99, WORLD_ID_CREDENTIAL_TTL);

        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.setWorldIdVerifierConfig(address(replacementRouter), HUMAN_SCOPE, 0, WORLD_ID_CREDENTIAL_TTL);

        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.setWorldIdVerifierConfig(address(replacementRouter), HUMAN_SCOPE, 99, 0);
        vm.stopPrank();
    }

    function test_GovernanceCanFreezeWorldIdVerifierConfig() public {
        MockWorldIDRouter replacementRouter = new MockWorldIDRouter();

        vm.prank(governance);
        registry.freezeWorldIdVerifierConfig();

        assertTrue(registry.worldIdVerifierConfigFrozen());

        vm.prank(governance);
        vm.expectRevert(RaterRegistry.WorldIdVerifierConfigFrozen.selector);
        registry.setWorldIdVerifierConfig(address(replacementRouter), HUMAN_SCOPE, 99, WORLD_ID_CREDENTIAL_TTL);
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

    function test_AttestHumanCredentialWithProofRejectsProofForDifferentSenderSignal() public {
        uint256[8] memory proof;
        worldIdRouter.setExpectedSignalHash(registry.worldIdSignalHash(otherRater));

        vm.prank(rater);
        vm.expectRevert(MockWorldIDRouter.InvalidMockWorldIdProof.selector);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
    }

    function test_AttestHumanCredentialWithProofRejectsUnexpectedExternalNullifier() public {
        uint256[8] memory proof;
        worldIdRouter.setExpectedExternalNullifierHash(WORLD_ID_EXTERNAL_NULLIFIER_HASH + 1);

        vm.prank(rater);
        vm.expectRevert(MockWorldIDRouter.InvalidMockWorldIdProof.selector);
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
        assertEq(
            registry.humanNullifierOwnerByProvider(RaterRegistry.HumanCredentialProvider.WorldId, NULLIFIER_HASH),
            address(0)
        );
        assertTrue(
            registry.revokedHumanNullifierByProvider(RaterRegistry.HumanCredentialProvider.WorldId, NULLIFIER_HASH)
        );
    }

    function test_RevokeHumanCredentialBlocksNullifierReuseUntilCleared() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(admin);
        registry.revokeHumanCredential(rater);

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(admin);
        registry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.WorldId, NULLIFIER_HASH);

        vm.prank(otherRater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
        assertEq(
            registry.humanNullifierOwnerByProvider(RaterRegistry.HumanCredentialProvider.WorldId, NULLIFIER_HASH),
            otherRater
        );
    }

    function test_SwitchingProviderClearsOldProviderNullifierSlot() public {
        // Codex PR #10 regression: when a rater re-attests under a different provider but reuses
        // the same nullifier bytes, the old (provider, nullifier) slot was leaking. After a later
        // revocation -- which only clears the current provider's slot -- a future attestation by
        // someone else under the old provider would falsely revert with NullifierAlreadyAssigned.
        bytes32 anchorId = NULLIFIER_HASH; // same bytes, different provider
        uint256[8] memory proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
        assertEq(
            registry.humanNullifierOwnerByProvider(RaterRegistry.HumanCredentialProvider.WorldId, NULLIFIER_HASH), rater
        );

        // Switch the rater to the RateLoop seed provider while keeping the nullifier bytes the same.
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 30 days), anchorId, EVIDENCE_HASH);

        // The old WorldId slot must be cleared by the switch -- not waiting for a revoke.
        assertEq(
            registry.humanNullifierOwnerByProvider(RaterRegistry.HumanCredentialProvider.WorldId, NULLIFIER_HASH),
            address(0)
        );
        assertEq(
            registry.humanNullifierOwnerByProvider(RaterRegistry.HumanCredentialProvider.SeededHuman, anchorId), rater
        );

        // A different rater can now claim the nullifier under the old provider.
        vm.prank(otherRater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);
        assertEq(
            registry.humanNullifierOwnerByProvider(RaterRegistry.HumanCredentialProvider.WorldId, NULLIFIER_HASH),
            otherRater
        );
    }

    function test_CredentialIdentityKeysAreProviderNamespaced() public {
        uint256[8] memory proof;
        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        vm.prank(admin);
        registry.seedHumanCredential(otherRater, uint64(block.timestamp + 30 days), NULLIFIER_HASH, EVIDENCE_HASH);

        IRaterIdentityRegistry.ResolvedRater memory worldIdRater = registry.resolveRater(rater);
        IRaterIdentityRegistry.ResolvedRater memory seededRater = registry.resolveRater(otherRater);

        assertEq(worldIdRater.humanNullifier, NULLIFIER_HASH);
        assertEq(seededRater.humanNullifier, NULLIFIER_HASH);
        assertEq(
            worldIdRater.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.WorldId, NULLIFIER_HASH)
        );
        assertEq(
            seededRater.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, NULLIFIER_HASH)
        );
        assertTrue(worldIdRater.identityKey != seededRater.identityKey);
    }

    function test_CredentialRefreshKeepsCanonicalIdentityKey() public {
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 1), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        IRaterIdentityRegistry.ResolvedRater memory first = registry.resolveRater(rater);
        assertEq(first.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID));

        vm.warp(block.timestamp + 2);
        uint256[8] memory proof;
        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        IRaterIdentityRegistry.ResolvedRater memory refreshed = registry.resolveRater(rater);
        assertEq(refreshed.humanNullifier, NULLIFIER_HASH);
        assertEq(
            refreshed.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID)
        );
    }

    /// @notice RR-1 (2026-05-20 follow-up audit): the M-Identity-2 sticky-canonical fix preserved
    ///         _canonicalHumanIdentityKey across legitimate credential refreshes, but on revocation
    ///         the stale canonical survived. A SEEDER could then clearRevokedHumanNullifier and
    ///         re-seed the same anchor onto a DIFFERENT rater, leaving both raters resolving to
    ///         the same canonical identityKey. revokeHumanCredential must clear the canonical so
    ///         the next attestation re-seeds it from the new credential's nullifier.
    function test_RevokeClearsCanonicalKeyAndPreventsReseedCollision() public {
        // 1. Seed rater A with anchorId N; canonical = N.
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 365 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);
        bytes32 seededKey = _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID);
        assertEq(registry.resolveRater(rater).identityKey, seededKey);

        // 2. Revoke A. Canonical must be cleared.
        vm.prank(admin);
        registry.revokeHumanCredential(rater);
        IRaterIdentityRegistry.ResolvedRater memory revokedA = registry.resolveRater(rater);
        assertTrue(revokedA.identityKey != seededKey, "canonical not cleared on revoke");
        // Post-revoke, identityKey falls back to the address-derived key.
        assertEq(revokedA.identityKey, registry.addressIdentityKey(rater));

        // 3. SEEDER recycles the anchor onto otherRater. otherRater's canonical = N.
        vm.startPrank(admin);
        registry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID);
        registry.seedHumanCredential(otherRater, uint64(block.timestamp + 365 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);
        vm.stopPrank();
        assertEq(registry.resolveRater(otherRater).identityKey, seededKey);

        // 4. Re-seed rater A with a DIFFERENT anchor. A's canonical must be the NEW anchor,
        //    not the recycled N still held by otherRater.
        bytes32 freshAnchor = keccak256("fresh-anchor-for-A");
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 365 days), freshAnchor, EVIDENCE_HASH);
        IRaterIdentityRegistry.ResolvedRater memory reseededA = registry.resolveRater(rater);
        assertEq(
            reseededA.identityKey,
            _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, freshAnchor),
            "A's canonical didn't re-seed to new anchor"
        );

        // 5. The two raters must NOT share an identityKey.
        assertTrue(
            registry.resolveRater(rater).identityKey != registry.resolveRater(otherRater).identityKey,
            "RR-1: distinct raters share canonical identityKey after revoke->clear->reseed"
        );
    }

    /// @notice RR-4 (2026-05-20 follow-up audit): governance can cap the SEEDER-seeded credential
    ///         TTL, mirroring the immutable WorldID TTL cap. cap=0 keeps the legacy behavior.
    function test_MaxSeededCredentialTtlClampsSeedExpiry() public {
        // Default: no cap; long-lived seeds accepted (legacy behavior).
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 100 * 365 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        // Governance sets a 30-day cap.
        vm.prank(governance);
        registry.setMaxSeededCredentialTtl(uint64(30 days));
        assertEq(registry.maxSeededCredentialTtl(), uint64(30 days));

        // Seed beyond cap is rejected.
        vm.prank(admin);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.seedHumanCredential(
            otherRater, uint64(block.timestamp + 60 days), keccak256("rr4-other-anchor"), EVIDENCE_HASH
        );

        // Seed inside cap is accepted.
        vm.prank(admin);
        registry.seedHumanCredential(
            otherRater, uint64(block.timestamp + 15 days), keccak256("rr4-other-anchor"), EVIDENCE_HASH
        );

        // cap = 0 disables the clamp again.
        vm.prank(governance);
        registry.setMaxSeededCredentialTtl(0);
        assertEq(registry.maxSeededCredentialTtl(), 0);
        vm.prank(admin);
        registry.seedHumanCredential(
            address(0xBEEF), uint64(block.timestamp + 100 * 365 days), keccak256("rr4-uncapped-anchor"), EVIDENCE_HASH
        );
    }

    function test_SeedHumanCredentialStoresSeededAccountAsVerifiedHuman() public {
        uint64 expiresAt = uint64(block.timestamp + 180 days);

        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.Team, METADATA_HASH);

        vm.prank(admin);
        registry.seedHumanCredential(rater, expiresAt, SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertTrue(credential.verified);
        assertFalse(credential.revoked);
        assertEq(uint256(credential.provider), uint256(RaterRegistry.HumanCredentialProvider.SeededHuman));
        assertEq(credential.nullifierHash, SEEDED_ANCHOR_ID);
        assertEq(credential.scope, registry.SEEDED_HUMAN_SCOPE());
        assertEq(credential.expiresAt, expiresAt);
        assertEq(credential.evidenceHash, EVIDENCE_HASH);
        assertEq(
            registry.humanNullifierOwnerByProvider(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID),
            rater
        );
        assertTrue(registry.hasActiveHumanCredential(rater));

        RaterRegistry.RaterProfile memory profile = registry.getProfile(rater);
        assertEq(uint256(profile.raterType), uint256(RaterRegistry.RaterType.Team));
        assertEq(profile.metadataHash, METADATA_HASH);
    }

    function test_SeedHumanCredentialExpiresLikeWorldIdHumanUnit() public {
        uint64 expiresAt = uint64(block.timestamp + 7 days);

        vm.prank(admin);
        registry.seedHumanCredential(rater, expiresAt, SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        vm.warp(expiresAt + 1);

        assertFalse(registry.hasActiveHumanCredential(rater));

        IRaterIdentityRegistry.ResolvedRater memory resolved = registry.resolveRater(rater);
        assertEq(resolved.holder, rater);
        assertEq(
            resolved.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID)
        );
        assertEq(resolved.humanNullifier, SEEDED_ANCHOR_ID);
        assertFalse(resolved.hasActiveHumanCredential);
        assertFalse(resolved.delegated);
    }

    function test_ResolveRaterUsesAddressIdentityWithoutCredential() public view {
        IRaterIdentityRegistry.ResolvedRater memory resolved = registry.resolveRater(rater);

        assertEq(resolved.holder, rater);
        assertEq(resolved.identityKey, registry.addressIdentityKey(rater));
        assertEq(resolved.humanNullifier, bytes32(0));
        assertFalse(resolved.hasActiveHumanCredential);
        assertFalse(resolved.delegated);
    }

    function test_ResolveRaterUsesHumanNullifierIdentityWhenCredentialed() public {
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 7 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        IRaterIdentityRegistry.ResolvedRater memory resolved = registry.resolveRater(rater);

        assertEq(resolved.holder, rater);
        assertEq(
            resolved.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID)
        );
        assertEq(resolved.humanNullifier, SEEDED_ANCHOR_ID);
        assertTrue(resolved.hasActiveHumanCredential);
        assertFalse(resolved.delegated);
    }

    function test_DelegationRequiresAcceptanceAndResolvesToHolderIdentity() public {
        vm.prank(rater);
        registry.setDelegate(otherRater);

        IRaterIdentityRegistry.ResolvedRater memory pending = registry.resolveRater(otherRater);
        assertEq(pending.holder, otherRater);
        assertEq(pending.identityKey, registry.addressIdentityKey(otherRater));
        assertFalse(pending.delegated);

        vm.prank(otherRater);
        registry.acceptDelegate();

        IRaterIdentityRegistry.ResolvedRater memory resolved = registry.resolveRater(otherRater);
        assertEq(resolved.holder, rater);
        assertEq(resolved.identityKey, registry.addressIdentityKey(rater));
        assertTrue(resolved.delegated);
    }

    function test_DelegateCannotChainOrUseOwnCredentialIdentity() public {
        vm.prank(rater);
        registry.setDelegate(otherRater);
        vm.prank(otherRater);
        registry.acceptDelegate();

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.CallerIsDelegate.selector);
        registry.setDelegate(subject);

        vm.prank(admin);
        registry.seedHumanCredential(subject, uint64(block.timestamp + 7 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.DelegateIsHolder.selector);
        registry.setDelegate(subject);
    }

    function test_PendingOutboundDelegateCannotBecomeDelegate() public {
        vm.prank(otherRater);
        registry.setDelegate(subject);

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.DelegateAlreadyAssigned.selector);
        registry.setDelegate(otherRater);
    }

    function test_PendingInboundDelegateCannotOpenOutboundRequest() public {
        vm.prank(rater);
        registry.setDelegate(otherRater);

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.CallerIsDelegate.selector);
        registry.setDelegate(subject);
    }

    function test_AttestingCredentialClearsInboundDelegation() public {
        vm.prank(rater);
        registry.setDelegate(otherRater);
        vm.prank(otherRater);
        registry.acceptDelegate();

        vm.prank(admin);
        registry.seedHumanCredential(otherRater, uint64(block.timestamp + 7 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        assertEq(registry.delegateTo(rater), address(0));
        assertEq(registry.delegateOf(otherRater), address(0));

        IRaterIdentityRegistry.ResolvedRater memory resolved = registry.resolveRater(otherRater);
        assertEq(resolved.holder, otherRater);
        assertEq(
            resolved.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID)
        );
        assertFalse(resolved.delegated);
    }
}
