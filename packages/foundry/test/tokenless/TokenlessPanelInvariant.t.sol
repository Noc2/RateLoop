// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { CredentialIssuer } from "../../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessPanel } from "../../contracts/tokenless/TokenlessPanel.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";
import { MockBeaconVerifier } from "../../contracts/mocks/MockBeaconVerifier.sol";

contract TokenlessPanelInvariantHandler is Test {
    uint256 internal constant ISSUER_PK = 0xA11CE;
    uint256 internal constant CURVE_ORDER =
        115792089237316195423570985008687907852837564279074904382605163141518161494337;
    uint256 internal constant BOUNTY = 100e6;
    uint256 internal constant FEE = 10e6;
    uint256 internal constant FIXED_BASE = 26_666_666;
    uint256 internal constant RESERVE = FIXED_BASE * 3;
    uint256 internal constant ROUND_TOTAL = BOUNTY + FEE + RESERVE;
    uint256 internal constant MAX_TRACKED_ROUNDS = 24;
    bytes32 internal constant ADMISSION_POLICY_HASH = keccak256("invariant-audience-policy");

    struct RaterMaterial {
        address voteKey;
        address payout;
        bytes32 salt;
        bytes32 responseHash;
        bytes32 commitKey;
        uint8 vote;
        uint16 prediction;
        bool shouldReveal;
    }

    MockERC20 public immutable usdc;
    CredentialIssuer public immutable issuer;
    TokenlessPanel public immutable panel;
    address public immutable creditDestination;

    uint256[] internal _roundIds;
    mapping(uint256 roundId => RaterMaterial[] materials) internal _materials;

    uint256 public totalFunded;
    uint256 public totalDirectPaid;
    uint256 public totalCreditWithdrawn;
    uint256 public retryOrderViolations;
    uint256 public finalizedRounds;
    uint256 public zeroCommitRounds;
    uint256 public underQuorumRounds;
    uint256 public beaconFailureRounds;

    constructor() {
        vm.warp(1_900_000_000);
        usdc = new MockERC20("Invariant USDC", "iUSDC", 6);
        issuer = new CredentialIssuer(address(this), vm.addr(ISSUER_PK), 1 days);
        panel = new TokenlessPanel(address(usdc), address(issuer), address(new MockBeaconVerifier()));
        creditDestination = makeAddr("invariantCreditDestination");
        usdc.mint(address(this), type(uint128).max);
        usdc.approve(address(panel), type(uint256).max);
    }

    /// @dev Variants cover empty cancellation, RBTS settlement, under-quorum compensation,
    ///      and a zero-reveal beacon-failure refund.
    function createRound(uint256 variantSeed) external {
        if (_roundIds.length >= MAX_TRACKED_ROUNDS) return;
        uint8 variant = uint8(variantSeed % 4);
        TokenlessPanel.RoundTerms memory terms = TokenlessPanel.RoundTerms({
            contentId: keccak256(abi.encode("content", _roundIds.length, block.timestamp)),
            termsHash: keccak256(abi.encode("terms", variant, _roundIds.length, block.timestamp)),
            beaconNetworkHash: keccak256("drand-quicknet"),
            bountyAmount: BOUNTY,
            feeAmount: FEE,
            attemptReserve: RESERVE,
            attemptCompensation: FIXED_BASE,
            minimumReveals: 3,
            maximumCommits: 3,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            commitDeadline: uint64(block.timestamp + 10 minutes),
            revealDeadline: uint64(block.timestamp + 20 minutes),
            beaconFailureDeadline: uint64(block.timestamp + 6 hours + 20 minutes),
            beaconRound: uint64(10_000 + _roundIds.length),
            claimGracePeriod: 1 hours,
            feeRecipient: address(this)
        });

        uint256 roundId = panel.createRound(terms);
        totalFunded += ROUND_TOTAL;
        _roundIds.push(roundId);
        if (variant == 1) {
            for (uint256 i = 0; i < 3; ++i) {
                _commitRater(roundId, terms.contentId, i, true);
            }
        } else if (variant == 2) {
            for (uint256 i = 0; i < 2; ++i) {
                _commitRater(roundId, terms.contentId, i, true);
            }
        } else if (variant == 3) {
            _commitRater(roundId, terms.contentId, 0, false);
        }
    }

    function advanceRound(uint256 seed) external {
        if (_roundIds.length == 0) return;
        uint256 roundId = _roundIds[seed % _roundIds.length];
        TokenlessPanel.Round memory round = panel.getRound(roundId);

        if (round.state == TokenlessPanel.RoundState.Open || round.state == TokenlessPanel.RoundState.Revealable) {
            if (round.commitCount == 0) {
                panel.cancelEmptyRound(roundId);
                zeroCommitRounds += 1;
                _withdrawCredit();
                return;
            }

            if (block.timestamp <= round.beaconFailureDeadline) {
                _warpForward(round.commitDeadline + 1);
                RaterMaterial[] storage materials = _materials[roundId];
                for (uint256 i = 0; i < materials.length; ++i) {
                    RaterMaterial storage material = materials[i];
                    if (material.shouldReveal && !panel.getCommit(material.commitKey).revealed) {
                        panel.reveal(
                            roundId,
                            material.voteKey,
                            material.vote,
                            material.prediction,
                            material.responseHash,
                            material.payout,
                            material.salt
                        );
                    }
                }
            }
            _warpForward(round.beaconFailureDeadline + 1);
            panel.beginSettlement(roundId);
            TokenlessPanel.RoundState resultingState = panel.getRound(roundId).state;
            if (resultingState == TokenlessPanel.RoundState.UnderQuorumCompensation) underQuorumRounds += 1;
            if (resultingState == TokenlessPanel.RoundState.BeaconFailureCompensation) beaconFailureRounds += 1;
            _withdrawCredit();
            return;
        }

        if (round.state == TokenlessPanel.RoundState.Aggregating) {
            uint32 cursorBefore = round.aggregateCursor;
            (bool invalidSucceeded,) =
                address(panel).call(abi.encodeCall(panel.processAggregate, (roundId, cursorBefore + 1, uint32(1))));
            if (invalidSucceeded || panel.getRound(roundId).aggregateCursor != cursorBefore) retryOrderViolations += 1;
            panel.processAggregate(roundId, cursorBefore, uint32((seed % 3) + 1));
            return;
        }

        if (round.state == TokenlessPanel.RoundState.AwaitingSeed) {
            panel.finalizeScoringFallback(roundId);
            return;
        }

        if (round.state == TokenlessPanel.RoundState.Scoring) {
            if (round.scoreCursor < round.frozenRevealCount) {
                uint32 cursorBefore = round.scoreCursor;
                (bool invalidSucceeded,) =
                    address(panel).call(abi.encodeCall(panel.processScores, (roundId, cursorBefore + 1, uint32(1))));
                if (invalidSucceeded || panel.getRound(roundId).scoreCursor != cursorBefore) {
                    retryOrderViolations += 1;
                }
                panel.processScores(roundId, cursorBefore, uint32((seed % 3) + 1));
            }
            if (panel.getRound(roundId).scoreCursor == round.frozenRevealCount) {
                panel.finalizeSettlement(roundId);
                finalizedRounds += 1;
                _withdrawCredit();
            }
            return;
        }

        bool compensated = round.state == TokenlessPanel.RoundState.UnderQuorumCompensation
            || round.state == TokenlessPanel.RoundState.BeaconFailureCompensation;
        if (round.state == TokenlessPanel.RoundState.Finalized || compensated) {
            RaterMaterial[] storage materials = _materials[roundId];
            for (uint256 i = 0; i < materials.length; ++i) {
                RaterMaterial storage material = materials[i];
                TokenlessPanel.CommitRecord memory record = panel.getCommit(material.commitKey);
                if (!record.claimed && record.revealed && block.timestamp <= round.claimDeadline) {
                    uint256 amount = round.state == TokenlessPanel.RoundState.Finalized
                        ? panel.claim(material.commitKey, material.payout, material.salt)
                        : panel.claimCompensation(material.commitKey, material.payout, material.salt);
                    totalDirectPaid += amount;
                }
            }
            _warpForward(round.claimDeadline + 1);
            if (!panel.getRound(roundId).staleReturned) panel.returnStaleShares(roundId);
        }
        _withdrawCredit();
    }

    function withdrawCredit() external {
        _withdrawCredit();
    }

    function allRoundsHaveExitClassification() external view returns (bool) {
        for (uint256 i = 0; i < _roundIds.length; ++i) {
            TokenlessPanel.Round memory round = panel.getRound(_roundIds[i]);
            if (uint8(round.state) > uint8(TokenlessPanel.RoundState.BeaconFailureCompensation)) return false;
            if (round.minimumReveals < 3 || round.maximumCommits > panel.MAXIMUM_COMMITS()) return false;
            if (round.attemptCompensation != round.fixedBasePay) return false;
            if (round.attemptReserve < round.fixedBasePay * round.maximumCommits) return false;
            if (round.beaconFailureDeadline <= round.revealDeadline) return false;
            if (round.state == TokenlessPanel.RoundState.Aggregating && round.aggregateCursor > round.frozenRevealCount)
            {
                return false;
            }
            if (round.state == TokenlessPanel.RoundState.Scoring && round.scoreCursor > round.frozenRevealCount) {
                return false;
            }
            if (
                (round.state == TokenlessPanel.RoundState.Finalized
                        || round.state == TokenlessPanel.RoundState.UnderQuorumCompensation
                        || round.state == TokenlessPanel.RoundState.BeaconFailureCompensation)
                    && round.claimDeadline == 0
            ) return false;
        }
        return true;
    }

    function allRoundsTerminalAndSwept() external view returns (bool) {
        for (uint256 i = 0; i < _roundIds.length; ++i) {
            TokenlessPanel.Round memory round = panel.getRound(_roundIds[i]);
            if (round.state == TokenlessPanel.RoundState.ZeroCommitRefund) continue;
            if (
                round.state != TokenlessPanel.RoundState.Finalized
                    && round.state != TokenlessPanel.RoundState.UnderQuorumCompensation
                    && round.state != TokenlessPanel.RoundState.BeaconFailureCompensation
            ) return false;
            if (!round.staleReturned) return false;
        }
        return true;
    }

    function _commitRater(uint256 roundId, bytes32 contentId, uint256 index, bool shouldReveal) private {
        uint256 privateKey = (uint256(keccak256(abi.encode("rater", roundId, index))) % (CURVE_ORDER - 1)) + 1;
        address voteKey = vm.addr(privateKey);
        address payout = address(uint160(uint256(keccak256(abi.encode("payout", roundId, index)))));
        bytes32 nullifier = keccak256(abi.encode("nullifier", roundId, index));
        bytes32 salt = keccak256(abi.encode("salt", roundId, index));
        bytes32 responseHash = keccak256(abi.encode("response", roundId, index));
        uint8 vote = uint8((roundId + index) % 2);
        uint16 prediction = uint16((index + 3) * 1_000);
        TokenlessPanel.Voucher memory voucher = TokenlessPanel.Voucher({
            voteKey: voteKey,
            contentId: contentId,
            roundId: roundId,
            nullifier: nullifier,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            issuerEpoch: 1,
            expiresAt: uint64(block.timestamp + 1 hours)
        });
        bytes32 sealedCommitment =
            panel.revealCommitment(roundId, voteKey, vote, prediction, responseHash, payout, salt);
        bytes32 payoutCommitment = panel.payoutCommitmentFor(payout, salt);
        bytes memory sealedPayload = abi.encodePacked("invariant-tlock", roundId, index);
        bytes memory voucherSignature = _sign(ISSUER_PK, panel.voucherDigest(voucher));
        bytes memory voteKeySignature = _sign(
            privateKey,
            panel.commitDigest(roundId, sealedCommitment, keccak256(sealedPayload), payoutCommitment, nullifier)
        );
        panel.commit(voucher, sealedCommitment, sealedPayload, payoutCommitment, voucherSignature, voteKeySignature);

        _materials[roundId].push(
            RaterMaterial({
                voteKey: voteKey,
                payout: payout,
                salt: salt,
                responseHash: responseHash,
                commitKey: panel.commitKeyFor(roundId, voteKey),
                vote: vote,
                prediction: prediction,
                shouldReveal: shouldReveal
            })
        );
    }

    function _withdrawCredit() private {
        uint256 amount = panel.withdrawableCredit(address(this));
        if (amount == 0) return;
        totalCreditWithdrawn += panel.withdrawCredit(creditDestination);
    }

    function _warpForward(uint256 timestamp) private {
        if (block.timestamp < timestamp) vm.warp(timestamp);
    }

    function _sign(uint256 privateKey, bytes32 digest) private pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}

