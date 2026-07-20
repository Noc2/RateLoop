// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";
import { CredentialIssuer } from "../../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessPanel } from "../../contracts/tokenless/TokenlessPanel.sol";
import { MockBeaconVerifier } from "../../contracts/mocks/MockBeaconVerifier.sol";

/// @notice End-to-end maximum-panel settlement gas regression.
/// @dev Gas measurements include contract-call execution plus a conservative 100k transaction-envelope allowance.
///      L1 data fees are chain-priced separately and are not EVM execution gas.
contract TokenlessPanelGasBenchmarkTest is Test {
    uint32 internal constant MAXIMUM_SEATS = 500;
    uint32 internal constant PAGE_SIZE = 25;
    uint256 internal constant ISSUER_PK = 0xA11CE;
    uint256 internal constant BOUNTY = 1_000e6;
    uint256 internal constant FEE = 10e6;
    uint256 internal constant FIXED_BASE = 1_600_000;
    uint256 internal constant ATTEMPT_RESERVE = FIXED_BASE * MAXIMUM_SEATS;
    uint256 internal constant TRANSACTION_ENVELOPE_GAS = 100_000;

    // These ceilings are the deployment guardrails documented in docs/tokenless-rbts-v1-spec.md.
    uint256 internal constant BEGIN_SETTLEMENT_GAS_CEILING = 200_000;
    uint256 internal constant AGGREGATE_PAGE_GAS_CEILING = 250_000;
    uint256 internal constant FINALIZE_SEED_GAS_CEILING = 10_000_000;
    uint256 internal constant SCORE_PAGE_GAS_CEILING = 2_500_000;
    uint256 internal constant FINALIZE_SETTLEMENT_GAS_CEILING = 250_000;
    uint256 internal constant TOTAL_SETTLEMENT_GAS_BUDGET = 60_000_000;

    bytes32 internal constant CONTENT_ID = keccak256("500-seat-gas-benchmark");
    bytes32 internal constant TERMS_HASH = keccak256("500-seat-gas-benchmark-terms-v1");
    bytes32 internal constant ADMISSION_POLICY_HASH = keccak256("500-seat-gas-benchmark-policy-v1");
    bytes32 internal constant ENTROPY = keccak256("500-seat-gas-benchmark-entropy");

    address internal funder = makeAddr("gas-benchmark-funder");
    address internal feeRecipient = makeAddr("gas-benchmark-fee-recipient");
    address internal relayer = makeAddr("gas-benchmark-relayer");

    MockERC20 internal usdc;
    CredentialIssuer internal issuer;
    TokenlessPanel internal panel;
    MockBeaconVerifier internal beaconVerifier;

    struct Seat {
        uint256 privateKey;
        address voteKey;
        address payout;
        bytes32 nullifier;
        bytes32 salt;
        bytes32 responseHash;
        uint8 vote;
        uint16 prediction;
    }

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        issuer = new CredentialIssuer(makeAddr("gas-benchmark-rotation-authority"), vm.addr(ISSUER_PK), 1 days);
        beaconVerifier = new MockBeaconVerifier();
        panel = new TokenlessPanel(address(usdc), address(issuer), address(beaconVerifier));
        usdc.mint(funder, 10_000e6);
        vm.prank(funder);
        usdc.approve(address(panel), type(uint256).max);
    }

    function test_GasMaximumSeatSettlementLifecycleStaysWithinBudget() public {
        vm.pauseGasMetering();
        vm.prank(funder);
        uint256 roundId = panel.createRound(_terms());
        for (uint32 index = 0; index < MAXIMUM_SEATS; ++index) {
            _commit(roundId, _seat(roundId, index));
        }
        vm.warp(panel.getRound(roundId).commitDeadline + 1);
        for (uint32 index = 0; index < MAXIMUM_SEATS; ++index) {
            _reveal(roundId, _seat(roundId, index));
        }
        vm.warp(panel.getRound(roundId).revealDeadline + 1);
        vm.resumeGasMetering();

        uint256 totalBudgetedGas;
        uint256 beginGas = _measureBeginSettlement(roundId);
        _assertTransactionCeiling("beginSettlement", beginGas, BEGIN_SETTLEMENT_GAS_CEILING);
        totalBudgetedGas += beginGas + TRANSACTION_ENVELOPE_GAS;

        uint256 aggregateGas;
        uint256 maximumAggregatePageGas;
        for (uint32 cursor = 0; cursor < MAXIMUM_SEATS; cursor += PAGE_SIZE) {
            uint256 pageGas = _measureAggregate(roundId, cursor);
            aggregateGas += pageGas;
            if (pageGas > maximumAggregatePageGas) maximumAggregatePageGas = pageGas;
            _assertTransactionCeiling("processAggregate", pageGas, AGGREGATE_PAGE_GAS_CEILING);
            totalBudgetedGas += pageGas + TRANSACTION_ENVELOPE_GAS;
        }

        uint256 seedGas = _measureFinalizeSeed(roundId);
        _assertTransactionCeiling("finalizeScoringSeed", seedGas, FINALIZE_SEED_GAS_CEILING);
        totalBudgetedGas += seedGas + TRANSACTION_ENVELOPE_GAS;

        uint256 scoringGas;
        uint256 maximumScorePageGas;
        for (uint32 cursor = 0; cursor < MAXIMUM_SEATS; cursor += PAGE_SIZE) {
            uint256 pageGas = _measureScores(roundId, cursor);
            scoringGas += pageGas;
            if (pageGas > maximumScorePageGas) maximumScorePageGas = pageGas;
            _assertTransactionCeiling("processScores", pageGas, SCORE_PAGE_GAS_CEILING);
            totalBudgetedGas += pageGas + TRANSACTION_ENVELOPE_GAS;
        }

        uint256 finalizeGas = _measureFinalizeSettlement(roundId);
        _assertTransactionCeiling("finalizeSettlement", finalizeGas, FINALIZE_SETTLEMENT_GAS_CEILING);
        totalBudgetedGas += finalizeGas + TRANSACTION_ENVELOPE_GAS;

        TokenlessPanel.Round memory round = panel.getRound(roundId);
        assertEq(round.frozenRevealCount, MAXIMUM_SEATS);
        assertEq(round.aggregateCursor, MAXIMUM_SEATS);
        assertEq(round.scoreCursor, MAXIMUM_SEATS);
        assertEq(uint8(round.state), uint8(TokenlessPanel.RoundState.Finalized));
        assertGt(round.totalFinalizedLiability, 0);
        assertLe(round.totalFinalizedLiability, BOUNTY);
        assertLe(totalBudgetedGas, TOTAL_SETTLEMENT_GAS_BUDGET, "total settlement gas budget");

        emit log_named_uint("500-seat beginSettlement execution gas", beginGas);
        emit log_named_uint("500-seat aggregate pages", MAXIMUM_SEATS / PAGE_SIZE);
        emit log_named_uint("500-seat aggregate execution gas total", aggregateGas);
        emit log_named_uint("500-seat maximum aggregate page execution gas", maximumAggregatePageGas);
        emit log_named_uint("500-seat finalizeScoringSeed execution gas", seedGas);
        emit log_named_uint("500-seat score pages", MAXIMUM_SEATS / PAGE_SIZE);
        emit log_named_uint("500-seat scoring execution gas total", scoringGas);
        emit log_named_uint("500-seat maximum score page execution gas", maximumScorePageGas);
        emit log_named_uint("500-seat finalizeSettlement execution gas", finalizeGas);
        emit log_named_uint("500-seat total gas including transaction allowances", totalBudgetedGas);
    }

    function _terms() internal view returns (TokenlessPanel.RoundTerms memory) {
        return TokenlessPanel.RoundTerms({
            contentId: CONTENT_ID,
            termsHash: TERMS_HASH,
            beaconNetworkHash: 0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5,
            bountyAmount: BOUNTY,
            feeAmount: FEE,
            attemptReserve: ATTEMPT_RESERVE,
            attemptCompensation: FIXED_BASE,
            minimumReveals: MAXIMUM_SEATS,
            maximumCommits: MAXIMUM_SEATS,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            commitDeadline: uint64(block.timestamp + 10 minutes),
            revealDeadline: uint64(block.timestamp + 20 minutes),
            beaconFailureDeadline: uint64(block.timestamp + 6 hours + 20 minutes + 3 seconds),
            beaconRound: uint64((block.timestamp + 10 minutes - 1_689_232_296) / 3 + 2),
            scoringBeaconRound: uint64((block.timestamp + 20 minutes - 1_689_232_296) / 3 + 2),
            claimGracePeriod: 1 days,
            feeRecipient: feeRecipient
        });
    }

    function _seat(uint256 roundId, uint32 index) internal pure returns (Seat memory seat) {
        seat.privateKey = 0x100_000 + uint256(index);
        seat.voteKey = vm.addr(seat.privateKey);
        seat.payout = address(uint160(uint256(keccak256(abi.encode("payout", roundId, index)))));
        seat.nullifier = keccak256(abi.encode("nullifier", roundId, index));
        seat.salt = keccak256(abi.encode("salt", roundId, index));
        seat.responseHash = keccak256(abi.encode("response", roundId, index));
        seat.vote = uint8(index % 2);
        seat.prediction = uint16(100 + (index % 99) * 100);
    }

    function _commit(uint256 roundId, Seat memory seat) internal {
        TokenlessPanel.Voucher memory voucher = TokenlessPanel.Voucher({
            voteKey: seat.voteKey,
            contentId: CONTENT_ID,
            roundId: roundId,
            nullifier: seat.nullifier,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            issuerEpoch: 1,
            expiresAt: uint64(block.timestamp + 1 hours)
        });
        bytes32 sealedCommitment = panel.revealCommitment(
            roundId, seat.voteKey, seat.vote, seat.prediction, seat.responseHash, seat.payout, seat.salt
        );
        bytes32 payoutCommitment = panel.payoutCommitmentFor(seat.payout, seat.salt);
        bytes memory sealedPayload = abi.encodePacked("gas-benchmark", indexFromVoteKey(seat.voteKey));
        bytes memory voucherSignature = _sign(ISSUER_PK, panel.voucherDigest(voucher));
        bytes memory voteSignature = _sign(
            seat.privateKey,
            panel.commitDigest(roundId, sealedCommitment, keccak256(sealedPayload), payoutCommitment, seat.nullifier)
        );
        vm.prank(relayer);
        panel.commit(voucher, sealedCommitment, sealedPayload, payoutCommitment, voucherSignature, voteSignature);
    }

    function _reveal(uint256 roundId, Seat memory seat) internal {
        vm.prank(relayer);
        panel.reveal(roundId, seat.voteKey, seat.vote, seat.prediction, seat.responseHash, seat.payout, seat.salt);
    }

    function _measureBeginSettlement(uint256 roundId) internal returns (uint256 gasUsed) {
        uint256 gasBefore = gasleft();
        panel.beginSettlement(roundId);
        gasUsed = gasBefore - gasleft();
    }

    function _measureAggregate(uint256 roundId, uint32 cursor) internal returns (uint256 gasUsed) {
        uint256 gasBefore = gasleft();
        panel.processAggregate(roundId, cursor, PAGE_SIZE);
        gasUsed = gasBefore - gasleft();
    }

    function _measureFinalizeSeed(uint256 roundId) internal returns (uint256 gasUsed) {
        TokenlessPanel.Round memory round = panel.getRound(roundId);
        bytes32 proof = beaconVerifier.proofFor(round.beaconNetworkHash, round.scoringBeaconRound, ENTROPY);
        uint256 gasBefore = gasleft();
        panel.finalizeScoringSeed(roundId, ENTROPY, abi.encode(proof));
        gasUsed = gasBefore - gasleft();
    }

    function _measureScores(uint256 roundId, uint32 cursor) internal returns (uint256 gasUsed) {
        uint256 gasBefore = gasleft();
        panel.processScores(roundId, cursor, PAGE_SIZE);
        gasUsed = gasBefore - gasleft();
    }

    function _measureFinalizeSettlement(uint256 roundId) internal returns (uint256 gasUsed) {
        uint256 gasBefore = gasleft();
        panel.finalizeSettlement(roundId);
        gasUsed = gasBefore - gasleft();
    }

    function _assertTransactionCeiling(string memory operation, uint256 executionGas, uint256 ceiling) internal pure {
        assertLe(executionGas + TRANSACTION_ENVELOPE_GAS, ceiling, operation);
    }

    function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function indexFromVoteKey(address voteKey) internal pure returns (bytes20) {
        return bytes20(voteKey);
    }
}
