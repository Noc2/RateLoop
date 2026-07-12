// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { TokenlessPanel } from "./TokenlessPanel.sol";
import { IERC3009 } from "./interfaces/IERC3009.sol";

/// @title X402PanelSubmitter
/// @notice Stateless EIP-3009 payment adapter for a TokenlessPanel.
/// @dev It has no owner, setters, sweep, retained balance, or lifecycle role. The user's
///      authorization pays the exact immutable round total and the panel records the user—not
///      this adapter—as funder, so every refund remains self-custodial.
contract X402PanelSubmitter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    IERC3009 public immutable authorizationToken;
    IERC20 public immutable usdc;
    TokenlessPanel public immutable panel;

    event RoundSubmitted(address indexed funder, uint256 indexed roundId, uint256 amount);

    error InvalidAddress();
    error TransferAmountMismatch();

    constructor(address usdc_, address panel_) {
        if (usdc_ == address(0) || usdc_.code.length == 0 || panel_ == address(0) || panel_.code.length == 0) {
            revert InvalidAddress();
        }
        usdc = IERC20(usdc_);
        authorizationToken = IERC3009(usdc_);
        panel = TokenlessPanel(panel_);
    }

    function createRoundWithAuthorization(
        address funder,
        TokenlessPanel.RoundTerms calldata terms,
        Authorization calldata authorization
    ) external nonReentrant returns (uint256 roundId) {
        if (funder == address(0)) revert InvalidAddress();

        uint256 amount = terms.bountyAmount + terms.feeAmount + terms.attemptReserve;
        uint256 beforeBalance = usdc.balanceOf(address(this));
        authorizationToken.receiveWithAuthorization(
            funder,
            address(this),
            amount,
            authorization.validAfter,
            authorization.validBefore,
            authorization.nonce,
            authorization.v,
            authorization.r,
            authorization.s
        );
        if (usdc.balanceOf(address(this)) - beforeBalance != amount) revert TransferAmountMismatch();

        usdc.forceApprove(address(panel), amount);
        roundId = panel.createRoundFor(terms, funder);
        usdc.forceApprove(address(panel), 0);

        if (usdc.balanceOf(address(this)) != beforeBalance) revert TransferAmountMismatch();
        emit RoundSubmitted(funder, roundId, amount);
    }
}
