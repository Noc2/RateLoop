// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TokenTransferLib
/// @notice Isolates LREP transfer side effects so RoundVotingEngine can try/catch them without
///         keeping dedicated external wrappers.
library TokenTransferLib {
    using SafeERC20 for IERC20;

    function safeTransfer(IERC20 token, address recipient, uint256 amount) external {
        token.safeTransfer(recipient, amount);
    }

    function tryTransfer(IERC20 token, address recipient, uint256 amount) external returns (bool) {
        if (address(token).code.length == 0) return false;
        uint256 balanceBefore = token.balanceOf(recipient);
        (bool success, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (recipient, amount)));
        if (!success || (data.length != 0 && (data.length != 32 || !abi.decode(data, (bool))))) return false;
        // A successful but short transfer may have already mutated token state; revert
        // so fallback callers do not continue under incorrect fee accounting.
        require(token.balanceOf(recipient) - balanceBefore == amount, "Bad token");
        return true;
    }

}
