// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {RaterRegistry} from "./RaterRegistry.sol";
import {IWorldIdV4BackendIssuer} from "./interfaces/IWorldIdV4BackendIssuer.sol";

/// @title WorldIdV4BackendIssuer
/// @notice Narrow bridge from backend-verified World ID v4 credentials into RaterRegistry.
/// @dev Governance grants this contract RaterRegistry.SEEDER_ROLE after deployment. The
///      backend signer never receives registry privileges directly.
contract WorldIdV4BackendIssuer is AccessControl, EIP712, Pausable, IWorldIdV4BackendIssuer {
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    uint256 public constant BASE_CHAIN_ID = 8453;
    bytes32 public constant ISSUANCE_TYPEHASH = keccak256(
        "Issuance(uint256 chainId,address registry,uint64 rpId,uint256 action,address rater,bytes32 nullifierHash,bytes32 evidenceHash,uint64 expiresAt,uint256 nonce,uint256 deadline)"
    );

    RaterRegistry public immutable registry;
    uint64 public immutable rpId;
    uint256 public immutable action;
    uint64 public immutable maxCredentialTtl;

    uint256 public issuanceCap;
    uint256 public issuedCount;
    mapping(uint256 => bool) public usedNonces;

    event CredentialIssued(
        address indexed rater,
        bytes32 indexed nullifierHash,
        address indexed signer,
        uint256 nonce,
        uint64 expiresAt,
        bytes32 evidenceHash
    );
    event IssuanceCapUpdated(uint256 previousCap, uint256 newCap);

    error InvalidAddress();
    error InvalidDomain();
    error InvalidIssuance();
    error InvalidSigner();
    error SignatureExpired();
    error CredentialExpired();
    error CredentialTtlTooLong();
    error NonceAlreadyUsed();
    error IssuanceCapReached();
    error InvalidIssuanceCap();
    error SeederRoleMissing();

    constructor(
        address registry_,
        address governance,
        address initialSigner,
        uint64 rpId_,
        uint256 action_,
        uint64 maxCredentialTtl_,
        uint256 issuanceCap_
    ) EIP712("RateLoop World ID v4 Backend Issuer", "1") {
        if (block.chainid != BASE_CHAIN_ID) revert InvalidDomain();
        if (
            registry_ == address(0) || registry_.code.length == 0 || governance == address(0)
                || initialSigner == address(0)
        ) {
            revert InvalidAddress();
        }
        if (rpId_ == 0 || action_ == 0 || maxCredentialTtl_ == 0) revert InvalidIssuance();

        RaterRegistry registryContract = RaterRegistry(registry_);
        uint64 registryTtlCap = registryContract.maxSeededCredentialTtl();
        if (registryTtlCap != 0 && maxCredentialTtl_ > registryTtlCap) revert CredentialTtlTooLong();

        registry = registryContract;
        rpId = rpId_;
        action = action_;
        maxCredentialTtl = maxCredentialTtl_;
        issuanceCap = issuanceCap_;

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(GOVERNANCE_ROLE, governance);
        _grantRole(SIGNER_ROLE, initialSigner);
    }

    function issue(Issuance calldata issuance, bytes calldata signature) external override whenNotPaused {
        _validateDomain(issuance);
        if (issuance.rater == address(0) || issuance.nullifierHash == bytes32(0) || issuance.evidenceHash == bytes32(0))
        {
            revert InvalidIssuance();
        }
        if (block.timestamp > issuance.deadline) revert SignatureExpired();
        if (issuance.expiresAt <= block.timestamp) revert CredentialExpired();
        if (issuance.deadline > issuance.expiresAt) revert InvalidIssuance();
        if (uint256(issuance.expiresAt) > block.timestamp + uint256(maxCredentialTtl)) {
            revert CredentialTtlTooLong();
        }
        if (usedNonces[issuance.nonce]) revert NonceAlreadyUsed();
        if (issuedCount >= issuanceCap) revert IssuanceCapReached();
        if (!registry.hasRole(registry.SEEDER_ROLE(), address(this))) revert SeederRoleMissing();

        bytes32 digest = issuanceDigest(issuance);
        address signer = ECDSA.recover(digest, signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert InvalidSigner();

        usedNonces[issuance.nonce] = true;
        issuedCount += 1;
        registry.recordBackendVerifiedWorldIdV4Credential(
            issuance.rater, rpId, action, issuance.nullifierHash, issuance.evidenceHash, issuance.expiresAt
        );

        emit CredentialIssued(
            issuance.rater, issuance.nullifierHash, signer, issuance.nonce, issuance.expiresAt, issuance.evidenceHash
        );
    }

    function issuanceDigest(Issuance calldata issuance) public view override returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ISSUANCE_TYPEHASH,
                    issuance.chainId,
                    issuance.registry,
                    issuance.rpId,
                    issuance.action,
                    issuance.rater,
                    issuance.nullifierHash,
                    issuance.evidenceHash,
                    issuance.expiresAt,
                    issuance.nonce,
                    issuance.deadline
                )
            )
        );
    }

    function setIssuanceCap(uint256 newCap) external onlyRole(GOVERNANCE_ROLE) {
        if (newCap < issuedCount) revert InvalidIssuanceCap();
        uint256 previousCap = issuanceCap;
        issuanceCap = newCap;
        emit IssuanceCapUpdated(previousCap, newCap);
    }

    function pause() external onlyRole(GOVERNANCE_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GOVERNANCE_ROLE) {
        _unpause();
    }

    function _validateDomain(Issuance calldata issuance) private view {
        if (
            block.chainid != BASE_CHAIN_ID || issuance.chainId != BASE_CHAIN_ID
                || issuance.registry != address(registry) || issuance.rpId != rpId || issuance.action != action
        ) {
            revert InvalidDomain();
        }
    }
}
