// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { Nonces } from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title LoopReputation
/// @notice Transferable capped reputation token for RateLoop governance and prediction locks.
/// @dev Uses 6 decimals and keeps the old Curyo governance-lock behavior as the first migration step.
contract LoopReputation is ERC20, ERC20Permit, ERC20Votes, AccessControl {
    uint8 private constant DECIMALS = 6;
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** DECIMALS;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant PREDICTION_LOCKER_ROLE = keccak256("PREDICTION_LOCKER_ROLE");

    uint256 public constant GOVERNANCE_LOCK_DURATION = 7 days;

    struct GovernanceLock {
        uint256 amount;
        uint256 unlockTime;
    }

    mapping(address => GovernanceLock) private _governanceLock;

    address public governor;
    address public predictionVotingEngine;
    address public predictionRewardDistributor;

    event GovernanceLocked(address indexed account, uint256 amount, uint256 unlockTime);
    event GovernorSet(address indexed governor);
    event PredictionContractsSet(address indexed votingEngine, address indexed rewardDistributor);

    constructor(address admin, address governance) ERC20("Loop Reputation", "LREP") ERC20Permit("Loop Reputation") {
        require(admin != address(0), "Invalid admin");
        require(governance != address(0), "Invalid governance");

        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(CONFIG_ROLE, governance);

        _grantRole(MINTER_ROLE, admin);
        if (admin != governance) {
            _grantRole(CONFIG_ROLE, admin);
        }
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    function setGovernor(address newGovernor) external onlyRole(CONFIG_ROLE) {
        require(newGovernor != address(0), "Invalid address");
        governor = newGovernor;
        emit GovernorSet(newGovernor);
    }

    function setPredictionContracts(address votingEngine, address rewardDistributor) external onlyRole(CONFIG_ROLE) {
        require(votingEngine != address(0), "Invalid voting engine");
        require(rewardDistributor != address(0), "Invalid reward distributor");
        predictionVotingEngine = votingEngine;
        predictionRewardDistributor = rewardDistributor;
        emit PredictionContractsSet(votingEngine, rewardDistributor);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }

    function lockForGovernance(address account, uint256 amount) external {
        require(msg.sender == governor, "Only governor");
        require(amount > 0, "Amount must be > 0");
        require(balanceOf(account) >= amount, "Insufficient balance for governance lock");

        GovernanceLock storage lock = _governanceLock[account];
        uint256 newUnlockTime = block.timestamp + GOVERNANCE_LOCK_DURATION;
        if (lock.unlockTime <= block.timestamp) {
            lock.amount = amount;
        } else {
            uint256 currentBalance = balanceOf(account);
            uint256 lockableBase = currentBalance > amount ? currentBalance : amount;
            uint256 lockableBalance = lockableBase > lock.amount ? lockableBase - lock.amount : 0;
            uint256 additionalLock = amount > lockableBalance ? lockableBalance : amount;
            if (additionalLock > 0) {
                lock.amount += additionalLock;
            }
        }
        lock.unlockTime = newUnlockTime;

        emit GovernanceLocked(account, lock.amount, newUnlockTime);
    }

    function getLockedBalance(address account) public view returns (uint256) {
        GovernanceLock storage lock = _governanceLock[account];
        return lock.unlockTime > block.timestamp ? lock.amount : 0;
    }

    function getTransferableBalance(address account) public view returns (uint256) {
        uint256 total = balanceOf(account);
        uint256 locked = getLockedBalance(account);
        return total > locked ? total - locked : 0;
    }

    function isLocked(address account) external view returns (bool) {
        return getLockedBalance(account) > 0;
    }

    function getGovernanceLock(address account) external view returns (uint256 amount, uint256 unlockTime) {
        GovernanceLock storage lock = _governanceLock[account];
        if (lock.unlockTime > block.timestamp) {
            return (lock.amount, lock.unlockTime);
        }
        return (0, lock.unlockTime);
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        if (from != address(0) && to != address(0)) {
            require(value <= getTransferableBalance(from), "Exceeds transferable balance (governance locked)");
        }

        super._update(from, to, value);

        if (to != address(0) && delegates(to) == address(0)) {
            _delegate(to, to);
        }
    }

    function _delegate(address account, address delegatee) internal override {
        require(delegatee == account, "Only self-delegation allowed");
        super._delegate(account, delegatee);
    }

    function nonces(address owner) public view virtual override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
