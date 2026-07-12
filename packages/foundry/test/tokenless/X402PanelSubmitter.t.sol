// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Test } from "forge-std/Test.sol";
import { MockERC20 } from "../../contracts/mocks/MockERC20.sol";
import { CredentialIssuer } from "../../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessPanel } from "../../contracts/tokenless/TokenlessPanel.sol";
import { X402PanelSubmitter } from "../../contracts/tokenless/X402PanelSubmitter.sol";

contract X402PanelSubmitterTest is Test {
    uint256 internal constant FUNDER_KEY = 0xA11CE;

    MockERC20 internal usdc;
    TokenlessPanel internal panel;
    X402PanelSubmitter internal adapter;
    address internal funder;

    function setUp() external {
        vm.warp(100);
        funder = vm.addr(FUNDER_KEY);
        usdc = new MockERC20("RateLoop Tokenless Test USDC", "tUSDC", 6);
        CredentialIssuer issuer = new CredentialIssuer(address(this), address(0xBEEF), 1 days);
        panel = new TokenlessPanel(address(usdc), address(issuer));
        adapter = new X402PanelSubmitter(address(usdc), address(panel));
        usdc.mint(funder, 100e6);
    }

    function testAuthorizationCreatesSelfCustodialRoundAndLeavesNoAdapterBalance() external {
        TokenlessPanel.RoundTerms memory terms = _terms();
        uint256 amount = terms.bountyAmount + terms.feeAmount + terms.attemptReserve;
        bytes32 nonce = keccak256("one-shot-round");
        bytes32 digest = usdc.receiveWithAuthorizationDigest(funder, address(adapter), amount, 0, 1 days, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(FUNDER_KEY, digest);

        uint256 roundId = adapter.createRoundWithAuthorization(
            funder,
            terms,
            X402PanelSubmitter.Authorization({ validAfter: 0, validBefore: 1 days, nonce: nonce, v: v, r: r, s: s })
        );

        assertEq(panel.getRound(roundId).funder, funder);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(usdc.allowance(address(adapter), address(panel)), 0);
        assertEq(usdc.balanceOf(address(panel)), amount);

        vm.prank(funder);
        panel.cancelEmptyRound(roundId);
        assertEq(usdc.balanceOf(funder), 100e6);
        assertEq(usdc.balanceOf(address(panel)), 0);
    }

    function _terms() private view returns (TokenlessPanel.RoundTerms memory) {
        return TokenlessPanel.RoundTerms({
            contentId: keccak256("question"),
            termsHash: keccak256("terms"),
            beaconNetworkHash: keccak256("drand-quicknet"),
            bountyAmount: 25e6,
            feeAmount: 2e6,
            attemptReserve: 3e6,
            attemptCompensation: 1e6,
            minimumReveals: 2,
            maximumCommits: 3,
            requiredTier: 1,
            commitDeadline: uint64(block.timestamp + 10 minutes),
            revealDeadline: uint64(block.timestamp + 20 minutes),
            beaconFailureDeadline: uint64(block.timestamp + 30 minutes),
            beaconRound: 12_345_678,
            claimGracePeriod: 1 days,
            feeRecipient: address(0xFEE)
        });
    }
}
