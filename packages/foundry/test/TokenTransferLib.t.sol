// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { TokenTransferLib } from "../contracts/libraries/TokenTransferLib.sol";

contract TokenTransferNoReturn {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}

contract TokenTransferBoolReturn {
    bool internal immutable returnValue;
    bool internal immutable shouldRevert;
    mapping(address => uint256) public balanceOf;

    constructor(bool returnValue_, bool shouldRevert_) {
        returnValue = returnValue_;
        shouldRevert = shouldRevert_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (shouldRevert) revert("transfer failed");
        if (returnValue) {
            balanceOf[msg.sender] -= amount;
            balanceOf[to] += amount;
        }
        return returnValue;
    }
}

contract TokenTransferLibTest is Test {
    address internal recipient = address(0xB0B);

    function test_TryTransferNoReturnTokenSucceeds() public {
        TokenTransferNoReturn token = new TokenTransferNoReturn();
        token.mint(address(this), 10);

        assertTrue(TokenTransferLib.tryTransfer(IERC20(address(token)), recipient, 10));
        assertEq(token.balanceOf(recipient), 10);
    }

    function test_TryTransferFalseReturnOrRevertReturnsFalse() public {
        TokenTransferBoolReturn falseToken = new TokenTransferBoolReturn(false, false);
        falseToken.mint(address(TokenTransferLib), 10);
        assertFalse(TokenTransferLib.tryTransfer(IERC20(address(falseToken)), recipient, 10));

        TokenTransferBoolReturn revertingToken = new TokenTransferBoolReturn(true, true);
        revertingToken.mint(address(TokenTransferLib), 10);
        assertFalse(TokenTransferLib.tryTransfer(IERC20(address(revertingToken)), recipient, 10));
    }

    function test_TryTransferNoCodeTokenReturnsFalse() public {
        assertFalse(TokenTransferLib.tryTransfer(IERC20(address(0x1234)), recipient, 10));
    }
}
