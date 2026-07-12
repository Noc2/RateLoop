// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { ICredentialIssuer } from "./interfaces/ICredentialIssuer.sol";

/// @title CredentialIssuer
/// @notice Narrow, fundless trust anchor for epoch-versioned paid-task vouchers.
/// @dev The rotation authority can admit or censor future voters. It cannot call the panel core,
///      alter accepted commits, redirect claims, or move funds. Voucher digests are built by the
///      panel core so signatures are bound to that core's EIP-712 domain.
contract CredentialIssuer is ICredentialIssuer {
    address public immutable rotationAuthority;
    uint64 public immutable maxScheduledGrace;

    uint64 public currentEpoch;
    mapping(uint64 epoch => address signer) public signerAtEpoch;
    mapping(uint64 epoch => uint64 acceptedUntil) public graceUntil;

    event SignerRotated(
        uint64 indexed previousEpoch,
        uint64 indexed newEpoch,
        address indexed newSigner,
        bool emergency,
        uint64 previousEpochAcceptedUntil
    );

    error Unauthorized();
    error InvalidAddress();
    error InvalidGracePeriod();
    error EpochOverflow();

    constructor(address rotationAuthority_, address initialSigner, uint64 maxScheduledGrace_) {
        if (rotationAuthority_ == address(0) || initialSigner == address(0)) revert InvalidAddress();
        if (maxScheduledGrace_ == 0) revert InvalidGracePeriod();

        rotationAuthority = rotationAuthority_;
        maxScheduledGrace = maxScheduledGrace_;
        currentEpoch = 1;
        signerAtEpoch[1] = initialSigner;

        emit SignerRotated(0, 1, initialSigner, false, 0);
    }

    /// @notice Rotate normally, retaining the previous epoch for a bounded voucher grace window.
    function rotateScheduled(address newSigner, uint64 previousEpochGrace) external {
        if (msg.sender != rotationAuthority) revert Unauthorized();
        if (newSigner == address(0)) revert InvalidAddress();
        if (previousEpochGrace > maxScheduledGrace) revert InvalidGracePeriod();

        uint64 previousEpoch = currentEpoch;
        uint64 newEpoch = previousEpoch + 1;
        if (newEpoch == 0) revert EpochOverflow();

        uint64 acceptedUntil = uint64(block.timestamp) + previousEpochGrace;
        graceUntil[previousEpoch] = acceptedUntil;
        currentEpoch = newEpoch;
        signerAtEpoch[newEpoch] = newSigner;

        emit SignerRotated(previousEpoch, newEpoch, newSigner, false, acceptedUntil);
    }

    /// @notice Rotate after compromise, immediately invalidating every uncommitted old voucher.
    function rotateEmergency(address newSigner) external {
        if (msg.sender != rotationAuthority) revert Unauthorized();
        if (newSigner == address(0)) revert InvalidAddress();

        uint64 previousEpoch = currentEpoch;
        uint64 newEpoch = previousEpoch + 1;
        if (newEpoch == 0) revert EpochOverflow();

        graceUntil[previousEpoch] = 0;
        currentEpoch = newEpoch;
        signerAtEpoch[newEpoch] = newSigner;

        emit SignerRotated(previousEpoch, newEpoch, newSigner, true, 0);
    }

    function isEpochAccepted(uint64 issuerEpoch) public view returns (bool) {
        if (issuerEpoch == currentEpoch) return true;
        return
            issuerEpoch < currentEpoch && currentEpoch - issuerEpoch == 1 && block.timestamp <= graceUntil[issuerEpoch];
    }

    function isValidVoucherSignature(uint64 issuerEpoch, bytes32 digest, bytes calldata signature)
        external
        view
        override
        returns (bool)
    {
        if (!isEpochAccepted(issuerEpoch)) return false;
        address expectedSigner = signerAtEpoch[issuerEpoch];
        if (expectedSigner == address(0)) return false;

        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecoverCalldata(digest, signature);
        return error == ECDSA.RecoverError.NoError && recovered == expectedSigner;
    }
}
