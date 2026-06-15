// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { RaterRegistry } from "../RaterRegistry.sol";

/// @title RaterRegistryWorldIdLib
/// @notice World ID v4 credential and presence attestation logic for RaterRegistry.
library RaterRegistryWorldIdLib {
    uint8 internal constant WORLD_CREDENTIAL_SELFIE = 1;
    uint8 internal constant WORLD_CREDENTIAL_PASSPORT = 2;
    uint8 internal constant WORLD_CREDENTIAL_PROOF_OF_HUMAN = 3;

    struct PendingHumanAttest {
        bytes32 nullifierHash;
        bytes32 scope;
        uint64 expiresAt;
        bytes32 evidenceHash;
    }

    event WorldCredentialVerified(
        address indexed rater,
        uint8 indexed kind,
        bytes32 indexed nullifierHash,
        bytes32 scope,
        uint64 verifiedAt,
        uint64 expiresAt,
        bytes32 evidenceHash
    );
    event HumanPresenceVerified(
        address indexed rater,
        uint8 indexed kind,
        bytes32 indexed nullifierHash,
        uint64 lastRecheckedAt,
        uint64 freshUntil,
        bytes32 evidenceHash
    );

    error InvalidAddress();
    error InvalidCredential();
    error NullifierAlreadyAssigned();
    error WorldIdV4VerifierNotConfigured();
    error UnsupportedCredentialKind();

    function isSupportedWorldCredentialKind(uint8 kind) external pure returns (bool) {
        return _isSupportedWorldCredentialKind(kind);
    }

    function worldIdSignalHash(address rater) external pure returns (uint256) {
        return _hashToField(abi.encodePacked(rater));
    }

    function worldCredentialSignalHash(address rater, uint8 kind) external pure returns (uint256) {
        return _hashToField(abi.encodePacked("rateloop-world-credential-v1", rater, kind));
    }

    function worldPresenceSignalHash(address rater, uint8 kind) external pure returns (uint256) {
        return _hashToField(abi.encodePacked("rateloop-world-presence-v1", rater, kind));
    }

    function attestWorldCredentialWithV4Proof(
        address rater,
        uint8 kind,
        uint256 nullifier,
        uint256 nonce,
        uint64 expiresAtMin,
        uint256[5] calldata proof,
        uint256 signalHash,
        mapping(uint8 => RaterRegistry.WorldIdV4Config) storage worldCredentialConfigs,
        RaterRegistry.HumanCredential storage humanCredential,
        mapping(uint8 => RaterRegistry.WorldCredential) storage worldCredentials,
        mapping(
            RaterRegistry.HumanCredentialProvider => mapping(bytes32 => address)
        ) storage humanNullifierOwnerByProvider,
        mapping(uint8 => mapping(bytes32 => address)) storage worldCredentialNullifierOwner,
        mapping(uint8 => mapping(bytes32 => bool)) storage revokedWorldCredentialNullifier,
        mapping(uint8 => mapping(bytes32 => bool)) storage usedWorldCredentialProof
    ) external returns (PendingHumanAttest memory pending, bool isPendingHuman) {
        if (!_isSupportedWorldCredentialKind(kind)) revert UnsupportedCredentialKind();
        RaterRegistry.WorldIdV4Config storage config = worldCredentialConfigs[kind];
        if (!config.enabled || address(config.verifier) == address(0)) revert WorldIdV4VerifierNotConfigured();
        if (nullifier == 0) revert InvalidCredential();
        bytes32 storedNullifier = bytes32(nullifier);

        if (kind == WORLD_CREDENTIAL_PROOF_OF_HUMAN) {
            RaterRegistry.HumanCredential storage previous = humanCredential;
            if (
                previous.verified && !previous.revoked && previous.expiresAt > block.timestamp
                    && previous.nullifierHash != storedNullifier
            ) {
                revert InvalidCredential();
            }
            address currentHumanOwner =
                humanNullifierOwnerByProvider[RaterRegistry.HumanCredentialProvider.WorldIdV4][storedNullifier];
            if (currentHumanOwner != address(0) && currentHumanOwner != rater) revert NullifierAlreadyAssigned();
        } else {
            RaterRegistry.WorldCredential storage previousCredential = worldCredentials[kind];
            if (
                previousCredential.verified && !previousCredential.revoked
                    && previousCredential.expiresAt > block.timestamp
                    && previousCredential.nullifierHash != storedNullifier
            ) {
                revert InvalidCredential();
            }
            address currentOwner = worldCredentialNullifierOwner[kind][storedNullifier];
            if (currentOwner != address(0) && currentOwner != rater) revert NullifierAlreadyAssigned();
            if (revokedWorldCredentialNullifier[kind][storedNullifier]) revert InvalidCredential();
        }

        bytes32 proofReplayKey = keccak256(
            abi.encode(
                "world-id-v4-credential-proof",
                kind,
                block.chainid,
                address(config.verifier),
                config.rpId,
                config.action,
                config.issuerSchemaId,
                config.credentialGenesisIssuedAtMin,
                storedNullifier,
                nonce,
                signalHash,
                expiresAtMin
            )
        );
        if (usedWorldCredentialProof[kind][proofReplayKey]) revert NullifierAlreadyAssigned();

        uint64 expiresAt = _verifyWorldIdV4Proof(config, nullifier, nonce, signalHash, expiresAtMin, proof);
        usedWorldCredentialProof[kind][proofReplayKey] = true;

        bytes32 evidenceHash = keccak256(
            abi.encodePacked(
                "world-id-v4",
                kind,
                block.chainid,
                address(config.verifier),
                config.rpId,
                config.action,
                nonce,
                signalHash,
                expiresAtMin
            )
        );
        bytes32 scope = _worldCredentialScope(config.rpId, config.action);
        if (kind == WORLD_CREDENTIAL_PROOF_OF_HUMAN) {
            pending = PendingHumanAttest({
                nullifierHash: storedNullifier, scope: scope, expiresAt: expiresAt, evidenceHash: evidenceHash
            });
            return (pending, true);
        }
        _attestWorldCredential(
            rater,
            kind,
            storedNullifier,
            scope,
            expiresAt,
            evidenceHash,
            worldCredentials,
            worldCredentialNullifierOwner,
            revokedWorldCredentialNullifier
        );
    }

    function attestHumanPresenceWithV4Proof(
        address rater,
        uint8 kind,
        uint256 nullifier,
        uint256 nonce,
        uint64 expiresAtMin,
        uint256[5] calldata proof,
        mapping(uint8 => RaterRegistry.WorldIdV4Config) storage worldPresenceConfigs,
        mapping(
            uint8 => mapping(bytes32 => address)
        ) storage worldPresenceNullifierOwner,
        mapping(uint8 => mapping(bytes32 => bool)) storage usedWorldPresenceProof,
        mapping(uint8 => RaterRegistry.HumanPresence) storage humanPresence
    ) external {
        if (!_isSupportedWorldCredentialKind(kind)) revert UnsupportedCredentialKind();
        RaterRegistry.WorldIdV4Config storage config = worldPresenceConfigs[kind];
        if (!config.enabled || address(config.verifier) == address(0)) revert WorldIdV4VerifierNotConfigured();
        if (nullifier == 0) revert InvalidCredential();
        bytes32 storedNullifier = bytes32(nullifier);
        address presenceNullifierOwner = worldPresenceNullifierOwner[kind][storedNullifier];
        if (presenceNullifierOwner != address(0) && presenceNullifierOwner != rater) {
            revert NullifierAlreadyAssigned();
        }

        uint256 signalHash = _worldPresenceSignalHash(rater, kind);
        bytes32 proofReplayKey = keccak256(
            abi.encode(
                "world-id-v4-presence-proof",
                kind,
                block.chainid,
                address(config.verifier),
                config.rpId,
                config.action,
                config.issuerSchemaId,
                config.credentialGenesisIssuedAtMin,
                storedNullifier,
                nonce,
                signalHash,
                expiresAtMin
            )
        );
        if (usedWorldPresenceProof[kind][proofReplayKey]) revert NullifierAlreadyAssigned();

        uint64 freshUntil = _verifyWorldIdV4Proof(config, nullifier, nonce, signalHash, expiresAtMin, proof);
        bytes32 evidenceHash = keccak256(
            abi.encodePacked(
                "world-id-v4-presence",
                kind,
                block.chainid,
                address(config.verifier),
                config.rpId,
                config.action,
                nonce,
                signalHash,
                expiresAtMin
            )
        );

        usedWorldPresenceProof[kind][proofReplayKey] = true;
        worldPresenceNullifierOwner[kind][storedNullifier] = rater;
        humanPresence[kind] = RaterRegistry.HumanPresence({
            verified: true,
            kind: kind,
            lastRecheckedAt: uint64(block.timestamp),
            freshUntil: freshUntil,
            evidenceHash: evidenceHash
        });
        emit HumanPresenceVerified(rater, kind, storedNullifier, uint64(block.timestamp), freshUntil, evidenceHash);
    }

    function _verifyWorldIdV4Proof(
        RaterRegistry.WorldIdV4Config storage config,
        uint256 nullifier,
        uint256 nonce,
        uint256 signalHash,
        uint64 expiresAtMin,
        uint256[5] calldata proof
    ) private view returns (uint64) {
        config.verifier
            .verify(
                nullifier,
                config.action,
                config.rpId,
                nonce,
                signalHash,
                expiresAtMin,
                config.issuerSchemaId,
                config.credentialGenesisIssuedAtMin,
                proof
            );

        if (expiresAtMin <= block.timestamp) revert InvalidCredential();
        uint256 ttlExpiresAt = block.timestamp + config.ttl;
        if (ttlExpiresAt > type(uint64).max) revert InvalidCredential();
        return expiresAtMin < ttlExpiresAt ? expiresAtMin : uint64(ttlExpiresAt);
    }

    function _attestWorldCredential(
        address rater,
        uint8 kind,
        bytes32 nullifierHash,
        bytes32 scope,
        uint64 expiresAt,
        bytes32 evidenceHash,
        mapping(uint8 => RaterRegistry.WorldCredential) storage worldCredentials,
        mapping(uint8 => mapping(bytes32 => address)) storage worldCredentialNullifierOwner,
        mapping(uint8 => mapping(bytes32 => bool)) storage revokedWorldCredentialNullifier
    ) private {
        if (rater == address(0)) revert InvalidAddress();
        if (!_isSupportedWorldCredentialKind(kind)) revert UnsupportedCredentialKind();
        if (expiresAt <= block.timestamp || nullifierHash == bytes32(0) || scope == bytes32(0)) {
            revert InvalidCredential();
        }
        if (revokedWorldCredentialNullifier[kind][nullifierHash]) revert InvalidCredential();

        RaterRegistry.WorldCredential storage previous = worldCredentials[kind];
        if (
            previous.nullifierHash != bytes32(0) && previous.nullifierHash != nullifierHash
                && worldCredentialNullifierOwner[kind][previous.nullifierHash] == rater
        ) {
            delete worldCredentialNullifierOwner[kind][previous.nullifierHash];
        }

        address currentOwner = worldCredentialNullifierOwner[kind][nullifierHash];
        if (currentOwner != address(0) && currentOwner != rater) revert NullifierAlreadyAssigned();
        worldCredentialNullifierOwner[kind][nullifierHash] = rater;

        worldCredentials[kind] = RaterRegistry.WorldCredential({
            verified: true,
            revoked: false,
            kind: kind,
            nullifierHash: nullifierHash,
            scope: scope,
            verifiedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            evidenceHash: evidenceHash
        });
        emit WorldCredentialVerified(
            rater, kind, nullifierHash, scope, uint64(block.timestamp), expiresAt, evidenceHash
        );
    }

    function _isSupportedWorldCredentialKind(uint8 kind) private pure returns (bool) {
        return
            kind == WORLD_CREDENTIAL_SELFIE || kind == WORLD_CREDENTIAL_PASSPORT
                || kind == WORLD_CREDENTIAL_PROOF_OF_HUMAN;
    }

    function _worldPresenceSignalHash(address rater, uint8 kind) private pure returns (uint256) {
        return _hashToField(abi.encodePacked("rateloop-world-presence-v1", rater, kind));
    }

    function _worldCredentialScope(uint64 rpId, uint256 action) private pure returns (bytes32) {
        if (rpId == 0 || action == 0) return bytes32(0);
        return keccak256(abi.encode("world-id-v4", rpId, action));
    }

    function _hashToField(bytes memory value) private pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }
}
