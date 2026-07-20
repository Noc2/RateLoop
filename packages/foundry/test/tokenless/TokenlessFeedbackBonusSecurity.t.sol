// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";
import { CredentialIssuer } from "../../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessFeedbackBonus } from "../../contracts/tokenless/TokenlessFeedbackBonus.sol";
import { TokenlessPanel } from "../../contracts/tokenless/TokenlessPanel.sol";
import { MockBeaconVerifier } from "../../contracts/mocks/MockBeaconVerifier.sol";

contract TokenlessFeedbackBonusSecurityTest is Test {
    uint256 internal constant ISSUER_PK = 0xA11CE;
    uint256 internal constant RATER_PK = 0xB0B;
    uint256 internal constant BONUS_AMOUNT = 30e6;
    uint256 internal constant BASE_BOUNTY = 90e6;
    uint256 internal constant ATTEMPT_COMPENSATION = 24e6;
    uint256 internal constant ATTEMPT_RESERVE = ATTEMPT_COMPENSATION * 3;
    bytes32 internal constant ADMISSION_POLICY_HASH = keccak256("security-admission-policy");

    address internal requester = makeAddr("human-requester");
    address internal designatedHuman = makeAddr("designated-human-awarder");
    address internal prepaidPayer = makeAddr("purpose-bound-prepaid-payer");
    address internal agentRuntime = makeAddr("agent-runtime");
    address internal relayer = makeAddr("untrusted-relayer");
    address internal payout = makeAddr("rater-payout");

    MockERC20 internal usdc;
    CredentialIssuer internal issuer;
    TokenlessFeedbackBonus internal bonus;
    TokenlessPanel internal panel;

    function setUp() public {
        vm.warp(2_000_000_000);
        usdc = new MockERC20("Security USDC", "sUSDC", 6);
        issuer = new CredentialIssuer(address(this), vm.addr(ISSUER_PK), 1 days);
        bonus = new TokenlessFeedbackBonus(address(usdc), address(issuer));
        panel = new TokenlessPanel(address(usdc), address(issuer), address(new MockBeaconVerifier()));
        usdc.mint(requester, 1_000_000e6);
        usdc.mint(prepaidPayer, 1_000_000e6);
        vm.prank(requester);
        usdc.approve(address(bonus), type(uint256).max);
        vm.startPrank(prepaidPayer);
        usdc.approve(address(bonus), type(uint256).max);
        usdc.approve(address(panel), type(uint256).max);
        vm.stopPrank();
    }

    function test_AgentIssuerRelayerPayerAndRequesterCannotReplaceDesignatedHumanAwarder() public {
        uint256 poolId = _createPoolFor(bonus, keccak256("designated-review"), designatedHuman);
        Registration memory registration = _registration(bonus, poolId, RATER_PK, "designated-feedback");
        _register(bonus, registration);
        vm.warp(bonus.getPool(poolId).feedbackDeadline + 1);

        address[5] memory forbidden = [agentRuntime, address(issuer), relayer, prepaidPayer, requester];
        for (uint256 i = 0; i < forbidden.length; ++i) {
            vm.prank(forbidden[i]);
            vm.expectRevert(TokenlessFeedbackBonus.Unauthorized.selector);
            bonus.award(poolId, registration.voucher.voteKey, 7e6);
        }

        vm.prank(designatedHuman);
        bonus.award(poolId, registration.voucher.voteKey, 7e6);
        assertEq(usdc.balanceOf(payout), 0);
        bonus.claimAward(poolId, registration.voucher.voteKey, payout, registration.payoutSalt);
        assertEq(usdc.balanceOf(payout), 7e6);
        assertEq(bonus.getPool(poolId).awarder, designatedHuman);
    }

    function test_RequesterIsTheOnlyDefaultHumanAwarderAndTheBonusRemainsOptional() public {
        uint256 before = usdc.balanceOf(requester);
        TokenlessFeedbackBonus.PoolTerms memory terms = _bonusTerms(keccak256("requester-review"));
        vm.prank(requester);
        uint256 poolId = bonus.createPool(terms, address(0));
        assertEq(bonus.getPool(poolId).awarder, requester);
        assertEq(usdc.balanceOf(requester), before - BONUS_AMOUNT);

        Registration memory registration = _registration(bonus, poolId, RATER_PK, "requester-feedback");
        _register(bonus, registration);
        vm.warp(terms.feedbackDeadline + 1);
        vm.prank(agentRuntime);
        vm.expectRevert(TokenlessFeedbackBonus.Unauthorized.selector);
        bonus.award(poolId, registration.voucher.voteKey, 1e6);
        vm.prank(requester);
        bonus.award(poolId, registration.voucher.voteKey, 1e6);
    }

    function test_BonusAwardsAndRefundsCannotConsumeOrMutateBaseBountyCustody() public {
        TokenlessPanel.RoundTerms memory panelTerms = _panelTerms();
        vm.prank(prepaidPayer);
        uint256 roundId = panel.createRoundFor(panelTerms, requester);
        uint256 baseCustody = BASE_BOUNTY + ATTEMPT_RESERVE;
        assertEq(usdc.balanceOf(address(panel)), baseCustody);
        TokenlessPanel.Round memory beforeRound = panel.getRound(roundId);

        uint256 poolId = _createPoolFor(bonus, keccak256("isolated-funds-review"), designatedHuman);
        Registration memory registration = _registration(bonus, poolId, RATER_PK, "isolated-feedback");
        _register(bonus, registration);
        TokenlessFeedbackBonus.Pool memory pool = bonus.getPool(poolId);
        vm.warp(pool.feedbackDeadline + 1);
        vm.prank(designatedHuman);
        bonus.award(poolId, registration.voucher.voteKey, 11e6);
        assertEq(usdc.balanceOf(address(panel)), baseCustody);

        vm.warp(pool.awardDeadline + 1);
        bonus.refundRemainder(poolId);
        assertEq(usdc.balanceOf(address(bonus)), BONUS_AMOUNT);
        assertEq(bonus.withdrawableCredit(requester), BONUS_AMOUNT - 11e6);
        bonus.claimAward(poolId, registration.voucher.voteKey, payout, registration.payoutSalt);
        vm.prank(requester);
        bonus.withdrawCredit(requester);
        assertEq(usdc.balanceOf(address(bonus)), 0);
        assertEq(usdc.balanceOf(address(panel)), baseCustody);
        TokenlessPanel.Round memory afterRound = panel.getRound(roundId);
        assertEq(afterRound.bountyAmount, beforeRound.bountyAmount);
        assertEq(afterRound.attemptReserve, beforeRound.attemptReserve);
        assertEq(afterRound.totalPaid, 0);
        assertEq(uint8(afterRound.state), uint8(beforeRound.state));
    }

    function test_SignaturesFailClosedUnderFieldTamperingExactReplayAndCrossContractReplay() public {
        bytes32 reviewId = keccak256("signed-security-review");
        uint256 poolId = _createPoolFor(bonus, reviewId, designatedHuman);
        Registration memory original = _registration(bonus, poolId, RATER_PK, "signed-feedback");

        vm.expectRevert(TokenlessFeedbackBonus.InvalidSignature.selector);
        bonus.registerFeedback(
            original.voucher,
            keccak256("tampered-response"),
            original.payoutCommitment,
            original.voucherSignature,
            original.voteKeySignature
        );
        vm.expectRevert(TokenlessFeedbackBonus.InvalidSignature.selector);
        bonus.registerFeedback(
            original.voucher,
            original.responseHash,
            keccak256("tampered-payout"),
            original.voucherSignature,
            original.voteKeySignature
        );

        TokenlessFeedbackBonus.Voucher memory tamperedVoucher = original.voucher;
        tamperedVoucher.expiresAt -= 1;
        vm.expectRevert(TokenlessFeedbackBonus.InvalidSignature.selector);
        bonus.registerFeedback(
            tamperedVoucher,
            original.responseHash,
            original.payoutCommitment,
            original.voucherSignature,
            original.voteKeySignature
        );
        tamperedVoucher.expiresAt += 1;
        assertFalse(bonus.nullifierUsed(original.voucher.nullifier));

        TokenlessFeedbackBonus replayTarget = new TokenlessFeedbackBonus(address(usdc), address(issuer));
        vm.prank(prepaidPayer);
        usdc.approve(address(replayTarget), type(uint256).max);
        uint256 replayPoolId = _createPoolFor(replayTarget, reviewId, designatedHuman);
        assertEq(replayPoolId, poolId);
        vm.expectRevert(TokenlessFeedbackBonus.InvalidSignature.selector);
        replayTarget.registerFeedback(
            original.voucher,
            original.responseHash,
            original.payoutCommitment,
            original.voucherSignature,
            original.voteKeySignature
        );
        assertFalse(replayTarget.nullifierUsed(original.voucher.nullifier));

        _register(bonus, original);
        vm.expectRevert(TokenlessFeedbackBonus.NullifierAlreadyUsed.selector);
        _register(bonus, original);
        TokenlessFeedbackBonus.FeedbackRecord memory record = bonus.getFeedback(poolId, original.voucher.voteKey);
        assertEq(record.responseHash, original.responseHash);
        assertEq(record.payoutCommitment, original.payoutCommitment);
    }

    struct Registration {
        TokenlessFeedbackBonus.Voucher voucher;
        bytes32 responseHash;
        bytes32 payoutCommitment;
        bytes32 payoutSalt;
        bytes voucherSignature;
        bytes voteKeySignature;
    }

    function _createPoolFor(TokenlessFeedbackBonus target, bytes32 reviewId, address awarder)
        internal
        returns (uint256 poolId)
    {
        vm.prank(prepaidPayer);
        poolId = target.createPoolFor(_bonusTerms(reviewId), requester, awarder);
    }

    function _bonusTerms(bytes32 reviewId) internal view returns (TokenlessFeedbackBonus.PoolTerms memory) {
        return TokenlessFeedbackBonus.PoolTerms({
            reviewId: reviewId,
            contentId: keccak256(abi.encode("security-content", reviewId)),
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            amount: BONUS_AMOUNT,
            feedbackDeadline: uint64(block.timestamp + 1 hours),
            awardDeadline: uint64(block.timestamp + 2 hours)
        });
    }

    function _panelTerms() internal view returns (TokenlessPanel.RoundTerms memory) {
        uint64 commitDeadline = uint64(block.timestamp + 1 hours);
        uint64 revealDeadline = uint64(block.timestamp + 2 hours);
        uint64 disclosureRound = uint64((uint256(commitDeadline) - 1_689_232_296) / 3 + 2);
        uint64 scoringRound = uint64((uint256(revealDeadline) + 24 hours - 1_689_232_296) / 3 + 2);
        uint64 beaconFailureDeadline = uint64(1_689_232_296 + (uint256(scoringRound) - 1) * 3 + 6 hours);
        return TokenlessPanel.RoundTerms({
            contentId: keccak256("security-base-content"),
            termsHash: keccak256("security-base-terms"),
            beaconNetworkHash: 0xcc9c398442737cbd141526600919edd69f1d6f9b4adb67e4d912fbc64341a9a5,
            bountyAmount: BASE_BOUNTY,
            feeAmount: 0,
            attemptReserve: ATTEMPT_RESERVE,
            attemptCompensation: ATTEMPT_COMPENSATION,
            minimumReveals: 3,
            maximumCommits: 3,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            commitDeadline: commitDeadline,
            revealDeadline: revealDeadline,
            beaconFailureDeadline: beaconFailureDeadline,
            beaconRound: disclosureRound,
            scoringBeaconRound: scoringRound,
            claimGracePeriod: 1 hours,
            feeRecipient: address(0)
        });
    }

    function _registration(TokenlessFeedbackBonus target, uint256 poolId, uint256 privateKey, string memory label)
        internal
        view
        returns (Registration memory registration)
    {
        TokenlessFeedbackBonus.Pool memory pool = target.getPool(poolId);
        registration.payoutSalt = keccak256(abi.encode("payout-salt", label));
        registration.responseHash = keccak256(abi.encode("response", label));
        registration.payoutCommitment = target.payoutCommitmentFor(payout, registration.payoutSalt);
        registration.voucher = TokenlessFeedbackBonus.Voucher({
            voteKey: vm.addr(privateKey),
            reviewId: pool.reviewId,
            contentId: pool.contentId,
            poolId: poolId,
            nullifier: keccak256(abi.encode("nullifier", label)),
            admissionPolicyHash: pool.admissionPolicyHash,
            issuerEpoch: 1,
            expiresAt: pool.feedbackDeadline
        });
        registration.voucherSignature = _sign(ISSUER_PK, target.voucherDigest(registration.voucher));
        registration.voteKeySignature = _sign(
            privateKey,
            target.feedbackDigest(
                poolId, registration.responseHash, registration.payoutCommitment, registration.voucher.nullifier
            )
        );
    }

    function _register(TokenlessFeedbackBonus target, Registration memory registration) internal {
        target.registerFeedback(
            registration.voucher,
            registration.responseHash,
            registration.payoutCommitment,
            registration.voucherSignature,
            registration.voteKeySignature
        );
    }

    function _sign(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
