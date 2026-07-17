// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";
import { CredentialIssuer } from "../../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessFeedbackBonus } from "../../contracts/tokenless/TokenlessFeedbackBonus.sol";
import { TokenlessPanel } from "../../contracts/tokenless/TokenlessPanel.sol";

contract TokenlessFeedbackBonusInvariantHandler is Test {
    uint256 internal constant ISSUER_PK = 0xA11CE;
    uint256 internal constant BOUNTY = 90e6;
    uint256 internal constant FIXED_BASE = 24e6;
    uint256 internal constant RESERVE = FIXED_BASE * 3;
    uint256 internal constant PANEL_TOTAL = BOUNTY + RESERVE;
    uint256 internal constant MAX_SCENARIOS = 16;
    bytes32 internal constant ADMISSION_POLICY_HASH = keccak256("bonus-invariant-audience");

    struct Scenario {
        uint256 poolId;
        address voteKey;
        address payout;
        bytes32 salt;
        uint64 feedbackDeadline;
        uint64 awardDeadline;
        bool awarded;
        bool claimed;
    }

    MockERC20 public immutable usdc;
    CredentialIssuer public immutable issuer;
    TokenlessPanel public immutable panel;
    TokenlessFeedbackBonus public immutable bonus;

    Scenario[] internal _scenarios;
    uint256 public totalBonusDeposited;
    uint256 public totalBonusAwarded;
    uint256 public totalBonusClaimed;
    uint256 public totalBonusRefunded;
    uint256 public totalPanelDeposited;

    constructor() {
        vm.warp(2_000_000_000);
        usdc = new MockERC20("Invariant USDC", "iUSDC", 6);
        issuer = new CredentialIssuer(address(this), vm.addr(ISSUER_PK), 1 days);
        panel = new TokenlessPanel(address(usdc), address(issuer));
        bonus = new TokenlessFeedbackBonus(address(usdc), address(issuer));
        usdc.mint(address(this), type(uint128).max);
        usdc.approve(address(panel), type(uint256).max);
        usdc.approve(address(bonus), type(uint256).max);
    }

    function createScenario(uint256 amountSeed) external {
        if (_scenarios.length >= MAX_SCENARIOS) return;
        uint256 index = _scenarios.length;
        uint256 amount = bound(amountSeed, 1, 1_000_000e6);
        bytes32 reviewId = keccak256(abi.encode("bonus-invariant-review", index, block.timestamp));
        bytes32 contentId = keccak256(abi.encode("bonus-invariant-content", index, block.timestamp));

        TokenlessPanel.RoundTerms memory panelTerms = TokenlessPanel.RoundTerms({
            contentId: contentId,
            termsHash: keccak256(abi.encode("bonus-invariant-panel-terms", index, block.timestamp)),
            beaconNetworkHash: keccak256("drand-quicknet"),
            bountyAmount: BOUNTY,
            feeAmount: 0,
            attemptReserve: RESERVE,
            attemptCompensation: FIXED_BASE,
            minimumReveals: 3,
            maximumCommits: 3,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            commitDeadline: uint64(block.timestamp + 10 minutes),
            revealDeadline: uint64(block.timestamp + 20 minutes),
            beaconFailureDeadline: uint64(block.timestamp + 30 minutes),
            beaconRound: uint64(50_000 + index),
            claimGracePeriod: 1 hours,
            feeRecipient: address(0)
        });
        panel.createRound(panelTerms);

        TokenlessFeedbackBonus.PoolTerms memory terms = TokenlessFeedbackBonus.PoolTerms({
            reviewId: reviewId,
            contentId: contentId,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            amount: amount,
            feedbackDeadline: uint64(block.timestamp + 20 minutes),
            awardDeadline: uint64(block.timestamp + 1 hours)
        });
        uint256 poolId = bonus.createPool(terms, address(this));
        uint256 privateKey = 10_000 + index;
        address voteKey = vm.addr(privateKey);
        address payout = address(uint160(uint256(keccak256(abi.encode("bonus-invariant-payout", index)))));
        bytes32 salt = keccak256(abi.encode("bonus-invariant-salt", index));
        bytes32 nullifier = keccak256(abi.encode("bonus-invariant-nullifier", index));
        bytes32 responseHash = keccak256(abi.encode("bonus-invariant-response", index));
        bytes32 payoutCommitment = bonus.payoutCommitmentFor(payout, salt);
        TokenlessFeedbackBonus.Voucher memory voucher = TokenlessFeedbackBonus.Voucher({
            voteKey: voteKey,
            reviewId: reviewId,
            contentId: contentId,
            poolId: poolId,
            nullifier: nullifier,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            issuerEpoch: 1,
            expiresAt: terms.feedbackDeadline
        });
        bonus.registerFeedback(
            voucher,
            responseHash,
            payoutCommitment,
            _sign(ISSUER_PK, bonus.voucherDigest(voucher)),
            _sign(privateKey, bonus.feedbackDigest(poolId, responseHash, payoutCommitment, nullifier))
        );

        _scenarios.push(
            Scenario({
                poolId: poolId,
                voteKey: voteKey,
                payout: payout,
                salt: salt,
                feedbackDeadline: terms.feedbackDeadline,
                awardDeadline: terms.awardDeadline,
                awarded: false,
                claimed: false
            })
        );
        totalPanelDeposited += PANEL_TOTAL;
        totalBonusDeposited += amount;
    }

    function awardFeedback(uint256 seed, uint256 amountSeed) external {
        if (_scenarios.length == 0) return;
        Scenario storage scenario = _scenarios[seed % _scenarios.length];
        if (scenario.awarded || block.timestamp > scenario.awardDeadline) return;
        if (block.timestamp <= scenario.feedbackDeadline) vm.warp(scenario.feedbackDeadline + 1);
        uint256 remaining = bonus.remainingAmount(scenario.poolId);
        if (remaining == 0) return;
        uint256 amount = bound(amountSeed, 1, remaining);
        bonus.award(scenario.poolId, scenario.voteKey, amount);
        scenario.awarded = true;
        totalBonusAwarded += amount;
    }

    function claimFeedback(uint256 seed) external {
        if (_scenarios.length == 0) return;
        Scenario storage scenario = _scenarios[seed % _scenarios.length];
        if (!scenario.awarded || scenario.claimed) return;
        totalBonusClaimed += bonus.claimAward(scenario.poolId, scenario.voteKey, scenario.payout, scenario.salt);
        scenario.claimed = true;
    }

    function refundRemainder(uint256 seed) external {
        if (_scenarios.length == 0) return;
        Scenario storage scenario = _scenarios[seed % _scenarios.length];
        TokenlessFeedbackBonus.Pool memory pool = bonus.getPool(scenario.poolId);
        if (pool.refunded || bonus.remainingAmount(scenario.poolId) == 0) return;
        if (block.timestamp <= scenario.awardDeadline) vm.warp(scenario.awardDeadline + 1);
        totalBonusRefunded += bonus.refundRemainder(scenario.poolId);
    }

    function scenarioCount() external view returns (uint256) {
        return _scenarios.length;
    }

    function poolIdAt(uint256 index) external view returns (uint256) {
        return _scenarios[index].poolId;
    }

    function voteKeyAt(uint256 index) external view returns (address) {
        return _scenarios[index].voteKey;
    }

    function _sign(uint256 privateKey, bytes32 digest) private pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}

