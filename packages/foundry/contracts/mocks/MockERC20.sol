// SPDX-License-Identifier: MIT
/// @dev FOR TESTING ONLY — DO NOT DEPLOY TO PRODUCTION
pragma solidity ^0.8.34;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title MockERC20
/// @notice Mock ERC20 token for testing (simulates USDC/USDT with 6 decimals)
contract MockERC20 is ERC20, EIP712 {
    uint8 private immutable _decimals;
    address public immutable faultController;
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    mapping(address => bool) public blockedRecipients;
    uint256 public transferShortfall;
    uint256 public authorizationTransferShortfall;

    error UnauthorizedFaultController();

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) EIP712(name, "2") {
        _decimals = decimals_;
        faultController = msg.sender;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /// @notice Mint tokens to any address (for testing)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlockedRecipient(address recipient, bool blocked) external {
        if (msg.sender != faultController) revert UnauthorizedFaultController();
        blockedRecipients[recipient] = blocked;
    }

    function setTransferShortfall(uint256 shortfall) external {
        if (msg.sender != faultController) revert UnauthorizedFaultController();
        transferShortfall = shortfall;
    }

    function setAuthorizationTransferShortfall(uint256 shortfall) external {
        if (msg.sender != faultController) revert UnauthorizedFaultController();
        authorizationTransferShortfall = shortfall;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function receiveWithAuthorizationDigest(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce))
        );
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(to == msg.sender, "MockERC20: caller must be payee");
        require(block.timestamp > validAfter, "MockERC20: authorization not yet valid");
        require(block.timestamp < validBefore, "MockERC20: authorization expired");
        require(!authorizationState[from][nonce], "MockERC20: authorization used");
        require(
            ECDSA.recover(receiveWithAuthorizationDigest(from, to, value, validAfter, validBefore, nonce), v, r, s)
                == from,
            "MockERC20: invalid authorization signature"
        );
        authorizationState[from][nonce] = true;
        uint256 transferAmount = value;
        uint256 shortfall = authorizationTransferShortfall;
        if (shortfall != 0) {
            require(shortfall <= value, "MockERC20: shortfall exceeds value");
            transferAmount = value - shortfall;
        }
        _transfer(from, to, transferAmount);
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blockedRecipients[to], "MockERC20: recipient blocked");
        uint256 transferAmount = value;
        uint256 shortfall = transferShortfall;
        if (from != address(0) && to != address(0) && shortfall != 0) {
            require(shortfall <= value, "MockERC20: shortfall exceeds value");
            transferAmount = value - shortfall;
        }
        super._update(from, to, transferAmount);
    }
}
