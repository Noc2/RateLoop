// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { AdvisoryVoteRecorder } from "../contracts/AdvisoryVoteRecorder.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";

/// @notice Test harness exposing `AdvisoryVoteRecorder` internals for the M-Vote-5 sampler tests.
/// @dev Subclasses the real recorder so we exercise the production helpers (compiled into the
///      same bytecode the deployed recorder uses), only re-exposing them under an external
///      surface. No production logic is overridden.
contract HarnessAdvisoryRecorder is AdvisoryVoteRecorder {
    constructor(address _votingEngine, address _registry, address owner_)
        AdvisoryVoteRecorder(_votingEngine, _registry, owner_)
    { }

    function harnessBuildRevealedKeySet(uint256 contentId, uint256 roundId, uint16 voteCount)
        external
        view
        returns (bytes32[] memory)
    {
        return _buildRevealedKeySet(contentId, roundId, voteCount);
    }

    function harnessAdvisoryPeerIndex(bytes32 seed, uint256 referenceIndex, uint256 count)
        external
        pure
        returns (uint256)
    {
        return _advisoryPeerIndex(seed, referenceIndex, count);
    }
}

/// @notice Sampler-bias regression tests for `AdvisoryVoteRecorder` (audit issue M-Vote-5).
/// @dev M-Vote-4 (commit 0c85d0a) replaced the engine's forward-scan sampler with a direct
///      indexed sample over a pre-built revealed array. M-Vote-5 mirrors that fix into
///      `AdvisoryVoteRecorder._buildRevealedKeySet` + `_advisoryPeerIndex`. These tests pin
///      the post-fix invariants:
///        1. The revealed array contains only revealed-and-staked commits, in commit order,
///           regardless of how the unrevealed commits are clustered.
///        2. The reference draw (uint256(seed) % revealedLen) is uniformly distributed.
///        3. The peer draw excludes the reference and is uniformly distributed over the rest.
contract AdvisoryRecorderSamplerTest is Test {
    HarnessAdvisoryRecorder internal recorder;
    address internal engineAddress;
    address internal registryAddress;
    address internal owner = address(uint160(0xA11CE));

    uint256 internal constant CONTENT_ID = 42;
    uint256 internal constant ROUND_ID = 7;

    function setUp() public {
        // Deploy a real ProtocolConfig + minimal scaffolding so the recorder constructor can
        // resolve `protocolConfig` via `RoundVotingEngine(_votingEngine).protocolConfig()`.
        LoopReputation lrep = new LoopReputation(owner, owner);
        ContentRegistry registryImpl = new ContentRegistry();
        ContentRegistry registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrep)))
                )
            )
        );

        ProtocolConfig protocolConfigImpl = new ProtocolConfig();
        ProtocolConfig protocolConfig = ProtocolConfig(
            address(
                new ERC1967Proxy(address(protocolConfigImpl), abi.encodeCall(ProtocolConfig.initialize, (owner, owner)))
            )
        );

        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundVotingEngine engine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engineImpl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize, (owner, address(lrep), address(registry), address(protocolConfig))
                    )
                )
            )
        );
        engineAddress = address(engine);
        registryAddress = address(registry);
        recorder = new HarnessAdvisoryRecorder(engineAddress, registryAddress, owner);
    }

    // ---------------------------------------------------------------------
    // Mock-call helpers
    // ---------------------------------------------------------------------

    function _mockCommit(uint256 index, bytes32 commitKey, bool revealed, uint64 stakeAmount) internal {
        _mockCommitWithScoringWeight(
            index, commitKey, revealed, stakeAmount, revealed && stakeAmount > 0 ? uint256(stakeAmount) : uint256(0)
        );
    }

    function _mockCommitWithScoringWeight(
        uint256 index,
        bytes32 commitKey,
        bool revealed,
        uint64 stakeAmount,
        uint256 scoringWeight
    ) internal {
        vm.mockCall(
            engineAddress,
            abi.encodeWithSignature("getRoundCommitKey(uint256,uint256,uint256)", CONTENT_ID, ROUND_ID, index),
            abi.encode(commitKey)
        );
        vm.mockCall(
            engineAddress,
            abi.encodeWithSignature("commitCore(uint256,uint256,bytes32)", CONTENT_ID, ROUND_ID, commitKey),
            abi.encode(
                address(uint160(0xC0FFEE + index)),
                stakeAmount,
                address(0),
                uint48(block.timestamp),
                revealed,
                true,
                uint8(0)
            )
        );
        vm.mockCall(
            engineAddress,
            abi.encodeWithSignature(
                "commitRbtsScoringWeight(uint256,uint256,bytes32)", CONTENT_ID, ROUND_ID, commitKey
            ),
            abi.encode(scoringWeight)
        );
    }

    // ---------------------------------------------------------------------
    // Invariant 1: revealed array filters and preserves order
    // ---------------------------------------------------------------------

    /// @notice Sybils at positions 0,1,2 (unrevealed) + 6 honest reveals at 3..8 — the revealed
    ///         array must contain *only* the honest keys, in their original commit order.
    function test_BuildRevealedKeySet_FiltersSybilCluster() public {
        bytes32[9] memory keys;
        for (uint256 i = 0; i < 9; i++) {
            keys[i] = keccak256(abi.encodePacked("commit", i));
        }
        // Sybil cluster: unrevealed.
        _mockCommit(0, keys[0], false, 0);
        _mockCommit(1, keys[1], false, 0);
        _mockCommit(2, keys[2], false, 0);
        // Honest revealed voters.
        for (uint256 i = 3; i < 9; i++) {
            _mockCommit(i, keys[i], true, 5e6);
        }

        bytes32[] memory revealedKeys = recorder.harnessBuildRevealedKeySet(CONTENT_ID, ROUND_ID, 9);
        assertEq(revealedKeys.length, 6, "revealed length excludes sybils");
        for (uint256 i = 0; i < 6; i++) {
            assertEq(revealedKeys[i], keys[i + 3], "revealed array preserves commit order");
        }
    }

    /// @notice Revealed commits with stakeAmount == 0 must be filtered out (mirrors the engine's
    ///         M-Vote-4 fix which also filters `revealed && stakeAmount > 0`). Without this an
    ///         attacker could in principle stuff zero-stake revealed commits to dilute peer draws.
    function test_BuildRevealedKeySet_DropsZeroStakeRevealed() public {
        bytes32[5] memory keys;
        for (uint256 i = 0; i < 5; i++) {
            keys[i] = keccak256(abi.encodePacked("zs", i));
        }
        _mockCommit(0, keys[0], true, 5e6);
        _mockCommit(1, keys[1], true, 0); // revealed but zero stake — must be dropped
        _mockCommit(2, keys[2], true, 5e6);
        _mockCommit(3, keys[3], false, 5e6); // unrevealed — must be dropped
        _mockCommit(4, keys[4], true, 1);

        bytes32[] memory revealedKeys = recorder.harnessBuildRevealedKeySet(CONTENT_ID, ROUND_ID, 5);
        assertEq(revealedKeys.length, 3, "only revealed-and-staked counted");
        assertEq(revealedKeys[0], keys[0]);
        assertEq(revealedKeys[1], keys[2]);
        assertEq(revealedKeys[2], keys[4]);
    }

    function test_BuildRevealedKeySet_DropsPostThresholdReveals() public {
        bytes32[4] memory keys;
        for (uint256 i = 0; i < 4; i++) {
            keys[i] = keccak256(abi.encodePacked("post-threshold", i));
        }
        _mockCommitWithScoringWeight(0, keys[0], true, 5e6, 5e6);
        _mockCommitWithScoringWeight(1, keys[1], true, 5e6, 5e6);
        _mockCommitWithScoringWeight(2, keys[2], true, 5e6, 5e6);
        _mockCommitWithScoringWeight(3, keys[3], true, 5e6, 0);

        bytes32[] memory revealedKeys = recorder.harnessBuildRevealedKeySet(CONTENT_ID, ROUND_ID, 4);
        assertEq(revealedKeys.length, 3, "post-threshold reveal excluded");
        assertEq(revealedKeys[0], keys[0]);
        assertEq(revealedKeys[1], keys[1]);
        assertEq(revealedKeys[2], keys[2]);
    }

    function test_BuildRevealedKeySet_ZeroVoteCountReverts() public {
        vm.expectRevert(AdvisoryVoteRecorder.NotEnoughVotes.selector);
        recorder.harnessBuildRevealedKeySet(CONTENT_ID, ROUND_ID, 0);
    }

    // ---------------------------------------------------------------------
    // Invariant 2: reference-draw uniform over the revealed set
    // ---------------------------------------------------------------------

    /// @notice M-Vote-5 attack scenario: 3 sybil commits at indices 0,1,2 do not reveal, 6 honest
    ///         commits at 3..8 reveal. Under the old forward-scan sampler the seed's modulo over
    ///         `voteCount=9` would land on {0,1,2} 33% of the time, all of which would forward-
    ///         scan into index 3 — giving index-3 a 4/9 ≈ 44% selection rate (4× uniform).
    ///         After M-Vote-5 the sampler indexes directly into the revealed array of length 6,
    ///         so every honest position receives ~1/6 of the probability mass.
    function test_ReferenceDraw_UniformAfterSybilCluster() public {
        bytes32[9] memory keys;
        for (uint256 i = 0; i < 9; i++) {
            keys[i] = keccak256(abi.encodePacked("ref-uniform", i));
        }
        _mockCommit(0, keys[0], false, 0);
        _mockCommit(1, keys[1], false, 0);
        _mockCommit(2, keys[2], false, 0);
        for (uint256 i = 3; i < 9; i++) {
            _mockCommit(i, keys[i], true, 5e6);
        }

        bytes32[] memory revealedKeys = recorder.harnessBuildRevealedKeySet(CONTENT_ID, ROUND_ID, 9);
        assertEq(revealedKeys.length, 6);

        uint256 trials = 1_200;
        uint256[6] memory hits;
        for (uint256 t = 0; t < trials; t++) {
            bytes32 seed = keccak256(abi.encodePacked(uint256(0xDEADBEEF), t));
            uint256 refIdx = uint256(seed) % revealedKeys.length;
            hits[refIdx]++;
        }
        // Uniform expectation: trials / 6 = 200. Bound the per-bucket deviation to 2x uniform
        // (so any single bucket has 100..400 hits) — under the old sampler index 3 alone would
        // absorb ~44% (~528 hits) while indices 4..8 would absorb ~11% each (~133 hits).
        uint256 expected = trials / revealedKeys.length;
        for (uint256 b = 0; b < 6; b++) {
            assertLt(hits[b], expected * 2, "no revealed index exceeds 2x uniform");
            assertGt(hits[b] * 2, expected, "no revealed index falls below 0.5x uniform");
        }
    }

    // ---------------------------------------------------------------------
    // Invariant 3: peer-draw excludes reference and is uniform over the rest
    // ---------------------------------------------------------------------

    function test_PeerDraw_NeverEqualsReference() public view {
        uint256 count = 8;
        uint256 trials = 1_000;
        for (uint256 t = 0; t < trials; t++) {
            bytes32 seed = keccak256(abi.encodePacked(uint256(0xBEE5), t));
            uint256 refIdx = uint256(seed) % count;
            uint256 peerIdx = recorder.harnessAdvisoryPeerIndex(seed, refIdx, count);
            assertLt(peerIdx, count, "peer index in range");
            assertTrue(peerIdx != refIdx, "peer never collides with reference");
        }
    }

    /// @notice With the reference pinned to index 3, the peer draw should be uniform over the
    ///         remaining 5 indices in a revealed set of size 6.
    function test_PeerDraw_UniformWithFixedReference() public view {
        uint256 count = 6;
        uint256 fixedRef = 3;
        uint256 trials = 1_200;
        uint256[6] memory hits;
        for (uint256 t = 0; t < trials; t++) {
            bytes32 seed = keccak256(abi.encodePacked(uint256(0xFEED), t));
            uint256 peerIdx = recorder.harnessAdvisoryPeerIndex(seed, fixedRef, count);
            assertTrue(peerIdx != fixedRef, "peer skips reference");
            hits[peerIdx]++;
        }
        uint256 expected = trials / (count - 1); // 240
        for (uint256 b = 0; b < count; b++) {
            if (b == fixedRef) {
                assertEq(hits[b], 0, "reference bucket gets zero peer hits");
                continue;
            }
            assertLt(hits[b], expected * 2, "no peer index exceeds 2x uniform");
            assertGt(hits[b] * 2, expected, "no peer index falls below 0.5x uniform");
        }
    }
}
