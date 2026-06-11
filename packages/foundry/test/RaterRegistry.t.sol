// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { IRaterIdentityRegistry } from "../contracts/interfaces/IRaterIdentityRegistry.sol";
import { LaunchRaterRewardLib } from "../contracts/libraries/LaunchRaterRewardLib.sol";
import { MockWorldIDVerifier } from "../contracts/mocks/MockWorldIDVerifier.sol";

contract LaunchRaterRewardLibHarness {
    function launchRewardCredentialAnchorId(RaterRegistry.HumanCredentialProvider provider, bytes32 nullifierHash)
        external
        pure
        returns (bytes32)
    {
        return LaunchRaterRewardLib.launchRewardCredentialAnchorId(provider, nullifierHash);
    }

    function launchRewardAnchorId(
        RaterRegistry raterRegistry,
        address account,
        uint48 rewardStart,
        uint32 minCredentialAgeSeconds
    ) external view returns (bytes32) {
        return LaunchRaterRewardLib.launchRewardAnchorId(raterRegistry, account, rewardStart, minCredentialAgeSeconds);
    }
}

contract MockConfidentialityNexus {
    mapping(uint8 => mapping(bytes32 => bool)) internal nexus;

    function setNexus(uint8 provider, bytes32 nullifierHash, bool value) external {
        nexus[provider][nullifierHash] = value;
    }

    function hasConfidentialityNexus(uint8 provider, bytes32 nullifierHash) external view returns (bool) {
        return nexus[provider][nullifierHash];
    }
}

