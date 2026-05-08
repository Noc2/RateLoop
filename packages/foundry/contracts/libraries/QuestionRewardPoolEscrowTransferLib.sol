// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { TokenTransferLib } from "./TokenTransferLib.sol";

library QuestionRewardPoolEscrowTransferLib {
    using SafeERC20 for IERC20;

    function pullExactToken(IERC20 token, address funder, uint256 amount) external returns (uint256 receivedAmount) {
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(funder, address(this), amount);
        receivedAmount = token.balanceOf(address(this)) - balanceBefore;
        require(receivedAmount == amount, "Bad token");
    }

    function settleClaimPayout(
        IERC20 rewardToken,
        address rewardRecipient,
        uint256 rewardAmount,
        address frontendRecipient,
        uint256 frontendFee
    ) external returns (uint256, uint256, address) {
        if (
            frontendFee > 0 && frontendRecipient != address(0)
                && TokenTransferLib.tryTransfer(rewardToken, frontendRecipient, frontendFee)
        ) {
            // Frontend fee paid; nothing to redirect.
        } else {
            rewardAmount += frontendFee;
            frontendFee = 0;
            frontendRecipient = address(0);
        }
        if (rewardAmount > 0) {
            rewardToken.safeTransfer(rewardRecipient, rewardAmount);
        }
        return (rewardAmount, frontendFee, frontendRecipient);
    }

    function transferResidue(IERC20 rewardToken, bool nonRefundable, address funder, address treasury, uint256 amount)
        external
        returns (address recipient)
    {
        if (nonRefundable) {
            require(treasury != address(0), "Treasury not set");
            recipient = treasury;
        } else {
            recipient = funder;
        }
        rewardToken.safeTransfer(recipient, amount);
    }
}
