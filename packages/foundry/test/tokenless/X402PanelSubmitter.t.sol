// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";
import { CredentialIssuer } from "../../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessPanel } from "../../contracts/tokenless/TokenlessPanel.sol";
import { X402PanelSubmitter } from "../../contracts/tokenless/X402PanelSubmitter.sol";
import { MockBeaconVerifier } from "../../contracts/mocks/MockBeaconVerifier.sol";

contract X402PanelSubmitterTest is Test {
    uint256 internal constant FUNDER_KEY = 0xA11CE;
    bytes32 internal constant ADMISSION_POLICY_HASH = keccak256("x402-audience-policy");

    MockERC20 internal usdc;
    TokenlessPanel internal panel;
    X402PanelSubmitter internal adapter;
    address internal funder;

    function setUp() external {
        vm.warp(100);
        funder = vm.addr(FUNDER_KEY);
        usdc = new MockERC20("RateLoop Tokenless Test USDC", "tUSDC", 6);
        CredentialIssuer issuer = new CredentialIssuer(address(this), address(0xBEEF), 1 days);
        panel = new TokenlessPanel(address(usdc), address(issuer), address(new MockBeaconVerifier()));
        adapter = new X402PanelSubmitter(address(usdc), address(panel));
        usdc.mint(funder, 100e6);
    }

    function testAuthorizationCreatesSelfCustodialRoundAndLeavesNoAdapterBalance() external {
        TokenlessPanel.RoundTerms memory terms = _terms();
        bytes32 nonce = keccak256("one-shot-round");
        (X402PanelSubmitter.Authorization memory authorization, bytes memory roundSignature) =
            _authorization(terms, nonce);

        uint256 roundId = adapter.createRoundWithAuthorization(funder, terms, authorization, roundSignature);
        uint256 amount = terms.bountyAmount + terms.feeAmount + terms.attemptReserve;

        assertEq(panel.getRound(roundId).funder, funder);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(usdc.allowance(address(adapter), address(panel)), 0);
        assertEq(usdc.balanceOf(address(panel)), amount);

        vm.prank(funder);
        panel.cancelEmptyRound(roundId);
        assertEq(panel.withdrawableCredit(funder), amount);
        vm.prank(funder);
        panel.withdrawCredit(funder);
        assertEq(usdc.balanceOf(funder), 100e6);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function testAuthorizationCannotBeFrontRunWithMutatedRoundTerms() external {
        TokenlessPanel.RoundTerms memory signedTerms = _terms();
        bytes32 nonce = keccak256("terms-bound-round");
        (X402PanelSubmitter.Authorization memory authorization, bytes memory roundSignature) =
            _authorization(signedTerms, nonce);

        TokenlessPanel.RoundTerms memory attackerTerms = signedTerms;
        attackerTerms.contentId = keccak256("attacker-question");
        attackerTerms.termsHash = keccak256("attacker-terms");
        attackerTerms.feeRecipient = makeAddr("attackerFeeRecipient");

        vm.expectRevert(X402PanelSubmitter.InvalidSignature.selector);
        adapter.createRoundWithAuthorization(funder, attackerTerms, authorization, roundSignature);

        assertFalse(usdc.authorizationState(funder, nonce));
        assertEq(panel.nextRoundId(), 1);
    }

    function testPreSeededDustDoesNotBrickAuthorizedRoundAndIsLeftBehind() external {
        TokenlessPanel.RoundTerms memory terms = _terms();
        bytes32 nonce = keccak256("stray-adapter-balance");
        (X402PanelSubmitter.Authorization memory authorization, bytes memory roundSignature) =
            _authorization(terms, nonce);
        // Anyone can donate unsolicited USDC to the adapter; a delta-based check must ignore it.
        usdc.mint(address(adapter), 1);

        uint256 roundId = adapter.createRoundWithAuthorization(funder, terms, authorization, roundSignature);
        uint256 amount = terms.bountyAmount + terms.feeAmount + terms.attemptReserve;

        assertTrue(usdc.authorizationState(funder, nonce));
        assertEq(panel.getRound(roundId).funder, funder);
        assertEq(usdc.balanceOf(address(panel)), amount);
        // The donated dust unit remains behind, untouched by the round custody flow.
        assertEq(usdc.balanceOf(address(adapter)), 1);
        assertEq(usdc.allowance(address(adapter), address(panel)), 0);
    }

    function testFeeOnTransferAuthorizationStillFailsClosed() external {
        TokenlessPanel.RoundTerms memory terms = _terms();
        bytes32 nonce = keccak256("fee-on-transfer-round");
        (X402PanelSubmitter.Authorization memory authorization, bytes memory roundSignature) =
            _authorization(terms, nonce);
        // A token that skims a unit on transfer must be rejected: the receive delta is short.
        usdc.setTransferShortfall(1);

        vm.expectRevert(X402PanelSubmitter.TransferAmountMismatch.selector);
        adapter.createRoundWithAuthorization(funder, terms, authorization, roundSignature);

        assertEq(panel.nextRoundId(), 1);
    }

    function testRoundEnvelopeBindsTheImmutableTargetPanel() external {
        TokenlessPanel.RoundTerms memory terms = _terms();
        bytes32 nonce = keccak256("panel-bound-round");
        (X402PanelSubmitter.Authorization memory authorization, bytes memory roundSignature) =
            _authorization(terms, nonce);

        CredentialIssuer secondIssuer = new CredentialIssuer(address(this), address(0xBEEF), 1 days);
        TokenlessPanel secondPanel =
            new TokenlessPanel(address(usdc), address(secondIssuer), address(new MockBeaconVerifier()));
        X402PanelSubmitter secondAdapter = new X402PanelSubmitter(address(usdc), address(secondPanel));

        assertNotEq(
            adapter.roundAuthorizationDigest(funder, terms, authorization),
            secondAdapter.roundAuthorizationDigest(funder, terms, authorization)
        );
        vm.expectRevert(X402PanelSubmitter.InvalidSignature.selector);
        secondAdapter.createRoundWithAuthorization(funder, terms, authorization, roundSignature);
        assertEq(secondPanel.nextRoundId(), 1);
    }

    function testRoundEnvelopeBindsTheExactAdmissionPolicy() external view {
        TokenlessPanel.RoundTerms memory firstPolicy = _terms();
        bytes32 firstPolicyDigest = adapter.roundTermsDigest(firstPolicy);
        TokenlessPanel.RoundTerms memory secondPolicy = firstPolicy;
        secondPolicy.admissionPolicyHash = keccak256("different-audience-policy");

        assertNotEq(firstPolicyDigest, adapter.roundTermsDigest(secondPolicy));
    }

    function _authorization(TokenlessPanel.RoundTerms memory terms, bytes32 nonce)
        private
        view
        returns (X402PanelSubmitter.Authorization memory authorization, bytes memory roundSignature)
    {
        uint256 amount = terms.bountyAmount + terms.feeAmount + terms.attemptReserve;
        bytes32 paymentDigest = usdc.receiveWithAuthorizationDigest(funder, address(adapter), amount, 0, 1 days, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(FUNDER_KEY, paymentDigest);
        authorization =
            X402PanelSubmitter.Authorization({ validAfter: 0, validBefore: 1 days, nonce: nonce, v: v, r: r, s: s });

        bytes32 roundDigest = adapter.roundAuthorizationDigest(funder, terms, authorization);
        (v, r, s) = vm.sign(FUNDER_KEY, roundDigest);
        roundSignature = abi.encodePacked(r, s, v);
    }

    function _terms() private view returns (TokenlessPanel.RoundTerms memory) {
        uint256 bountyAmount = 25e6;
        uint32 maximumCommits = 3;
        uint256 maximumSeatPay = bountyAmount / maximumCommits;
        uint256 fixedBasePay = (maximumSeatPay * 8_000) / 10_000;
        return TokenlessPanel.RoundTerms({
            contentId: keccak256("question"),
            termsHash: keccak256("terms"),
            beaconNetworkHash: keccak256("drand-quicknet"),
            bountyAmount: bountyAmount,
            feeAmount: 2e6,
            attemptReserve: fixedBasePay * maximumCommits,
            attemptCompensation: fixedBasePay,
            minimumReveals: 3,
            maximumCommits: maximumCommits,
            admissionPolicyHash: ADMISSION_POLICY_HASH,
            commitDeadline: uint64(block.timestamp + 10 minutes),
            revealDeadline: uint64(block.timestamp + 20 minutes),
            beaconFailureDeadline: uint64(block.timestamp + 30 minutes),
            beaconRound: 12_345_678,
            claimGracePeriod: 1 days,
            feeRecipient: address(0xFEE)
        });
    }
}