contract RaterRegistryTest is Test {
    RaterRegistry internal registry;
    MockWorldIDVerifier internal worldIdRouter;

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
    uint64 internal constant WORLD_ID_CREDENTIAL_TTL = 365 days;
    uint64 internal constant WORLD_ID_V4_RP_ID = 42;
    uint256 internal constant WORLD_ID_V4_ACTION = uint256(keccak256("rateloop-human-credential-v4"));
    uint256 internal constant WORLD_ID_V4_PRESENCE_ACTION = uint256(keccak256("rateloop-human-presence-v1"));
    uint64 internal constant WORLD_ID_V4_PRESENCE_TTL = 15 minutes;
    uint64 internal constant WORLD_ID_V4_ISSUER_SCHEMA_ID = 7;
    uint256 internal constant WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN = 1_700_000_000;

    event ProfileFollowed(address indexed follower, address indexed target, uint64 followedAt);
    event ProfileUnfollowed(address indexed follower, address indexed target, uint64 unfollowedAt);

    function setUp() public {
        worldIdRouter = new MockWorldIDVerifier();
        registry = new RaterRegistry(
            admin,
            governance,
            address(worldIdRouter),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_V4_PRESENCE_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_PRESENCE_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );
    }

    function _hashToField(bytes memory value) internal pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }

    function _worldIdSignalHash(address account) internal pure returns (uint256) {
        return _hashToField(abi.encodePacked(account));
    }

    function _worldCredentialSignalHash(address account, uint8 kind) internal pure returns (uint256) {
        return _hashToField(abi.encodePacked("rateloop-world-credential-v1", account, kind));
    }

    function _worldPresenceSignalHash(address account, uint8 kind) internal pure returns (uint256) {
        return _hashToField(abi.encodePacked("rateloop-world-presence-v1", account, kind));
    }

    function _worldCredentialScope(uint64 rpId, uint256 action) internal pure returns (bytes32) {
        return keccak256(abi.encode("world-id-v4", rpId, action));
    }

    function _credentialKindBit(uint8 kind) internal pure returns (uint8) {
        return uint8(1 << kind);
    }

    function _deployProxiedRegistry() internal returns (RaterRegistry proxiedRegistry) {
        RaterRegistry implementation = new RaterRegistry(
            admin,
            governance,
            address(worldIdRouter),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_V4_PRESENCE_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_PRESENCE_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(implementation),
            governance,
            abi.encodeCall(
                RaterRegistry.initialize,
                (
                    admin,
                    governance,
                    address(worldIdRouter),
                    WORLD_ID_V4_RP_ID,
                    WORLD_ID_V4_ACTION,
                    WORLD_ID_V4_PRESENCE_ACTION,
                    WORLD_ID_CREDENTIAL_TTL,
                    WORLD_ID_V4_PRESENCE_TTL,
                    WORLD_ID_V4_ISSUER_SCHEMA_ID,
                    WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
                )
            )
        );
        proxiedRegistry = RaterRegistry(address(proxy));
    }

    function _configureV4Verifier(MockWorldIDVerifier verifier) internal {
        vm.prank(governance);
        registry.setWorldIdV4VerifierConfig(
            address(verifier),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );
    }

    function _emptyV4Proof() internal pure returns (uint256[5] memory proof) { }

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

    function test_TransparentProxyInitializePreservesRegistryBehavior() public {
        RaterRegistry proxiedRegistry = _deployProxiedRegistry();

        assertTrue(proxiedRegistry.hasRole(proxiedRegistry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(proxiedRegistry.hasRole(proxiedRegistry.ADMIN_ROLE(), admin));
        assertEq(address(proxiedRegistry.worldIdV4Verifier()), address(worldIdRouter));
        assertEq(proxiedRegistry.maxSeededCredentialTtl(), WORLD_ID_CREDENTIAL_TTL);

        vm.prank(rater);
        proxiedRegistry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        IRaterIdentityRegistry.ResolvedRater memory resolved = proxiedRegistry.resolveRater(rater);
        assertEq(resolved.holder, rater);
        assertEq(resolved.humanNullifier, NULLIFIER_HASH);
        assertTrue(resolved.hasActiveHumanCredential);

        vm.expectRevert();
        proxiedRegistry.initialize(
            admin,
            governance,
            address(worldIdRouter),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_V4_PRESENCE_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_PRESENCE_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );
    }

    function test_ConstructorRejectsNoCodeWorldIdRouter() public {
        vm.expectRevert(RaterRegistry.InvalidAddress.selector);
        new RaterRegistry(
            admin,
            governance,
            address(0xBEEF),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_V4_PRESENCE_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_PRESENCE_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );
    }

    function test_ProxyInitializeRejectsNoCodeWorldIdRouter() public {
        RaterRegistry implementation = new RaterRegistry(
            admin,
            governance,
            address(worldIdRouter),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_V4_PRESENCE_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_PRESENCE_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );

        vm.expectRevert(RaterRegistry.InvalidAddress.selector);
        new TransparentUpgradeableProxy(
            address(implementation),
            governance,
            abi.encodeCall(
                RaterRegistry.initialize,
                (
                    admin,
                    governance,
                    address(0xBEEF),
                    WORLD_ID_V4_RP_ID,
                    WORLD_ID_V4_ACTION,
                    WORLD_ID_V4_PRESENCE_ACTION,
                    WORLD_ID_CREDENTIAL_TTL,
                    WORLD_ID_V4_PRESENCE_TTL,
                    WORLD_ID_V4_ISSUER_SCHEMA_ID,
                    WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
                )
            )
        );
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
        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

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
        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

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
        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.AI, METADATA_HASH);

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        RaterRegistry.RaterProfile memory profile = registry.getProfile(rater);
        assertEq(uint256(profile.raterType), uint256(RaterRegistry.RaterType.Human));
        assertEq(profile.metadataHash, METADATA_HASH);
    }

    function test_AttestHumanCredentialPreservesTeamAndHybridProfileTypes() public {
        vm.prank(rater);
        registry.setProfile(RaterRegistry.RaterType.Team, METADATA_HASH);

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        RaterRegistry.RaterProfile memory teamProfile = registry.getProfile(rater);
        assertEq(uint256(teamProfile.raterType), uint256(RaterRegistry.RaterType.Team));
        assertEq(teamProfile.metadataHash, METADATA_HASH);

        bytes32 otherNullifier = keccak256("other-nullifier");
        vm.prank(otherRater);
        registry.setProfile(RaterRegistry.RaterType.Hybrid, METADATA_HASH);

        vm.prank(otherRater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(otherNullifier), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        RaterRegistry.RaterProfile memory hybridProfile = registry.getProfile(otherRater);
        assertEq(uint256(hybridProfile.raterType), uint256(RaterRegistry.RaterType.Hybrid));
        assertEq(hybridProfile.metadataHash, METADATA_HASH);
    }

    function test_FollowProfileStoresPublicRelationshipAndCounts() public {
        vm.prank(rater);
        vm.expectEmit(true, true, false, true);
        emit ProfileFollowed(rater, subject, uint64(block.timestamp));
        registry.followProfile(subject);

        vm.prank(rater);
        registry.followProfile(subject);
    }

    function test_UnfollowProfileClearsPublicRelationshipAndCounts() public {
        vm.prank(rater);
        registry.followProfile(subject);

        vm.prank(rater);
        vm.expectEmit(true, true, false, true);
        emit ProfileUnfollowed(rater, subject, uint64(block.timestamp));
        registry.unfollowProfile(subject);

        vm.prank(rater);
        registry.unfollowProfile(subject);
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

    function test_AttestHumanCredentialWithV4ProofStoresUniquenessCredentialForSender() public {
        uint256 nullifierHash = uint256(NULLIFIER_HASH);
        uint256 signalHash = _worldIdSignalHash(rater);
        uint256 nonce = 1;
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(nullifierHash, nonce, expiresAtMin, _emptyV4Proof());

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertTrue(credential.verified);
        assertFalse(credential.revoked);
        assertEq(uint256(credential.provider), uint256(RaterRegistry.HumanCredentialProvider.WorldIdV4));
        assertEq(credential.nullifierHash, NULLIFIER_HASH);
        assertEq(credential.scope, _worldCredentialScope(WORLD_ID_V4_RP_ID, WORLD_ID_V4_ACTION));
        assertEq(credential.verifiedAt, uint64(block.timestamp));
        assertEq(credential.expiresAt, expiresAtMin);
        assertEq(
            credential.evidenceHash,
            keccak256(
                abi.encodePacked(
                    "world-id-v4",
                    registry.WORLD_CREDENTIAL_PROOF_OF_HUMAN(),
                    block.chainid,
                    address(worldIdRouter),
                    WORLD_ID_V4_RP_ID,
                    WORLD_ID_V4_ACTION,
                    nonce,
                    signalHash,
                    expiresAtMin
                )
            )
        );
        assertTrue(registry.hasActiveHumanCredential(rater));
    }

    function test_WorldIdSignalHashMatchesStablePackedAddressVector() public view {
        assertEq(_worldIdSignalHash(rater), 408645922159002731750469755377061467244027247537768494763546378565345730312);
    }

    function test_GovernanceCanUpdateWorldIdV4VerifierConfig() public {
        MockWorldIDVerifier replacementVerifier = new MockWorldIDVerifier();
        uint256 replacementAction = uint256(keccak256("rateloop-human-v2"));
        uint64 replacementTtl = 30 days;
        uint256 signalHash = _worldIdSignalHash(rater);
        uint256 nonce = 2;
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);

        vm.prank(governance);
        registry.setWorldIdV4VerifierConfig(
            address(replacementVerifier),
            WORLD_ID_V4_RP_ID,
            replacementAction,
            replacementTtl,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );

        assertEq(address(registry.worldIdV4Verifier()), address(replacementVerifier));
        assertEq(
            _worldCredentialScope(WORLD_ID_V4_RP_ID, replacementAction),
            keccak256(abi.encode("world-id-v4", WORLD_ID_V4_RP_ID, replacementAction))
        );
        assertEq(registry.worldIdV4CredentialTtl(), replacementTtl);

        replacementVerifier.setExpectedAction(replacementAction);
        replacementVerifier.setExpectedSignalHash(signalHash);

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), nonce, expiresAtMin, _emptyV4Proof());

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertEq(credential.scope, _worldCredentialScope(WORLD_ID_V4_RP_ID, replacementAction));
        assertEq(credential.expiresAt, expiresAtMin);
        assertEq(
            credential.evidenceHash,
            keccak256(
                abi.encodePacked(
                    "world-id-v4",
                    registry.WORLD_CREDENTIAL_PROOF_OF_HUMAN(),
                    block.chainid,
                    address(replacementVerifier),
                    WORLD_ID_V4_RP_ID,
                    replacementAction,
                    nonce,
                    signalHash,
                    expiresAtMin
                )
            )
        );
    }

    function test_OnlyGovernanceCanUpdateWorldIdV4VerifierConfig() public {
        MockWorldIDVerifier replacementVerifier = new MockWorldIDVerifier();

        vm.prank(admin);
        vm.expectRevert();
        registry.setWorldIdV4VerifierConfig(
            address(replacementVerifier),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );
    }

    function test_WorldIdV4VerifierConfigInitializesConfigured() public view {
        assertEq(address(registry.worldIdV4Verifier()), address(worldIdRouter));
        assertEq(registry.worldIdV4RpId(), WORLD_ID_V4_RP_ID);
        assertEq(registry.worldIdV4Action(), WORLD_ID_V4_ACTION);
        assertEq(
            _worldCredentialScope(WORLD_ID_V4_RP_ID, WORLD_ID_V4_ACTION),
            keccak256(abi.encode("world-id-v4", WORLD_ID_V4_RP_ID, WORLD_ID_V4_ACTION))
        );
    }

    function test_GovernanceCanConfigureAndDisableWorldIdV4Verifier() public {
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();

        _configureV4Verifier(verifier);

        assertEq(address(registry.worldIdV4Verifier()), address(verifier));
        assertEq(registry.worldIdV4RpId(), WORLD_ID_V4_RP_ID);
        assertEq(registry.worldIdV4Action(), WORLD_ID_V4_ACTION);
        assertEq(registry.worldIdV4CredentialTtl(), WORLD_ID_CREDENTIAL_TTL);
        assertEq(registry.worldIdV4IssuerSchemaId(), WORLD_ID_V4_ISSUER_SCHEMA_ID);
        assertEq(registry.worldIdV4CredentialGenesisIssuedAtMin(), WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN);
        assertEq(
            _worldCredentialScope(WORLD_ID_V4_RP_ID, WORLD_ID_V4_ACTION),
            keccak256(abi.encode("world-id-v4", WORLD_ID_V4_RP_ID, WORLD_ID_V4_ACTION))
        );

        vm.prank(governance);
        registry.setWorldIdV4VerifierConfig(address(0), 0, 0, 0, 0, 0);
        assertEq(address(registry.worldIdV4Verifier()), address(0));
        assertEq(
            registry.worldIdV4RpId() == 0 || registry.worldIdV4Action() == 0
                ? bytes32(0)
                : _worldCredentialScope(registry.worldIdV4RpId(), registry.worldIdV4Action()),
            bytes32(0)
        );

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.WorldIdV4VerifierNotConfigured.selector);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );
    }

    function test_WorldIdV4VerifierConfigRejectsInvalidUpdatesAndFreezes() public {
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();

        vm.startPrank(governance);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.setWorldIdV4VerifierConfig(
            address(0),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );

        vm.expectRevert(RaterRegistry.InvalidAddress.selector);
        registry.setWorldIdV4VerifierConfig(
            address(0xBEEF),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );

        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.setWorldIdV4VerifierConfig(
            address(verifier),
            0,
            WORLD_ID_V4_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );
        vm.stopPrank();

        vm.prank(admin);
        vm.expectRevert();
        registry.freezeWorldIdV4VerifierConfig();

        vm.prank(governance);
        registry.freezeWorldIdV4VerifierConfig();

        vm.prank(governance);
        vm.expectRevert(RaterRegistry.WorldIdV4VerifierConfigFrozen.selector);
        registry.setWorldIdV4VerifierConfig(
            address(verifier),
            WORLD_ID_V4_RP_ID,
            WORLD_ID_V4_ACTION,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN
        );
    }

    function test_AttestHumanCredentialWithV4ProofStoresPreviewProviderCredential() public {
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();
        uint256[5] memory proof;
        uint256 nonce = 99;
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);
        uint256 signalHash = _worldIdSignalHash(rater);

        _configureV4Verifier(verifier);
        verifier.setExpectedAction(WORLD_ID_V4_ACTION);
        verifier.setExpectedRpId(WORLD_ID_V4_RP_ID);
        verifier.setExpectedNonce(nonce);
        verifier.setExpectedSignalHash(signalHash);
        verifier.setExpectedExpiresAtMin(expiresAtMin);
        verifier.setExpectedIssuerSchemaId(WORLD_ID_V4_ISSUER_SCHEMA_ID);
        verifier.setExpectedCredentialGenesisIssuedAtMin(WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN);

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), nonce, expiresAtMin, proof);

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertTrue(credential.verified);
        assertFalse(credential.revoked);
        assertEq(uint256(credential.provider), uint256(RaterRegistry.HumanCredentialProvider.WorldIdV4));
        assertEq(credential.nullifierHash, NULLIFIER_HASH);
        assertEq(credential.scope, _worldCredentialScope(WORLD_ID_V4_RP_ID, WORLD_ID_V4_ACTION));
        assertEq(credential.expiresAt, expiresAtMin);
        assertEq(
            credential.evidenceHash,
            keccak256(
                abi.encodePacked(
                    "world-id-v4",
                    registry.WORLD_CREDENTIAL_PROOF_OF_HUMAN(),
                    block.chainid,
                    address(verifier),
                    WORLD_ID_V4_RP_ID,
                    WORLD_ID_V4_ACTION,
                    nonce,
                    signalHash,
                    expiresAtMin
                )
            )
        );
        assertTrue(registry.hasActiveHumanCredential(rater));
    }

    function test_AttestHumanCredentialWithV4ProofCapsExpiryAtConfiguredTtl() public {
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();
        uint256[5] memory proof;
        uint256 nonce = 99;
        uint64 expiresAtMin = uint64(block.timestamp + WORLD_ID_CREDENTIAL_TTL + 1 days);

        _configureV4Verifier(verifier);

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), nonce, expiresAtMin, proof);

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertEq(credential.expiresAt, uint64(block.timestamp + WORLD_ID_CREDENTIAL_TTL));
    }

    function test_AttestHumanCredentialWithV4ProofRejectsExpiredFreshnessFloor() public {
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();
        uint256[5] memory proof;

        _configureV4Verifier(verifier);

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), 99, uint64(block.timestamp), proof);
    }

    function test_WorldIdV4NullifierUsesV4OwnerSlotAndLaunchFamilyKey() public {
        uint256[5] memory v4Proof;

        bytes32 v4Key = _credentialKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH);
        bytes32 seededKey = _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, NULLIFIER_HASH);
        assertEq(
            v4Key,
            keccak256(
                abi.encode(
                    "rateloop.human-identity-v1", RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH
                )
            )
        );
        assertTrue(seededKey != v4Key);
        assertEq(
            registry.launchHumanIdentityKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH),
            keccak256(abi.encode("rateloop.launch-world-id-human-v1", NULLIFIER_HASH))
        );

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), v4Proof
        );

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 2, uint64(block.timestamp + 1 hours), v4Proof
        );

        IRaterIdentityRegistry.ResolvedRater memory resolved = registry.resolveRater(rater);

        assertEq(resolved.identityKey, v4Key);
        assertEq(resolved.humanNullifier, NULLIFIER_HASH);
        LaunchRaterRewardLibHarness launchHarness = new LaunchRaterRewardLibHarness();
        assertEq(
            launchHarness.launchRewardCredentialAnchorId(
                RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH
            ),
            keccak256(abi.encode(RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH))
        );
        assertTrue(
            launchHarness.launchRewardCredentialAnchorId(
                RaterRegistry.HumanCredentialProvider.SeededHuman, NULLIFIER_HASH
            )
            != launchHarness.launchRewardCredentialAnchorId(
                RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH
            )
        );
    }

    function test_WorldIdV4LaunchRewardAnchorUsesV4Identity() public {
        LaunchRaterRewardLibHarness launchHarness = new LaunchRaterRewardLibHarness();
        uint256[5] memory v4Proof;
        bytes32 v4Nullifier = keccak256("v4-human");

        vm.prank(otherRater);
        registry.attestHumanCredentialWithV4Proof(uint256(v4Nullifier), 1, uint64(block.timestamp + 1 hours), v4Proof);

        assertEq(
            launchHarness.launchRewardAnchorId(registry, otherRater, uint48(block.timestamp), 0),
            registry.launchHumanIdentityKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, v4Nullifier)
        );
    }

    function test_DefaultWorldIdV4ConfigLeavesSelfieDisabledUntilExplicitlyConfigured() public view {
        uint8 selfieKind = registry.WORLD_CREDENTIAL_SELFIE();

        (address credentialVerifier,,,,,, bool credentialEnabled,) = registry.worldCredentialV4Config(selfieKind);
        (address presenceVerifier,,,,,, bool presenceEnabled,) = registry.worldPresenceV4Config(selfieKind);

        assertEq(credentialVerifier, address(0));
        assertFalse(credentialEnabled);
        assertEq(presenceVerifier, address(0));
        assertFalse(presenceEnabled);
    }

    function test_AttestWorldCredentialWithV4ProofStoresPassportCredential() public {
        MockWorldIDVerifier passportVerifier = new MockWorldIDVerifier();
        uint8 passportKind = registry.WORLD_CREDENTIAL_PASSPORT();
        uint256 passportAction = uint256(keccak256("rateloop-passport-v4"));
        uint256 passportNullifier = uint256(keccak256("passport-nullifier"));
        uint256 nonce = 11;
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);
        uint256 signalHash = _worldCredentialSignalHash(rater, passportKind);
        uint256[5] memory proof;

        vm.prank(governance);
        registry.setWorldCredentialV4Config(
            passportKind,
            address(passportVerifier),
            WORLD_ID_V4_RP_ID,
            passportAction,
            WORLD_ID_CREDENTIAL_TTL,
            WORLD_ID_V4_ISSUER_SCHEMA_ID,
            WORLD_ID_V4_CREDENTIAL_GENESIS_ISSUED_AT_MIN,
            true
        );
        passportVerifier.setExpectedAction(passportAction);
        passportVerifier.setExpectedSignalHash(signalHash);

        vm.prank(rater);
        registry.attestWorldCredentialWithV4Proof(passportKind, passportNullifier, nonce, expiresAtMin, proof);

        RaterRegistry.WorldCredential memory credential = registry.getWorldCredential(rater, passportKind);
        assertTrue(credential.verified);
        assertFalse(credential.revoked);
        assertEq(credential.kind, passportKind);
        assertEq(credential.nullifierHash, bytes32(passportNullifier));
        assertEq(credential.scope, keccak256(abi.encode("world-id-v4", WORLD_ID_V4_RP_ID, passportAction)));
        assertTrue(registry.hasActiveCredentialKind(rater, passportKind));
        assertFalse(registry.hasActiveHumanCredential(rater));

        (uint8 activeMask, uint8 freshMask) = registry.credentialStatusBits(rater);
        assertEq(activeMask, _credentialKindBit(passportKind));
        assertEq(freshMask, 0);
    }

    function test_AttestHumanPresenceWithV4ProofStoresFreshRecheckWindow() public {
        uint8 kind = registry.WORLD_CREDENTIAL_PROOF_OF_HUMAN();
        uint256 presenceNullifier = uint256(keccak256("presence-nullifier"));
        uint256 nonce = 12;
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);
        uint256 signalHash = _worldPresenceSignalHash(rater, kind);
        uint256[5] memory proof;

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestHumanPresenceWithV4Proof(kind, presenceNullifier, nonce, expiresAtMin, proof);

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 2 hours), _emptyV4Proof()
        );
        worldIdRouter.setExpectedAction(WORLD_ID_V4_PRESENCE_ACTION);
        worldIdRouter.setExpectedSignalHash(signalHash);
        worldIdRouter.setExpectedNonce(nonce);

        vm.prank(rater);
        registry.attestHumanPresenceWithV4Proof(kind, presenceNullifier, nonce, expiresAtMin, proof);

        RaterRegistry.HumanPresence memory presence = registry.getHumanPresence(rater, kind);
        assertTrue(presence.verified);
        assertEq(presence.kind, kind);
        assertEq(presence.lastRecheckedAt, uint64(block.timestamp));
        assertEq(presence.freshUntil, uint64(block.timestamp + WORLD_ID_V4_PRESENCE_TTL));
        assertTrue(registry.hasRecentCredentialRecheck(rater, kind));

        (uint8 activeMask, uint8 freshMask) = registry.credentialStatusBits(rater);
        assertEq(activeMask, _credentialKindBit(kind));
        assertEq(freshMask, _credentialKindBit(kind));

        vm.warp(block.timestamp + WORLD_ID_V4_PRESENCE_TTL + 1);
        assertFalse(registry.hasRecentCredentialRecheck(rater, kind));
        (, freshMask) = registry.credentialStatusBits(rater);
        assertEq(freshMask, 0);
    }

    function test_HumanPresenceStopsFreshAfterCredentialExpiresBeforePresenceTtl() public {
        uint8 kind = registry.WORLD_CREDENTIAL_PROOF_OF_HUMAN();
        uint256 presenceNullifier = uint256(keccak256("presence-nullifier"));
        uint256 nonce = 12;
        uint64 credentialExpiresAt = uint64(block.timestamp + 5 minutes);
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);
        uint256[5] memory proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), 1, credentialExpiresAt, _emptyV4Proof());
        worldIdRouter.setExpectedAction(WORLD_ID_V4_PRESENCE_ACTION);
        worldIdRouter.setExpectedSignalHash(_worldPresenceSignalHash(rater, kind));
        worldIdRouter.setExpectedNonce(nonce);

        vm.prank(rater);
        registry.attestHumanPresenceWithV4Proof(kind, presenceNullifier, nonce, expiresAtMin, proof);
        assertTrue(registry.hasRecentCredentialRecheck(rater, kind));

        vm.warp(uint256(credentialExpiresAt) + 1);

        assertFalse(registry.hasActiveCredentialKind(rater, kind));
        assertFalse(registry.hasRecentCredentialRecheck(rater, kind));
        (uint8 activeMask, uint8 freshMask) = registry.credentialStatusBits(rater);
        assertEq(activeMask, 0);
        assertEq(freshMask, 0);
    }

    function test_RevokeWorldCredentialClearsActiveAndFreshPassportMasks() public {
        uint8 kind = registry.WORLD_CREDENTIAL_PASSPORT();
        uint256 credentialNullifier = uint256(keccak256("passport-nullifier"));
        uint256 presenceNullifier = uint256(keccak256("passport-presence-nullifier"));
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);
        uint256[5] memory proof;

        worldIdRouter.setExpectedAction(WORLD_ID_V4_ACTION);
        worldIdRouter.setExpectedSignalHash(_worldCredentialSignalHash(rater, kind));
        worldIdRouter.setExpectedNonce(11);
        vm.prank(rater);
        registry.attestWorldCredentialWithV4Proof(kind, credentialNullifier, 11, expiresAtMin, proof);

        worldIdRouter.setExpectedAction(WORLD_ID_V4_PRESENCE_ACTION);
        worldIdRouter.setExpectedSignalHash(_worldPresenceSignalHash(rater, kind));
        worldIdRouter.setExpectedNonce(12);
        vm.prank(rater);
        registry.attestHumanPresenceWithV4Proof(kind, presenceNullifier, 12, expiresAtMin, proof);

        (uint8 activeMask, uint8 freshMask) = registry.credentialStatusBits(rater);
        assertEq(activeMask, _credentialKindBit(kind));
        assertEq(freshMask, _credentialKindBit(kind));

        vm.prank(admin);
        registry.revokeWorldCredential(rater, kind);

        RaterRegistry.WorldCredential memory credential = registry.getWorldCredential(rater, kind);
        assertTrue(credential.revoked);
        assertFalse(registry.hasActiveCredentialKind(rater, kind));
        assertFalse(registry.hasRecentCredentialRecheck(rater, kind));
        RaterRegistry.HumanPresence memory presence = registry.getHumanPresence(rater, kind);
        assertFalse(presence.verified);
        (activeMask, freshMask) = registry.credentialStatusBits(rater);
        assertEq(activeMask, 0);
        assertEq(freshMask, 0);

        worldIdRouter.setExpectedAction(WORLD_ID_V4_ACTION);
        worldIdRouter.setExpectedSignalHash(_worldCredentialSignalHash(rater, kind));
        worldIdRouter.setExpectedNonce(13);
        vm.prank(rater);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestWorldCredentialWithV4Proof(kind, credentialNullifier, 13, expiresAtMin, proof);
    }

    function test_RevokeWorldCredentialRejectsProofOfHumanKind() public {
        uint8 kind = registry.WORLD_CREDENTIAL_PROOF_OF_HUMAN();

        vm.prank(admin);
        vm.expectRevert(RaterRegistry.UnsupportedCredentialKind.selector);
        registry.revokeWorldCredential(rater, kind);
    }

    function test_AttestHumanPresenceWithV4ProofAllowsFreshNonceForSamePresenceNullifier() public {
        uint8 kind = registry.WORLD_CREDENTIAL_PROOF_OF_HUMAN();
        uint256 presenceNullifier = uint256(keccak256("presence-nullifier"));
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);
        uint256 signalHash = _worldPresenceSignalHash(rater, kind);
        uint256[5] memory proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 2 hours), _emptyV4Proof()
        );

        worldIdRouter.setExpectedAction(WORLD_ID_V4_PRESENCE_ACTION);
        worldIdRouter.setExpectedSignalHash(signalHash);
        worldIdRouter.setExpectedNonce(1);

        vm.prank(rater);
        registry.attestHumanPresenceWithV4Proof(kind, presenceNullifier, 1, expiresAtMin, proof);

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        registry.attestHumanPresenceWithV4Proof(kind, presenceNullifier, 1, expiresAtMin, proof);

        vm.warp(block.timestamp + 5 minutes);
        worldIdRouter.setExpectedNonce(2);

        vm.prank(rater);
        registry.attestHumanPresenceWithV4Proof(kind, presenceNullifier, 2, expiresAtMin, proof);

        RaterRegistry.HumanPresence memory presence = registry.getHumanPresence(rater, kind);
        assertEq(presence.lastRecheckedAt, uint64(block.timestamp));
        assertEq(presence.freshUntil, uint64(block.timestamp + WORLD_ID_V4_PRESENCE_TTL));
    }

    function test_AttestHumanPresenceWithV4ProofRejectsPresenceNullifierOwnedByAnotherRater() public {
        uint8 kind = registry.WORLD_CREDENTIAL_PROOF_OF_HUMAN();
        uint256 presenceNullifier = uint256(keccak256("shared-presence-nullifier"));
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);
        uint256[5] memory proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 2 hours), _emptyV4Proof()
        );

        vm.prank(otherRater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(keccak256("other-presence-rater")), 2, uint64(block.timestamp + 2 hours), _emptyV4Proof()
        );

        worldIdRouter.setExpectedAction(WORLD_ID_V4_PRESENCE_ACTION);
        worldIdRouter.setExpectedSignalHash(_worldPresenceSignalHash(rater, kind));
        worldIdRouter.setExpectedNonce(3);

        vm.prank(rater);
        registry.attestHumanPresenceWithV4Proof(kind, presenceNullifier, 3, expiresAtMin, proof);

        worldIdRouter.setExpectedSignalHash(_worldPresenceSignalHash(otherRater, kind));
        worldIdRouter.setExpectedNonce(4);

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        registry.attestHumanPresenceWithV4Proof(kind, presenceNullifier, 4, expiresAtMin, proof);
    }

    function test_AttestHumanCredentialWithV4ProofBubblesInvalidProof() public {
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();
        uint256[5] memory proof;

        _configureV4Verifier(verifier);
        verifier.setShouldReject(true);

        vm.prank(rater);
        vm.expectRevert(MockWorldIDVerifier.InvalidMockWorldIdV4Proof.selector);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), 1, uint64(block.timestamp), proof);
    }

    function test_AttestHumanCredentialWithV4ProofUsesMsgSenderSignal() public {
        uint256 expectedSignalHash = _worldIdSignalHash(rater);

        assertEq(expectedSignalHash, _hashToField(abi.encodePacked(rater)));
        worldIdRouter.setExpectedSignalHash(expectedSignalHash);

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );
    }

    function test_AttestHumanCredentialWithV4ProofRejectsProofForDifferentSenderSignal() public {
        worldIdRouter.setExpectedSignalHash(_worldIdSignalHash(otherRater));

        vm.prank(rater);
        vm.expectRevert(MockWorldIDVerifier.InvalidMockWorldIdV4Proof.selector);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );
    }

    function test_AttestHumanCredentialWithV4ProofRejectsUnexpectedAction() public {
        worldIdRouter.setExpectedAction(WORLD_ID_V4_ACTION + 1);

        vm.prank(rater);
        vm.expectRevert(MockWorldIDVerifier.InvalidMockWorldIdV4Proof.selector);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );
    }

    function test_AttestHumanCredentialWithV4ProofRejectsReusedNullifier() public {
        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );
    }

    function test_AttestHumanCredentialWithV4ProofRejectsSameProofReplayByOwner() public {
        uint64 expiresAtMin = uint64(block.timestamp + 1 hours);

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), 1, expiresAtMin, _emptyV4Proof());

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), 1, expiresAtMin, _emptyV4Proof());

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), 2, expiresAtMin, _emptyV4Proof());
    }

    function test_AttestHumanCredentialWithV4ProofRejectsIdentitySwitchWhileActive() public {
        vm.startPrank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestHumanCredentialWithV4Proof(
            uint256(keccak256("other-nullifier")), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );
        vm.stopPrank();
    }

    function test_RevokeHumanCredentialClearsNullifierOwner() public {
        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        vm.prank(admin);
        registry.revokeHumanCredential(rater);

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(rater);
        assertTrue(credential.revoked);
        assertFalse(registry.hasActiveHumanCredential(rater));
    }

    function test_RevokeHumanCredentialBlocksNullifierReuseUntilCleared() public {
        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        vm.prank(admin);
        registry.revokeHumanCredential(rater);

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 2, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 3, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        vm.prank(admin);
        registry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH);

        vm.prank(otherRater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 4, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );
    }

    function test_RevokeV4CredentialBlocksReuseUntilCleared() public {
        uint256[5] memory v4Proof;

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        assertTrue(registry.hasActiveHumanCredential(rater));

        vm.prank(admin);
        registry.revokeHumanCredential(rater);

        assertFalse(registry.hasActiveHumanCredential(rater));
        assertTrue(registry.getHumanCredential(rater).revoked);
        vm.prank(otherRater);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 2, uint64(block.timestamp + 1 hours), v4Proof
        );

        vm.prank(admin);
        registry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH);

        vm.prank(otherRater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 3, uint64(block.timestamp + 1 hours), v4Proof
        );
        assertTrue(registry.hasActiveHumanCredential(otherRater));
    }

    function test_RevokeV4SetsV4RevocationSlot() public {
        MockWorldIDVerifier verifier = new MockWorldIDVerifier();
        uint256[5] memory proof;

        _configureV4Verifier(verifier);
        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), proof);

        vm.prank(admin);
        registry.revokeHumanCredential(rater);

        vm.prank(admin);
        registry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH);
    }

    function test_SwitchingProviderClearsOldProviderNullifierSlot() public {
        // Codex PR #10 regression: when a rater re-attests under a different provider but reuses
        // the same nullifier bytes, the old (provider, nullifier) slot was leaking. After a later
        // revocation -- which only clears the current provider's slot -- a future attestation by
        // someone else under the old provider would falsely revert with NullifierAlreadyAssigned.
        bytes32 anchorId = NULLIFIER_HASH; // same bytes, different provider

        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );
        bytes32 v4WorldIdKey = _credentialKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH);
        assertEq(registry.resolveRater(rater).identityKey, v4WorldIdKey);

        // Switch the rater to the RateLoop seed provider while keeping the nullifier bytes the same.
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 30 days), anchorId, EVIDENCE_HASH);
        bytes32 seededKey = _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, anchorId);

        // The old WorldIdV4 slot must be cleared by the switch -- not waiting for a revoke.
        assertEq(registry.resolveRater(rater).identityKey, seededKey);

        // A different rater can now claim the nullifier under the old provider.
        vm.prank(otherRater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );
        assertEq(registry.resolveRater(otherRater).identityKey, v4WorldIdKey);
        assertTrue(registry.resolveRater(rater).identityKey != registry.resolveRater(otherRater).identityKey);
    }

    function test_CredentialIdentityKeysAreProviderNamespaced() public {
        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        vm.prank(admin);
        registry.seedHumanCredential(otherRater, uint64(block.timestamp + 30 days), NULLIFIER_HASH, EVIDENCE_HASH);

        IRaterIdentityRegistry.ResolvedRater memory worldIdRater = registry.resolveRater(rater);
        IRaterIdentityRegistry.ResolvedRater memory seededRater = registry.resolveRater(otherRater);

        assertEq(worldIdRater.humanNullifier, NULLIFIER_HASH);
        assertEq(seededRater.humanNullifier, NULLIFIER_HASH);
        assertEq(
            worldIdRater.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH)
        );
        assertEq(
            seededRater.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, NULLIFIER_HASH)
        );
        assertTrue(worldIdRater.identityKey != seededRater.identityKey);
    }

    function test_CredentialProviderSwitchRotatesCanonicalIdentityKey() public {
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 1), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        IRaterIdentityRegistry.ResolvedRater memory first = registry.resolveRater(rater);
        assertEq(first.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID));

        vm.warp(block.timestamp + 2);
        vm.prank(rater);
        registry.attestHumanCredentialWithV4Proof(
            uint256(NULLIFIER_HASH), 1, uint64(block.timestamp + 1 hours), _emptyV4Proof()
        );

        IRaterIdentityRegistry.ResolvedRater memory refreshed = registry.resolveRater(rater);
        assertEq(refreshed.humanNullifier, NULLIFIER_HASH);
        assertEq(refreshed.identityKey, _credentialKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, NULLIFIER_HASH));
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

    function test_UnbanClearsStaleAddressBanAfterNullifierRecycle() public {
        MockConfidentialityNexus nexus = new MockConfidentialityNexus();
        nexus.setNexus(uint8(RaterRegistry.HumanCredentialProvider.SeededHuman), SEEDED_ANCHOR_ID, true);

        vm.prank(admin);
        registry.setConfidentialityEscrow(address(nexus));
        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 365 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        bytes32 credentialKey = _credentialKey(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID);
        bytes32 oldAddressKey = registry.addressIdentityKey(rater);
        bytes32 newAddressKey = registry.addressIdentityKey(otherRater);

        vm.prank(governance);
        registry.banIdentity(
            RaterRegistry.HumanCredentialProvider.SeededHuman,
            SEEDED_ANCHOR_ID,
            uint64(block.timestamp + 30 days),
            "verified leak",
            EVIDENCE_HASH
        );
        assertTrue(registry.isIdentityKeyBanned(credentialKey));
        assertTrue(registry.isIdentityKeyBanned(oldAddressKey));

        vm.startPrank(admin);
        registry.revokeHumanCredential(rater);
        registry.clearRevokedHumanNullifier(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID);
        registry.seedHumanCredential(otherRater, uint64(block.timestamp + 365 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);
        vm.stopPrank();
        assertTrue(registry.isIdentityKeyBanned(oldAddressKey));
        assertTrue(registry.isIdentityKeyBanned(newAddressKey));

        vm.prank(governance);
        registry.unbanIdentity(RaterRegistry.HumanCredentialProvider.SeededHuman, SEEDED_ANCHOR_ID);

        assertFalse(registry.isIdentityKeyBanned(credentialKey));
        assertFalse(registry.isIdentityKeyBanned(oldAddressKey));
        assertFalse(registry.isIdentityKeyBanned(newAddressKey));
    }

    /// @notice RR-4 (2026-05-20 follow-up audit): governance can cap the SEEDER-seeded credential
    ///         TTL, mirroring the immutable WorldID TTL cap. cap=0 is an explicit opt-out.
    function test_MaxSeededCredentialTtlClampsSeedExpiry() public {
        assertEq(registry.maxSeededCredentialTtl(), WORLD_ID_CREDENTIAL_TTL);

        // Default: seeded credentials are capped to the World ID TTL.
        vm.prank(admin);
        vm.expectRevert(RaterRegistry.InvalidCredential.selector);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 100 * 365 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

        vm.prank(admin);
        registry.seedHumanCredential(rater, uint64(block.timestamp + 365 days), SEEDED_ANCHOR_ID, EVIDENCE_HASH);

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

    function test_PendingInboundDelegateIsClearedWhenOpeningOutboundRequest() public {
        vm.prank(rater);
        registry.setDelegate(otherRater);

        vm.prank(otherRater);
        registry.setDelegate(subject);

        assertEq(registry.pendingDelegateOf(otherRater), address(0));
        assertEq(registry.pendingDelegateTo(rater), address(0));
        assertEq(registry.pendingDelegateTo(otherRater), subject);
        assertEq(registry.pendingDelegateOf(subject), otherRater);

        vm.prank(rater);
        vm.expectRevert(RaterRegistry.NoPendingDelegate.selector);
        registry.acceptDelegate();
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
