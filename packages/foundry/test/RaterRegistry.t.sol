// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {RaterRegistry} from "../contracts/RaterRegistry.sol";
import {IRaterIdentityRegistry} from "../contracts/interfaces/IRaterIdentityRegistry.sol";
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

    function test_SetProfileRejectsNonHumanTypeForActiveHumanCredential() public {
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

    function test_AttestHumanCredentialForcesHumanProfileAndPreservesMetadataHash() public {
        uint256[8] memory proof;

        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.AI, METADATA_HASH);

        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        RaterRegistry.RaterProfile memory profile = registry.getProfile(rater);
        assertEq(uint256(profile.raterType), uint256(RaterRegistry.RaterType.Human));
        assertEq(profile.metadataHash, METADATA_HASH);
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

    function test_CredentialRefreshKeepsCanonicalIdentityKey() public {
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 1), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        IRaterIdentityRegistry.ResolvedRater memory first = registry.resolveRater(rater);
        assertEq(first.identityKey, SEEDED_ANCHOR_ID);

        vm.warp(block.timestamp + 2);
        uint256[8] memory proof;
        vm.prank(rater);
        registry.attestHumanCredentialWithProof(1, uint256(NULLIFIER_HASH), proof);

        IRaterIdentityRegistry.ResolvedRater memory refreshed = registry.resolveRater(rater);
        assertEq(refreshed.humanNullifier, NULLIFIER_HASH);
        assertEq(refreshed.identityKey, SEEDED_ANCHOR_ID);
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
        assertEq(uint256(profile.raterType), uint256(RaterRegistry.RaterType.Human));
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
        assertEq(resolved.identityKey, SEEDED_ANCHOR_ID);
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
        assertEq(resolved.identityKey, SEEDED_ANCHOR_ID);
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
        assertEq(resolved.identityKey, SEEDED_ANCHOR_ID);
        assertFalse(resolved.delegated);
    }
}