contract TokenlessPanelInvariantTest is StdInvariant, Test {
    TokenlessPanelInvariantHandler internal handler;

    function setUp() external {
        handler = new TokenlessPanelInvariantHandler();
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.createRound.selector;
        selectors[1] = handler.advanceRound.selector;
        selectors[2] = handler.withdrawCredit.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_AllCustodiedFundsRemainConserved() external view {
        assertEq(
            handler.usdc().balanceOf(address(handler.panel())),
            handler.totalFunded() - handler.totalDirectPaid() - handler.totalCreditWithdrawn()
        );
    }

    function invariant_PullCreditsAreFullyBacked() external view {
        assertLe(handler.panel().totalWithdrawableCredit(), handler.usdc().balanceOf(address(handler.panel())));
    }

    function invariant_RetryAndWrongOrderCannotAdvanceSettlementCursors() external view {
        assertEq(handler.retryOrderViolations(), 0);
    }

    function invariant_EveryObservedStateHasItsSpecifiedExitClass() external view {
        assertTrue(handler.allRoundsHaveExitClassification());
    }

    function test_HandlerCanDriveEveryLifecycleToAConservingTerminalState() external {
        for (uint256 variant = 0; variant < 4; ++variant) {
            handler.createRound(variant);
            for (uint256 pass = 0; pass < 12; ++pass) {
                handler.advanceRound(variant);
            }
        }
        handler.withdrawCredit();

        assertTrue(handler.allRoundsTerminalAndSwept());
        assertEq(handler.usdc().balanceOf(address(handler.panel())), 0);
        assertEq(handler.retryOrderViolations(), 0);
        assertEq(handler.zeroCommitRounds(), 1);
        assertEq(handler.finalizedRounds(), 1);
        assertEq(handler.underQuorumRounds(), 1);
        assertEq(handler.beaconFailureRounds(), 1);
    }
}
