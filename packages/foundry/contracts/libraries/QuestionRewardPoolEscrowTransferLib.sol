// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { RoundVotingEngine } from "../RoundVotingEngine.sol";
import { TokenTransferLib } from "./TokenTransferLib.sol";

library QuestionRewardPoolEscrowTransferLib {
    using SafeERC20 for IERC20;

    event RewardPoolRefunded(uint256 indexed rewardPoolId, address indexed funder, uint256 amount);
    event RewardPoolForfeited(uint256 indexed rewardPoolId, address indexed treasury, uint256 amount);

    function pullExactToken(IERC20 token, address funder, uint256 amount) external returns (uint256 receivedAmount) {
        uint256 balanceBefore = token.balanceOf(address(this));
        // aderyn-fp-next-line(arbitrary-transfer-from)
        token.safeTransferFrom(funder, address(this), amount);
        receivedAmount = token.balanceOf(address(this)) - balanceBefore;
        require(receivedAmount == amount, "Bad token");
    }

    /// @notice Pay out a claim's voter share and frontend fee.
    /// @dev If the frontend transfer fails (e.g. USDC blocklist, contract revert) the fee is
    ///      redirected into the voter's reward and `redirectedFrontendFee` reports the amount
    ///      that did NOT actually leave through the frontend bucket. Callers that track a
    ///      `frontendFeeClaimedAmount` bucket must subtract this value back out, since the
    ///      bucket was credited under the assumption the fee would be paid. See M-Funds-1.
    function settleClaimPayout(
        IERC20 rewardToken,
        address rewardRecipient,
        uint256 rewardAmount,
        address frontendRecipient,
        uint256 frontendFee
    ) external returns (uint256, uint256, address, uint256 redirectedFrontendFee) {
        if (
            frontendFee > 0 && frontendRecipient != address(0)
                && TokenTransferLib.tryTransfer(rewardToken, frontendRecipient, frontendFee)
        ) {
            // Frontend fee paid; nothing to redirect.
        } else {
            redirectedFrontendFee = frontendFee;
            rewardAmount += frontendFee;
            frontendFee = 0;
            frontendRecipient = address(0);
        }
        if (rewardAmount > 0) {
            rewardToken.safeTransfer(rewardRecipient, rewardAmount);
        }
        return (rewardAmount, frontendFee, frontendRecipient, redirectedFrontendFee);
    }

    function transferResidue(IERC20 rewardToken, bool nonRefundable, address funder, address treasury, uint256 amount)
        external
        returns (address recipient)
    {
        return _transferResidue(rewardToken, nonRefundable, funder, treasury, amount);
    }

    function transferRewardPoolResidue(
        IERC20 rewardToken,
        RoundVotingEngine votingEngine,
        uint256 rewardPoolId,
        address funder,
        bool nonRefundable,
        uint256 amount
    ) external {
        if (nonRefundable) {
            address treasury = votingEngine.protocolConfig().treasury();
            _transferResidue(rewardToken, true, funder, treasury, amount);
            emit RewardPoolForfeited(rewardPoolId, treasury, amount);
        } else {
            _transferResidue(rewardToken, false, funder, address(0), amount);
            emit RewardPoolRefunded(rewardPoolId, funder, amount);
        }
    }

    function _transferResidue(IERC20 rewardToken, bool nonRefundable, address funder, address treasury, uint256 amount)
        private
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
