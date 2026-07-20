// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { BLS12_G1ADD, BLS12_MAP_FP_TO_G1, BLS12_PAIRING_CHECK, MODEXP_ADDRESS } from "./Precompiles.sol";

// Vendored from Randamu bls-solidity commit 11af179a8287d978659aae07adb66aa60f64b8a6.
// See LICENSE and PROVENANCE.md in this directory. This retains only the functions used by RateLoop.

/// @title Boneh-Lynn-Shacham signatures on BLS12-381
/// @dev Experimental, unaudited EIP-2537 implementation. Base field elements are encoded as uint128 + uint256.
library BLS2 {
    struct PointG1 {
        uint128 x_hi;
        uint256 x_lo;
        uint128 y_hi;
        uint256 y_lo;
    }

    struct PointG2 {
        uint128 x1_hi;
        uint256 x1_lo;
        uint128 x0_hi;
        uint256 x0_lo;
        uint128 y1_hi;
        uint256 y1_lo;
        uint128 y0_hi;
        uint256 y0_lo;
    }

    uint128 private constant N_G2_X0_HI = 0x024aa2b2f08f0a91260805272dc51051;
    uint256 private constant N_G2_X0_LO = 0xc6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8;
    uint128 private constant N_G2_X1_HI = 0x13e02b6052719f607dacd3a088274f65;
    uint256 private constant N_G2_X1_LO = 0x596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e;
    uint128 private constant N_G2_Y0_HI = 0x0d1b3cc2c7027888be51d9ef691d77bc;
    uint256 private constant N_G2_Y0_LO = 0xb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa;
    uint128 private constant N_G2_Y1_HI = 0x13fa4d4a0ad8b1ce186ed5061789213d;
    uint256 private constant N_G2_Y1_LO = 0x993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed;

    uint128 private constant P_HI = 0x1a0111ea397fe69a4b1ba7b6434bacd7;
    uint256 private constant P_LO = 0x64774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab;
    uint128 private constant P_PLUS_ONE_SLASH_2_HI = 0x0680447a8e5ff9a692c6e9ed90d2eb35;
    uint256 private constant P_PLUS_ONE_SLASH_2_LO = 0xd91dd2e13ce144afd9cc34a83dac3d8907aaffffac54ffffee7fbfffffffeaab;
    uint256 private constant PAIRING_GAS_LIMIT = 500_000;

    error InvalidDSTLength(bytes dst);

    function g1UnmarshalCompressed(bytes memory m) internal view returns (PointG1 memory) {
        require(m.length == 48, "Invalid G1 bytes length");

        uint128 x_hi;
        uint256 x_lo;
        uint128 y_hi;
        uint256 y_lo;
        bytes memory buf = new bytes(288);
        uint8 flags;
        bool larger;

        assembly {
            x_hi := shr(128, mload(add(m, 0x20)))
            x_lo := mload(add(m, 0x30))
            flags := byte(16, x_hi)
            x_hi := and(x_hi, 0x1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
        }

        if (flags & 0x80 == 0) revert("Invalid G1 point: not compressed");
        if (flags & 0x40 != 0) revert("unsupported: point at infinity");
        if (flags & 0x20 == 0) larger = true;

        bool ok;
        assembly {
            let p := add(buf, 32)
            mstore(p, 64)
            p := add(p, 32)
            mstore(p, 1)
            p := add(p, 32)
            mstore(p, 64)
            p := add(p, 32)
            mstore(p, x_hi)
            p := add(p, 32)
            mstore(p, x_lo)
            p := add(p, 32)
            mstore8(p, 3)
            p := add(p, 1)
            mstore(p, P_HI)
            p := add(p, 32)
            mstore(p, P_LO)
            ok := staticcall(gas(), MODEXP_ADDRESS, add(32, buf), 225, add(32, buf), 64)
            y_hi := mload(add(buf, 32))
            y_lo := mload(add(buf, 64))
        }
        assert(ok);
        unchecked {
            y_lo += 4;
        }
        if (y_lo < 4) y_hi += 1;

        assembly {
            let p := add(buf, 32)
            mstore(p, 64)
            p := add(p, 32)
            mstore(p, 64)
            p := add(p, 32)
            mstore(p, 64)
            p := add(p, 32)
            mstore(p, y_hi)
            p := add(p, 32)
            mstore(p, y_lo)
            p := add(p, 32)
            mstore(p, P_PLUS_ONE_SLASH_2_HI)
            p := add(p, 32)
            mstore(p, P_PLUS_ONE_SLASH_2_LO)
            p := add(p, 32)
            mstore(p, P_HI)
            p := add(p, 32)
            mstore(p, P_LO)
            ok := staticcall(gas(), MODEXP_ADDRESS, add(32, buf), 288, add(32, buf), 64)
            y_hi := mload(add(buf, 32))
            y_lo := mload(add(buf, 64))
        }
        assert(ok);

        uint128 alt_y_hi = P_HI - y_hi;
        uint256 alt_y_lo;
        unchecked {
            alt_y_lo = P_LO - y_lo;
        }
        if (alt_y_lo > P_LO) alt_y_hi -= 1;

        bool do_swap = y_hi > alt_y_hi || (y_hi == alt_y_hi && y_lo > alt_y_lo);
        do_swap = larger == do_swap;
        if (do_swap) {
            y_hi = alt_y_hi;
            y_lo = alt_y_lo;
        }

        return PointG1(x_hi, x_lo, y_hi, y_lo);
    }

    function hashToPoint(bytes memory dst, bytes memory message) internal view returns (PointG1 memory out) {
        bytes memory uniform_bytes = expandMsg(dst, message, 128);
        bytes memory buf = new bytes(225);
        bytes memory buf2 = new bytes(256);
        bool ok;
        for (uint256 i; i < 2; ++i) {
            assembly {
                let p := add(32, uniform_bytes)
                let q := add(32, buf)
                p := add(p, mul(64, i))
                mstore(q, 64)
                q := add(q, 32)
                mstore(q, 1)
                q := add(q, 32)
                mstore(q, 64)
                q := add(q, 32)
                mcopy(q, p, 64)
                q := add(q, 64)
                mstore8(q, 1)
                q := add(q, 1)
                mstore(q, P_HI)
                q := add(q, 32)
                mstore(q, P_LO)
                ok := staticcall(gas(), MODEXP_ADDRESS, add(32, buf), 225, p, 64)

                let r := add(32, buf2)
                r := add(r, mul(128, i))
                ok := and(ok, staticcall(gas(), BLS12_MAP_FP_TO_G1, p, 64, r, 128))
            }
            require(ok);
        }
        assembly {
            ok := staticcall(gas(), BLS12_G1ADD, add(buf2, 32), 256, out, 128)
        }
        require(ok, "g1add failed");
    }

    /// @notice RateLoop addition: reject malformed affine points before the EIP-2537 pairing call.
    function isOnCurve(PointG1 memory point) internal view returns (bool) {
        (bool xOk, uint128 rhsHi, uint256 rhsLo) = _modExp(point.x_hi, point.x_lo, 3);
        if (!xOk) return false;
        unchecked {
            rhsLo += 4;
        }
        if (rhsLo < 4) ++rhsHi;

        (bool yOk, uint128 ySquaredHi, uint256 ySquaredLo) = _modExp(point.y_hi, point.y_lo, 2);
        return yOk && ySquaredHi == rhsHi && ySquaredLo == rhsLo;
    }

    function _modExp(uint128 baseHi, uint256 baseLo, uint8 exponent)
        private
        view
        returns (bool ok, uint128 resultHi, uint256 resultLo)
    {
        bytes memory buf = new bytes(225);
        assembly {
            let p := add(buf, 32)
            mstore(p, 64)
            p := add(p, 32)
            mstore(p, 1)
            p := add(p, 32)
            mstore(p, 64)
            p := add(p, 32)
            mstore(p, baseHi)
            p := add(p, 32)
            mstore(p, baseLo)
            p := add(p, 32)
            mstore8(p, exponent)
            p := add(p, 1)
            mstore(p, P_HI)
            p := add(p, 32)
            mstore(p, P_LO)
            ok := staticcall(gas(), MODEXP_ADDRESS, add(32, buf), 225, add(32, buf), 64)
            resultHi := mload(add(buf, 32))
            resultLo := mload(add(buf, 64))
        }
    }

    function expandMsg(bytes memory dst, bytes memory message, uint8 n_bytes) internal pure returns (bytes memory) {
        uint256 domainLen = dst.length;
        if (domainLen > 255) revert InvalidDSTLength(dst);
        bytes memory zpad = new bytes(64);
        bytes32 b0 = sha256(abi.encodePacked(zpad, message, uint8(0), n_bytes, uint8(0), dst, uint8(domainLen)));
        bytes32 bi = sha256(abi.encodePacked(b0, uint8(1), dst, uint8(domainLen)));
        bytes memory out = new bytes(n_bytes);
        uint256 ell = (n_bytes + uint256(31)) >> 5;
        for (uint256 i = 1; i < ell; ++i) {
            bytes memory b_i = abi.encodePacked(b0 ^ bi, uint8(1 + i), dst, uint8(domainLen));
            assembly {
                let p := add(32, out)
                p := add(p, mul(32, sub(i, 1)))
                mstore(p, bi)
            }
            bi = sha256(b_i);
        }
        assembly {
            let p := add(32, out)
            p := add(p, mul(32, sub(ell, 1)))
            mstore(p, bi)
        }
        return out;
    }

    function verifySingle(PointG1 memory signature, PointG2 memory pubkey, PointG1 memory message)
        internal
        view
        returns (bool pairingSuccess, bool callSuccess)
    {
        uint256[24] memory input = [
            signature.x_hi,
            signature.x_lo,
            signature.y_hi,
            signature.y_lo,
            N_G2_X0_HI,
            N_G2_X0_LO,
            N_G2_X1_HI,
            N_G2_X1_LO,
            N_G2_Y0_HI,
            N_G2_Y0_LO,
            N_G2_Y1_HI,
            N_G2_Y1_LO,
            message.x_hi,
            message.x_lo,
            message.y_hi,
            message.y_lo,
            pubkey.x0_hi,
            pubkey.x0_lo,
            pubkey.x1_hi,
            pubkey.x1_lo,
            pubkey.y0_hi,
            pubkey.y0_lo,
            pubkey.y1_hi,
            pubkey.y1_lo
        ];
        uint256[1] memory out;
        assembly {
            callSuccess := staticcall(PAIRING_GAS_LIMIT, BLS12_PAIRING_CHECK, input, 768, out, 0x20)
        }
        return (out[0] != 0, callSuccess);
    }
}
