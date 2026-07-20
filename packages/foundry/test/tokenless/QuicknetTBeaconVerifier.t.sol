// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { QuicknetTBeaconVerifier } from "../../contracts/tokenless/QuicknetTBeaconVerifier.sol";

contract QuicknetTBeaconVerifierTest is Test {
    bytes32 internal constant NETWORK_HASH = 0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5;
    bytes internal constant ROUND_1_PROOF =
        hex"81d347e1c4be0e4277112de281d3a52aa1190bbd2f0ad7954e22799d168e61b60b4a0c46fc5a2777963cb739a0243e21";
    bytes32 internal constant ROUND_1_RANDOMNESS = 0x5c1dd096cd32cd272fcd2ad6e4d46d33713d16618ede11bae63da90edc3fbb1b;
    bytes internal constant ROUND_12345678_PROOF =
        hex"b40845f2ae971025215f599b8af346bf329129d1d5ee416665472f91050acb3ecd31ee878033ba14842d4367010e1964";
    bytes32 internal constant ROUND_12345678_RANDOMNESS =
        0xc8788d522aa63a9fd2e715499097597dc94f33ee2bd0f78c5367e11ce825227b;

    QuicknetTBeaconVerifier internal verifier;

    function setUp() public {
        verifier = new QuicknetTBeaconVerifier();
    }

    function testVerifiesLiveQuicknetTRound1() public view {
        assertTrue(verifier.verifyBeacon(NETWORK_HASH, 1, ROUND_1_RANDOMNESS, ROUND_1_PROOF));
    }

    function testVerifiesLiveQuicknetTRound12345678() public view {
        assertTrue(verifier.verifyBeacon(NETWORK_HASH, 12_345_678, ROUND_12345678_RANDOMNESS, ROUND_12345678_PROOF));
    }

    function testRejectsWrongNetworkRoundRandomnessAndProof() public view {
        assertFalse(verifier.verifyBeacon(bytes32(uint256(1)), 1, ROUND_1_RANDOMNESS, ROUND_1_PROOF));
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 0, ROUND_1_RANDOMNESS, ROUND_1_PROOF));
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 2, ROUND_1_RANDOMNESS, ROUND_1_PROOF));
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 1, bytes32(uint256(1)), ROUND_1_PROOF));

        bytes memory changedProof = ROUND_1_PROOF;
        changedProof[47] = bytes1(uint8(changedProof[47]) ^ 1);
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 1, sha256(changedProof), changedProof));
    }

    function testRejectsMalformedProofEncodings() public view {
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 1, sha256(hex""), hex""));
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 1, sha256(hex"80"), hex"80"));

        bytes memory uncompressed = ROUND_1_PROOF;
        uncompressed[0] = bytes1(uint8(uncompressed[0]) & 0x7f);
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 1, sha256(uncompressed), uncompressed));

        bytes memory infinity = ROUND_1_PROOF;
        infinity[0] = bytes1(uint8(infinity[0]) | 0x40);
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 1, sha256(infinity), infinity));

        bytes memory nonCanonicalField =
            hex"9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 1, sha256(nonCanonicalField), nonCanonicalField));

        bytes memory outOfCurve =
            hex"800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001";
        assertFalse(verifier.verifyBeacon(NETWORK_HASH, 1, sha256(outOfCurve), outOfCurve));
    }
}