contract TokenlessFeedbackBonusInvariantTest is StdInvariant, Test {
    TokenlessFeedbackBonusInvariantHandler internal handler;

    function setUp() external {
        handler = new TokenlessFeedbackBonusInvariantHandler();
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.createScenario.selector;
        selectors[1] = handler.awardFeedback.selector;
        selectors[2] = handler.claimFeedback.selector;
        selectors[3] = handler.refundRemainder.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_AllFeedbackBonusFundsRemainConserved() external view {
        assertEq(
            handler.usdc().balanceOf(address(handler.bonus())),
            handler.totalBonusDeposited() - handler.totalBonusClaimed() - handler.totalBonusRefunded()
        );
    }

    function invariant_PoolLiabilitiesAreFullyBacked() external view {
        uint256 liability;
        uint256 count = handler.scenarioCount();
        for (uint256 i = 0; i < count; ++i) {
            uint256 poolId = handler.poolIdAt(i);
            liability += handler.bonus().remainingAmount(poolId);
            TokenlessFeedbackBonus.FeedbackRecord memory feedback =
                handler.bonus().getFeedback(poolId, handler.voteKeyAt(i));
            if (feedback.awarded && !feedback.claimed) liability += feedback.awardAmount;
        }
        assertEq(liability, handler.usdc().balanceOf(address(handler.bonus())));
    }

    function invariant_FeedbackBonusCannotConsumeBasePanelFunds() external view {
        assertEq(handler.usdc().balanceOf(address(handler.panel())), handler.totalPanelDeposited());
    }

    function test_HandlerExercisesAwardAndRefundWithoutChangingBaseCustody() external {
        handler.createScenario(30e6);
        handler.awardFeedback(0, 7e6);
        handler.refundRemainder(0);
        handler.claimFeedback(0);
        assertEq(handler.totalBonusAwarded(), 7e6);
        assertEq(handler.totalBonusClaimed(), 7e6);
        assertEq(handler.totalBonusRefunded(), 23e6);
        assertEq(handler.usdc().balanceOf(address(handler.bonus())), 0);
        assertEq(handler.usdc().balanceOf(address(handler.panel())), 90e6 + (24e6 * 3));
    }
}
