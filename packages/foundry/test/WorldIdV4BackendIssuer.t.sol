// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {LaunchDistributionPool} from "../contracts/LaunchDistributionPool.sol";
import {LoopReputation} from "../contracts/LoopReputation.sol";
import {RaterRegistry} from "../contracts/RaterRegistry.sol";
import {WorldIdV4BackendIssuer} from "../contracts/WorldIdV4BackendIssuer.sol";
import {IWorldIdV4BackendIssuer} from "../contracts/interfaces/IWorldIdV4BackendIssuer.sol";
import {IRaterIdentityRegistry} from "../contracts/interfaces/IRaterIdentityRegistry.sol";
import {MockWorldIDVerifier} from "../contracts/mocks/MockWorldIDVerifier.sol";

contract WorldIdV4BackendIssuerTest is Test {
    uint256 internal constant BASE_CHAIN_ID = 8453;
    uint64 internal constant RP_ID = 42;
    uint256 internal constant ACTION = uint256(keccak256("rateloop-human-credential-v4"));
    uint256 internal constant PRESENCE_ACTION = uint256(keccak256("rateloop-human-presence-v1"));
    uint64 internal constant CREDENTIAL_TTL = 30 days;
    uint64 internal constant BRIDGE_TTL = 7 days;
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant OTHER_SIGNER_KEY = 0xB0B;

    address internal signer;
    address internal alice = address(0xA11CE5);
    address internal bob = address(0xB0B5);

    MockWorldIDVerifier internal verifier;
    RaterRegistry internal registry;
    WorldIdV4BackendIssuer internal issuer;

    function setUp() public {
        vm.chainId(BASE_CHAIN_ID);
        vm.warp(1_800_000_000);
        signer = vm.addr(SIGNER_KEY);
        verifier = new MockWorldIDVerifier();
        registry = new RaterRegistry(
            address(this),
            address(this),
            address(verifier),
            RP_ID,
            ACTION,
            PRESENCE_ACTION,
            CREDENTIAL_TTL,
            15 minutes,
            7,
            0
        );
        issuer = new WorldIdV4BackendIssuer(address(registry), address(this), signer, RP_ID, ACTION, BRIDGE_TTL, 10);
        registry.grantRole(registry.SEEDER_ROLE(), address(issuer));
    }

    function test_IssuesWorldIdV4CredentialAndAliasesDirectWorldIdKeys() public {
        bytes32 nullifierHash = keccak256("alice-world-v4");
        IWorldIdV4BackendIssuer.Issuance memory issuance = _issuance(alice, nullifierHash, 1);

        issuer.issue(issuance, _sign(issuance, SIGNER_KEY));

        RaterRegistry.HumanCredential memory credential = registry.getHumanCredential(alice);
        assertTrue(credential.verified);
        assertFalse(credential.revoked);
        assertEq(uint256(credential.provider), uint256(RaterRegistry.HumanCredentialProvider.WorldIdV4));
        assertEq(credential.nullifierHash, nullifierHash);
        assertEq(credential.scope, keccak256(abi.encode("world-id-v4", RP_ID, ACTION)));
        assertEq(credential.evidenceHash, issuance.evidenceHash);

        bytes32 v4IdentityKey =
            registry.credentialIdentityKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, nullifierHash);
        assertEq(
            v4IdentityKey, registry.credentialIdentityKey(RaterRegistry.HumanCredentialProvider.WorldId, nullifierHash)
        );
        assertEq(
            registry.launchHumanIdentityKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, nullifierHash),
            registry.launchHumanIdentityKey(RaterRegistry.HumanCredentialProvider.WorldId, nullifierHash)
        );
        assertTrue(
            registry.launchHumanIdentityKey(RaterRegistry.HumanCredentialProvider.SeededHuman, nullifierHash)
                != registry.launchHumanIdentityKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, nullifierHash)
        );

        IRaterIdentityRegistry.ResolvedRater memory resolved = registry.resolveRater(alice);
        assertEq(resolved.identityKey, v4IdentityKey);
        assertEq(resolved.humanNullifier, nullifierHash);
        assertTrue(resolved.hasActiveHumanCredential);
    }

    function test_RegistryBridgeEntryPointRequiresSeederRole() public {
        bytes32 seederRole = registry.SEEDER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, seederRole)
        );
        vm.prank(alice);
        registry.recordBackendVerifiedWorldIdV4Credential(
            alice, RP_ID, ACTION, keccak256("nullifier"), keccak256("evidence"), uint64(block.timestamp + 1 days)
        );
    }

    function test_DeploysAndIssuesWhileDirectV4VerifierConfigIsDisabled() public {
        RaterRegistry disabledRegistry =
            new RaterRegistry(address(this), address(this), address(0), 0, 0, 0, 0, 0, 0, 0);
        disabledRegistry.setMaxSeededCredentialTtl(CREDENTIAL_TTL);

        assertEq(address(disabledRegistry.worldIdV4Verifier()), address(0));
        assertEq(disabledRegistry.worldIdV4RpId(), 0);
        assertEq(disabledRegistry.worldIdV4Action(), 0);
        assertEq(disabledRegistry.worldIdV4CredentialTtl(), 0);

        WorldIdV4BackendIssuer disabledConfigIssuer =
            new WorldIdV4BackendIssuer(address(disabledRegistry), address(this), signer, RP_ID, ACTION, BRIDGE_TTL, 1);
        disabledRegistry.grantRole(disabledRegistry.SEEDER_ROLE(), address(disabledConfigIssuer));

        bytes32 nullifierHash = keccak256("disabled-config-world-v4");
        IWorldIdV4BackendIssuer.Issuance memory issuance = IWorldIdV4BackendIssuer.Issuance({
            chainId: BASE_CHAIN_ID,
            registry: address(disabledRegistry),
            rpId: RP_ID,
            action: ACTION,
            rater: alice,
            nullifierHash: nullifierHash,
            evidenceHash: keccak256("disabled-config-evidence"),
            expiresAt: uint64(block.timestamp + 1 days),
            nonce: 2,
            deadline: block.timestamp + 1 hours
        });
        bytes32 digest = disabledConfigIssuer.issuanceDigest(issuance);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);

        disabledConfigIssuer.issue(issuance, abi.encodePacked(r, s, v));

        RaterRegistry.HumanCredential memory credential = disabledRegistry.getHumanCredential(alice);
        assertTrue(credential.verified);
        assertEq(uint256(credential.provider), uint256(RaterRegistry.HumanCredentialProvider.WorldIdV4));
        assertEq(credential.nullifierHash, nullifierHash);
        assertEq(credential.scope, keccak256(abi.encode("world-id-v4", RP_ID, ACTION)));
    }

    function test_ReplayAndDuplicateNullifierAreRejectedWithoutConsumingFailedNonce() public {
        bytes32 nullifierHash = keccak256("shared-world-v4");
        IWorldIdV4BackendIssuer.Issuance memory first = _issuance(alice, nullifierHash, 10);
        bytes memory firstSignature = _sign(first, SIGNER_KEY);
        issuer.issue(first, firstSignature);

        vm.expectRevert(WorldIdV4BackendIssuer.NonceAlreadyUsed.selector);
        issuer.issue(first, firstSignature);

        IWorldIdV4BackendIssuer.Issuance memory duplicate = _issuance(bob, nullifierHash, 11);
        bytes memory duplicateSignature = _sign(duplicate, SIGNER_KEY);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        issuer.issue(duplicate, duplicateSignature);

        assertFalse(issuer.usedNonces(11));
        assertEq(issuer.issuedCount(), 1);
    }

    function test_RejectsWrongChainRegistryOrRpActionDomain() public {
        IWorldIdV4BackendIssuer.Issuance memory issuance = _issuance(alice, keccak256("domain"), 20);

        issuance.chainId = 1;
        bytes memory signature = _sign(issuance, SIGNER_KEY);
        vm.expectRevert(WorldIdV4BackendIssuer.InvalidDomain.selector);
        issuer.issue(issuance, signature);

        issuance = _issuance(alice, keccak256("domain"), 21);
        issuance.registry = address(0xBEEF);
        signature = _sign(issuance, SIGNER_KEY);
        vm.expectRevert(WorldIdV4BackendIssuer.InvalidDomain.selector);
        issuer.issue(issuance, signature);

        issuance = _issuance(alice, keccak256("domain"), 22);
        issuance.action = ACTION + 1;
        signature = _sign(issuance, SIGNER_KEY);
        vm.expectRevert(WorldIdV4BackendIssuer.InvalidDomain.selector);
        issuer.issue(issuance, signature);
    }

    function test_RejectsExpiredDeadlineCredentialAndExcessiveTtl() public {
        IWorldIdV4BackendIssuer.Issuance memory issuance = _issuance(alice, keccak256("deadline"), 30);
        issuance.deadline = block.timestamp - 1;
        bytes memory signature = _sign(issuance, SIGNER_KEY);
        vm.expectRevert(WorldIdV4BackendIssuer.SignatureExpired.selector);
        issuer.issue(issuance, signature);

        issuance = _issuance(alice, keccak256("expired"), 31);
        issuance.expiresAt = uint64(block.timestamp - 1);
        signature = _sign(issuance, SIGNER_KEY);
        vm.expectRevert(WorldIdV4BackendIssuer.CredentialExpired.selector);
        issuer.issue(issuance, signature);

        issuance = _issuance(alice, keccak256("ttl"), 32);
        issuance.expiresAt = uint64(block.timestamp + BRIDGE_TTL + 1);
        signature = _sign(issuance, SIGNER_KEY);
        vm.expectRevert(WorldIdV4BackendIssuer.CredentialTtlTooLong.selector);
        issuer.issue(issuance, signature);
    }

    function test_RejectsSignerWithoutRole() public {
        IWorldIdV4BackendIssuer.Issuance memory issuance = _issuance(alice, keccak256("signer"), 40);
        bytes memory signature = _sign(issuance, OTHER_SIGNER_KEY);

        vm.expectRevert(WorldIdV4BackendIssuer.InvalidSigner.selector);
        issuer.issue(issuance, signature);
    }

    function test_GovernancePauseAndIssuanceCap() public {
        IWorldIdV4BackendIssuer.Issuance memory first = _issuance(alice, keccak256("alice"), 50);
        bytes memory firstSignature = _sign(first, SIGNER_KEY);

        issuer.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        issuer.issue(first, firstSignature);

        issuer.unpause();
        issuer.setIssuanceCap(1);
        issuer.issue(first, firstSignature);

        IWorldIdV4BackendIssuer.Issuance memory second = _issuance(bob, keccak256("bob"), 51);
        bytes memory secondSignature = _sign(second, SIGNER_KEY);
        vm.expectRevert(WorldIdV4BackendIssuer.IssuanceCapReached.selector);
        issuer.issue(second, secondSignature);

        issuer.setIssuanceCap(2);
        issuer.issue(second, secondSignature);
        assertEq(issuer.issuedCount(), 2);

        vm.expectRevert(WorldIdV4BackendIssuer.InvalidIssuanceCap.selector);
        issuer.setIssuanceCap(1);
    }

    function test_BridgedCredentialCannotDuplicateBonusThroughDirectV4Path() public {
        bytes32 nullifierHash = keccak256("one-human-one-launch-bonus");
        IWorldIdV4BackendIssuer.Issuance memory issuance = _issuance(alice, nullifierHash, 60);
        issuer.issue(issuance, _sign(issuance, SIGNER_KEY));

        LoopReputation lrep = new LoopReputation(address(this), address(this));
        LaunchDistributionPool pool = new LaunchDistributionPool(address(lrep), address(registry), address(this));
        registry.grantRole(registry.LAUNCH_CONSUMER_ROLE(), address(pool));
        lrep.mint(address(this), pool.TOTAL_POOL_AMOUNT());
        lrep.approve(address(pool), pool.TOTAL_POOL_AMOUNT());
        pool.depositPool(pool.TOTAL_POOL_AMOUNT());

        vm.prank(alice);
        assertGt(pool.claimVerifiedBonus(address(0)), 0);
        bytes32 launchKey =
            registry.launchHumanIdentityKey(RaterRegistry.HumanCredentialProvider.WorldIdV4, nullifierHash);
        assertTrue(pool.verifiedCredentialClaimed(launchKey));

        uint256[5] memory proof;
        vm.prank(bob);
        vm.expectRevert(RaterRegistry.NullifierAlreadyAssigned.selector);
        registry.attestHumanCredentialWithV4Proof(uint256(nullifierHash), 1, uint64(block.timestamp + 1 days), proof);
        assertEq(lrep.balanceOf(bob), 0);
    }

    function test_ConstructorRejectsNonBaseChain() public {
        vm.chainId(1);
        vm.expectRevert(WorldIdV4BackendIssuer.InvalidDomain.selector);
        new WorldIdV4BackendIssuer(address(registry), address(this), signer, RP_ID, ACTION, BRIDGE_TTL, 10);
    }

    function test_ConstructorRejectsTtlAboveRegistrySeededCap() public {
        vm.expectRevert(WorldIdV4BackendIssuer.CredentialTtlTooLong.selector);
        new WorldIdV4BackendIssuer(address(registry), address(this), signer, RP_ID, ACTION, CREDENTIAL_TTL + 1, 10);
    }

    function _issuance(address rater, bytes32 nullifierHash, uint256 nonce)
        internal
        view
        returns (IWorldIdV4BackendIssuer.Issuance memory issuance)
    {
        issuance = IWorldIdV4BackendIssuer.Issuance({
            chainId: BASE_CHAIN_ID,
            registry: address(registry),
            rpId: RP_ID,
            action: ACTION,
            rater: rater,
            nullifierHash: nullifierHash,
            evidenceHash: keccak256(abi.encode("world-id-v4-backend-evidence", rater, nullifierHash)),
            expiresAt: uint64(block.timestamp + 1 days),
            nonce: nonce,
            deadline: block.timestamp + 1 hours
        });
    }

    function _sign(IWorldIdV4BackendIssuer.Issuance memory issuance, uint256 privateKey)
        internal
        view
        returns (bytes memory signature)
    {
        bytes32 digest = issuer.issuanceDigest(issuance);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
