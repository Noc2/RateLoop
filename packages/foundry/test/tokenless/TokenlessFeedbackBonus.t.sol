// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";
import { CredentialIssuer } from "../../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessFeedbackBonus } from "../../contracts/tokenless/TokenlessFeedbackBonus.sol";

contract TokenlessFeedbackBonusTest is Test {
    uint256 internal constant ISSUER_PK = 0xA11CE;
    uint256 internal constant BONUS_POOL = 30e6;
    bytes32 internal constant REVIEW_ID = keccak256("optional-feedback-review");
    bytes32 internal constant CONTENT_ID = keccak256("optional-feedback-content");
    bytes32 internal constant ADMISSION_POLICY_HASH = keccak256("optional-feedback-audience");

    address internal funder = makeAddr("requester");
    address internal payer = makeAddr("purposeBoundPrepaidPayer");
    address internal awarder = makeAddr("designatedHumanAwarder");
    address internal outsider = makeAddr("outsider");
    address internal relayer = makeAddr("relayer");

    MockERC20 internal usdc;
    CredentialIssuer internal issuer;
    TokenlessFeedbackBonus internal bonus;

    struct Rater {
        uint256 privateKey;
        address voteKey;
        address payout;
        bytes32 nullifier;
        bytes32 salt;
        bytes32 responseHash;
    }

    function setUp() public {
        vm.warp(1_900_000_000);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        issuer = new CredentialIssuer(address(this), vm.addr(ISSUER_PK), 1 days);
        bonus = new TokenlessFeedbackBonus(address(usdc), address(issuer));
        usdc.mint(funder, 10_000e6);
        usdc.mint(payer, 10_000e6);
        vm.prank(funder);
        usdc.approve(address(bonus), type(uint256).max);
        vm.prank(payer);
        usdc.approve(address(bonus), type(uint256).max);
    }

    function test_BonusIsOptionalAndIndependentOfAnyBaseBounty() public {
        uint256 poolId = _createPool(address(0));
        TokenlessFeedbackBonus.Pool memory pool = bonus.getPool(poolId);
        assertEq(pool.reviewId, REVIEW_ID);
        assertEq(pool.contentId, CONTENT_ID);
        assertEq(pool.funder, funder);
        assertEq(pool.awarder, funder);
        assertEq(pool.depositedAmount, BONUS_POOL);
        assertEq(bonus.reviewPoolId(bonus.poolKeyFor(funder, REVIEW_ID)), poolId);
        assertEq(usdc.balanceOf(address(bonus)), BONUS_POOL);
    }

    function test_ReviewIdCannotBeSquattedAcrossDifferentRequesters() public {
        // An attacker front-runs the legitimate requester with the same review ID. Pool
        // uniqueness is namespaced by the paying requester, so it only occupies the attacker's
        // namespace and cannot brick the legitimate requester's pool.
        TokenlessFeedbackBonus.PoolTerms memory attackerTerms = _terms(REVIEW_ID);
        vm.prank(payer);
        uint256 attackerPool = bonus.createPool(attackerTerms, awarder);

        TokenlessFeedbackBonus.PoolTerms memory requesterTerms = _terms(REVIEW_ID);
        vm.prank(funder);
        uint256 requesterPool = bonus.createPool(requesterTerms, awarder);

        assertTrue(attackerPool != requesterPool);
        assertEq(bonus.reviewPoolId(bonus.poolKeyFor(payer, REVIEW_ID)), attackerPool);
        assertEq(bonus.reviewPoolId(bonus.poolKeyFor(funder, REVIEW_ID)), requesterPool);
        assertEq(bonus.getPool(requesterPool).funder, funder);

        // The paying requester still cannot create a second pool for the same review ID.
        vm.prank(funder);
        vm.expectRevert(TokenlessFeedbackBonus.PoolAlreadyExists.selector);
        bonus.createPool(_terms(REVIEW_ID), awarder);
    }

    function test_CreatePoolForSquatIsBoundToThePayerNotTheNamedFunder() public {
        // Even naming the victim as funder via the prepaid path cannot squat: the key is bound to
        // the paying attacker (msg.sender), not the caller-chosen funder address.
        vm.prank(payer);
        uint256 squatPool = bonus.createPoolFor(_terms(REVIEW_ID), funder, awarder);

        vm.prank(funder);
        uint256 requesterPool = bonus.createPool(_terms(REVIEW_ID), awarder);

        assertTrue(squatPool != requesterPool);
        assertEq(bonus.reviewPoolId(bonus.poolKeyFor(payer, REVIEW_ID)), squatPool);
        assertEq(bonus.reviewPoolId(bonus.poolKeyFor(funder, REVIEW_ID)), requesterPool);
    }

    function test_PrepaidPayerFreezesRequesterRefundAndHumanAwarder() public {
        TokenlessFeedbackBonus.PoolTerms memory terms = _terms(REVIEW_ID);
        vm.prank(payer);
        uint256 poolId = bonus.createPoolFor(terms, funder, awarder);
        TokenlessFeedbackBonus.Pool memory pool = bonus.getPool(poolId);
        assertEq(pool.funder, funder);
        assertEq(pool.awarder, awarder);
        assertEq(usdc.balanceOf(payer), 10_000e6 - BONUS_POOL);
    }

    function test_RejectsInvalidOrDuplicatePoolsAndFeeOnTransferShortfalls() public {
        TokenlessFeedbackBonus.PoolTerms memory terms = _terms(REVIEW_ID);
        vm.prank(funder);
        bonus.createPool(terms, awarder);
        vm.prank(funder);
        vm.expectRevert(TokenlessFeedbackBonus.PoolAlreadyExists.selector);
        bonus.createPool(terms, awarder);

        TokenlessFeedbackBonus.PoolTerms memory second = _terms(keccak256("second-review"));
        second.amount = 0;
        vm.prank(funder);
        vm.expectRevert(TokenlessFeedbackBonus.InvalidAmount.selector);
        bonus.createPool(second, awarder);
        second.amount = BONUS_POOL;
        second.feedbackDeadline = uint64(block.timestamp);
        vm.prank(funder);
        vm.expectRevert(TokenlessFeedbackBonus.InvalidDeadline.selector);
        bonus.createPool(second, awarder);

        second.feedbackDeadline = uint64(block.timestamp + 1 hours);
        second.awardDeadline = uint64(block.timestamp + 2 hours);
        usdc.setTransferShortfall(1);
        vm.prank(funder);
        vm.expectRevert(TokenlessFeedbackBonus.TransferAmountMismatch.selector);
        bonus.createPool(second, awarder);
        assertEq(bonus.reviewPoolId(bonus.poolKeyFor(funder, second.reviewId)), 0);
    }

    function test_RegistersOnlyCredentialedTimelyFeedbackWithVoteKeyConsent() public {
        uint256 poolId = _createPool(awarder);
        Rater memory alice = _rater(0xA11, "alice", poolId);
        TokenlessFeedbackBonus.Voucher memory voucher = _voucher(alice, poolId);
        bytes memory issuerSignature = _sign(ISSUER_PK, bonus.voucherDigest(voucher));
        bytes32 payoutCommitment = bonus.payoutCommitmentFor(alice.payout, alice.salt);
        bytes memory raterSignature = _sign(
            alice.privateKey, bonus.feedbackDigest(poolId, alice.responseHash, payoutCommitment, alice.nullifier)
        );

        vm.prank(relayer);
        bonus.registerFeedback(voucher, alice.responseHash, payoutCommitment, issuerSignature, raterSignature);
        TokenlessFeedbackBonus.FeedbackRecord memory record = bonus.getFeedback(poolId, alice.voteKey);
        assertEq(record.voteKey, alice.voteKey);
        assertEq(record.responseHash, alice.responseHash);
        assertEq(record.registeredAt, block.timestamp);

        vm.prank(relayer);
        vm.expectRevert(TokenlessFeedbackBonus.NullifierAlreadyUsed.selector);
        bonus.registerFeedback(voucher, alice.responseHash, payoutCommitment, issuerSignature, raterSignature);

        Rater memory bob = _rater(0xB0B, "bob", poolId);
        TokenlessFeedbackBonus.Voucher memory bobVoucher = _voucher(bob, poolId);
        bytes32 bobPayoutCommitment = bonus.payoutCommitmentFor(bob.payout, bob.salt);
        bytes memory bobIssuerSignature = _sign(ISSUER_PK, bonus.voucherDigest(bobVoucher));
        bytes memory bobRaterSignature =
            _sign(bob.privateKey, bonus.feedbackDigest(poolId, bob.responseHash, bobPayoutCommitment, bob.nullifier));
        vm.warp(bonus.getPool(poolId).feedbackDeadline + 1);
        vm.expectRevert(TokenlessFeedbackBonus.FeedbackWindowClosed.selector);
        bonus.registerFeedback(bobVoucher, bob.responseHash, bobPayoutCommitment, bobIssuerSignature, bobRaterSignature);
    }

    function test_RejectsForgedIssuerAndVoteKeySignatures() public {
        uint256 poolId = _createPool(awarder);
        Rater memory alice = _rater(0xA11, "alice", poolId);
        TokenlessFeedbackBonus.Voucher memory voucher = _voucher(alice, poolId);
        bytes32 payoutCommitment = bonus.payoutCommitmentFor(alice.payout, alice.salt);
        bytes32 digest = bonus.feedbackDigest(poolId, alice.responseHash, payoutCommitment, alice.nullifier);
        bytes memory forgedIssuerSignature = _sign(0xBAD, bonus.voucherDigest(voucher));
        bytes memory issuerSignature = _sign(ISSUER_PK, bonus.voucherDigest(voucher));
        bytes memory raterSignature = _sign(alice.privateKey, digest);
        bytes memory forgedRaterSignature = _sign(0xBAD, digest);

        vm.expectRevert(TokenlessFeedbackBonus.InvalidSignature.selector);
        bonus.registerFeedback(voucher, alice.responseHash, payoutCommitment, forgedIssuerSignature, raterSignature);
        vm.expectRevert(TokenlessFeedbackBonus.InvalidSignature.selector);
        bonus.registerFeedback(voucher, alice.responseHash, payoutCommitment, issuerSignature, forgedRaterSignature);
    }

    function test_OnlyHumanAwarderChoosesPartialAndMultipleAwards() public {
        uint256 poolId = _createPool(awarder);
        Rater memory alice = _rater(0xA11, "alice", poolId);
        Rater memory bob = _rater(0xB0B, "bob", poolId);
        _register(alice, poolId);
        _register(bob, poolId);
        vm.warp(bonus.getPool(poolId).feedbackDeadline + 1);

        vm.prank(outsider);
        vm.expectRevert(TokenlessFeedbackBonus.Unauthorized.selector);
        bonus.award(poolId, alice.voteKey, 7e6);

        vm.prank(awarder);
        bonus.award(poolId, alice.voteKey, 7e6);
        vm.prank(awarder);
        bonus.award(poolId, bob.voteKey, 11e6);
        assertEq(usdc.balanceOf(alice.payout), 0);
        assertEq(usdc.balanceOf(bob.payout), 0);
        bonus.claimAward(poolId, alice.voteKey, alice.payout, alice.salt);
        bonus.claimAward(poolId, bob.voteKey, bob.payout, bob.salt);
        assertEq(usdc.balanceOf(alice.payout), 7e6);
        assertEq(usdc.balanceOf(bob.payout), 11e6);
        assertEq(bonus.remainingAmount(poolId), 12e6);
    }

    function test_EachRaterAndResponseHashCanBeAwardedOnlyOnce() public {
        uint256 poolId = _createPool(awarder);
        bytes32 sharedHash = keccak256("same-feedback");
        Rater memory alice = _rater(0xA11, "alice", poolId);
        Rater memory bob = _rater(0xB0B, "bob", poolId);
        alice.responseHash = sharedHash;
        bob.responseHash = sharedHash;
        _register(alice, poolId);
        _register(bob, poolId);
        vm.warp(bonus.getPool(poolId).feedbackDeadline + 1);
        vm.prank(awarder);
        bonus.award(poolId, alice.voteKey, 5e6);
        vm.prank(awarder);
        vm.expectRevert(TokenlessFeedbackBonus.AlreadyAwarded.selector);
        bonus.award(poolId, alice.voteKey, 1e6);
        vm.prank(awarder);
        vm.expectRevert(TokenlessFeedbackBonus.AlreadyAwarded.selector);
        bonus.award(poolId, bob.voteKey, 1e6);
    }

    function test_AwardPayoutPreimageRemainsWithRecipientAndClaimsAreExactlyOnce() public {
        uint256 poolId = _createPool(awarder);
        Rater memory alice = _rater(0xA11, "alice", poolId);
        _register(alice, poolId);
        TokenlessFeedbackBonus.Pool memory pool = bonus.getPool(poolId);
        vm.warp(pool.feedbackDeadline + 1);
        vm.prank(awarder);
        bonus.award(poolId, alice.voteKey, 7e6);
        TokenlessFeedbackBonus.FeedbackRecord memory awarded = bonus.getFeedback(poolId, alice.voteKey);
        assertTrue(awarded.awarded);
        assertFalse(awarded.claimed);
        assertEq(awarded.awardAmount, 7e6);

        vm.expectRevert(TokenlessFeedbackBonus.InvalidFeedback.selector);
        bonus.claimAward(poolId, alice.voteKey, outsider, alice.salt);
        bonus.claimAward(poolId, alice.voteKey, alice.payout, alice.salt);
        assertEq(usdc.balanceOf(alice.payout), 7e6);
        assertTrue(bonus.getFeedback(poolId, alice.voteKey).claimed);
        vm.expectRevert(TokenlessFeedbackBonus.AwardNotClaimable.selector);
        bonus.claimAward(poolId, alice.voteKey, alice.payout, alice.salt);
    }

    function test_UnawardedRemainderReturnsOnlyToFunderWithoutStrandingAwardedClaims() public {
        uint256 poolId = _createPool(awarder);
        Rater memory alice = _rater(0xA11, "alice", poolId);
        _register(alice, poolId);
        TokenlessFeedbackBonus.Pool memory pool = bonus.getPool(poolId);
        vm.warp(pool.feedbackDeadline + 1);
        vm.prank(awarder);
        bonus.award(poolId, alice.voteKey, 7e6);
        vm.warp(pool.awardDeadline + 1);
        uint256 before = usdc.balanceOf(funder);
        vm.prank(outsider);
        assertEq(bonus.refundRemainder(poolId), BONUS_POOL - 7e6);
        assertEq(usdc.balanceOf(funder) - before, BONUS_POOL - 7e6);
        vm.expectRevert(TokenlessFeedbackBonus.NothingToRefund.selector);
        bonus.refundRemainder(poolId);

        bonus.claimAward(poolId, alice.voteKey, alice.payout, alice.salt);
        assertEq(usdc.balanceOf(alice.payout), 7e6);
        assertEq(usdc.balanceOf(address(bonus)), 0);
    }

    function _terms(bytes32 reviewId) internal view returns (TokenlessFeedbackBonus.PoolTerms memory) {
        return TokenlessFeedbackBonus.PoolTerms({
            reviewId: reviewId,
            contentId: CONTENT_ID,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            amount: BONUS_POOL,
            feedbackDeadline: uint64(block.timestamp + 1 hours),
            awardDeadline: uint64(block.timestamp + 2 hours)
        });
    }

    function _createPool(address selectedAwarder) internal returns (uint256 poolId) {
        TokenlessFeedbackBonus.PoolTerms memory terms = _terms(REVIEW_ID);
        vm.prank(funder);
        poolId = bonus.createPool(terms, selectedAwarder);
    }

    function _rater(uint256 privateKey, string memory label, uint256 poolId)
        internal
        pure
        returns (Rater memory rater)
    {
        rater.privateKey = privateKey;
        rater.voteKey = vm.addr(privateKey);
        rater.payout = address(uint160(uint256(keccak256(abi.encode(label, "bonus-payout")))));
        rater.nullifier = keccak256(abi.encode("bonus-nullifier", label, poolId));
        rater.salt = keccak256(abi.encode("bonus-salt", label, poolId));
        rater.responseHash = keccak256(abi.encode("response", label, poolId));
    }

    function _voucher(Rater memory rater, uint256 poolId)
        internal
        view
        returns (TokenlessFeedbackBonus.Voucher memory)
    {
        TokenlessFeedbackBonus.Pool memory pool = bonus.getPool(poolId);
        return TokenlessFeedbackBonus.Voucher({
            voteKey: rater.voteKey,
            reviewId: pool.reviewId,
            contentId: pool.contentId,
            poolId: poolId,
            nullifier: rater.nullifier,
            admissionPolicyHash: pool.admissionPolicyHash,
            issuerEpoch: 1,
            expiresAt: pool.feedbackDeadline
        });
    }

    function _register(Rater memory rater, uint256 poolId) internal {
        TokenlessFeedbackBonus.Voucher memory voucher = _voucher(rater, poolId);
        bytes32 payoutCommitment = bonus.payoutCommitmentFor(rater.payout, rater.salt);
        bonus.registerFeedback(
            voucher,
            rater.responseHash,
            payoutCommitment,
            _sign(ISSUER_PK, bonus.voucherDigest(voucher)),
            _sign(rater.privateKey, bonus.feedbackDigest(poolId, rater.responseHash, payoutCommitment, rater.nullifier))
        );
    }

    function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
