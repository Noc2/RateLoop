// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IBeaconVerifier } from "./interfaces/IBeaconVerifier.sol";
import { BLS2 } from "../vendor/randamu/bls-solidity/BLS2.sol";

/// @title QuicknetTBeaconVerifier
/// @notice Stateless verifier for drand quicknet-t's unchained RFC 9380 BLS signatures.
/// @dev Uses the Prague EIP-2537 precompiles. The vendored BLS implementation is experimental and unaudited.
contract QuicknetTBeaconVerifier is IBeaconVerifier {
    bytes32 public constant NETWORK_HASH = 0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5;
    uint256 public constant PROOF_LENGTH = 48;
    string public constant DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
    uint128 private constant BASE_FIELD_MODULUS_HI = 0x1a0111ea397fe69a4b1ba7b6434bacd7;
    uint256 private constant BASE_FIELD_MODULUS_LO = 0x64774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab;

    function verifyBeacon(bytes32 networkHash, uint64 round, bytes32 randomness, bytes calldata proof)
        external
        view
        returns (bool)
    {
        if (
            networkHash != NETWORK_HASH || round == 0 || proof.length != PROOF_LENGTH || randomness != sha256(proof)
                || !_isCanonicalFiniteCompressedG1(proof)
        ) return false;

        BLS2.PointG1 memory signature = BLS2.g1UnmarshalCompressed(proof);
        if (!BLS2.isOnCurve(signature)) return false;
        BLS2.PointG1 memory message = BLS2.hashToPoint(bytes(DST), abi.encodePacked(sha256(abi.encodePacked(round))));
        (bool pairingSuccess, bool callSuccess) = BLS2.verifySingle(signature, _publicKey(), message);
        return callSuccess && pairingSuccess;
    }

    function _isCanonicalFiniteCompressedG1(bytes calldata proof) private pure returns (bool) {
        // RFC 9380 compressed G1 requires compression=1 and infinity=0. The sort bit may be either value.
        if (uint8(proof[0]) & 0xc0 != 0x80) return false;

        uint128 xHi;
        uint256 xLo;
        assembly {
            xHi := and(shr(128, calldataload(proof.offset)), 0x1fffffffffffffffffffffffffffffff)
            xLo := calldataload(add(proof.offset, 16))
        }
        return xHi < BASE_FIELD_MODULUS_HI || (xHi == BASE_FIELD_MODULUS_HI && xLo < BASE_FIELD_MODULUS_LO);
    }

    function _publicKey() private pure returns (BLS2.PointG2 memory) {
        return BLS2.PointG2({
            x1_hi: 0x115b65b46fb29104f6a4b5d1e11a8da6,
            x1_lo: 0x344463973d423661bb0804846a0ecd1ef93c25057f1c0baab2ac53e56c662b66,
            x0_hi: 0x072f6d84ee791a3382bfb055afab1e6a,
            x0_lo: 0x375538d8ffc451104ac971d2dc9b168e2d3246b0be2015969cbaac298f6502da,
            y1_hi: 0x196197c055a4f7936b72136c41619d7c,
            y1_lo: 0xd2a4e44479504b8bbb941d16ae79d985b3b9ae0aeeea18853153f5a2fa02f5dd,
            y0_hi: 0x13dba2f47914cda2132d3454f23f855c,
            y0_lo: 0xe20f3a4c037e388148f354b783b9b416ff5ef70475e5d19889bc554751e8bc1b
        });
    }
}
