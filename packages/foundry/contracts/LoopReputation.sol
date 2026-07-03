// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { Nonces } from "@openzeppelin/contracts/utils/Nonces.sol";

interface IRateLoopGovernorToken {
    function reputationToken() external view returns (address);
}

/// @title LoopReputation
/// @notice Transferable capped reputation token for RateLoop governance with a 7-day lock window.
/// @dev Uses 6 decimals. Lock is engaged by the governor when an account casts a governance vote.
contract LoopReputation is ERC20, ERC20Permit, ERC20Votes, AccessControl {
    uint8 private constant DECIMALS = 6;
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** DECIMALS;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    uint256 public constant GOVERNANCE_LOCK_DURATION = 7 days;
    uint256 public constant MAX_GOVERNANCE_LOCK_DURATION = 40 days;

    struct GovernanceLock {
        uint256 amount;
        uint256 unlockTime;
    }

    mapping(address => GovernanceLock) private _governanceLock;
    mapping(address => GovernanceLock) private _proposalGovernanceLock;

    address public governor;

    event GovernanceLocked(address indexed account, uint256 amount, uint256 unlockTime);
    event GovernanceLockReleased(address indexed account, uint256 amount, uint256 remainingAmount);
    event GovernorSet(address indexed governor);

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
        require(newGovernor.code.length > 0, "Governor must be contract");
        try IRateLoopGovernorToken(newGovernor).reputationToken() returns (address governorToken) {
            require(governorToken == address(this), "Governor token mismatch");
        } catch {
            revert("Invalid governor");
        }
        governor = newGovernor;
        emit GovernorSet(newGovernor);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }

    function lockForGovernance(address account, uint256 amount) external {
        require(msg.sender == governor, "Only governor");
        _lockForGovernanceUntil(_governanceLock[account], account, amount, block.timestamp + GOVERNANCE_LOCK_DURATION);
    }

    function lockForGovernanceUntil(address account, uint256 amount, uint256 unlockTime) external {
        require(msg.sender == governor, "Only governor");
        _lockForGovernanceUntil(_governanceLock[account], account, amount, unlockTime);
    }

    function lockProposalGovernanceUntil(address account, uint256 amount, uint256 unlockTime) external {
        require(msg.sender == governor, "Only governor");
        require(getTransferableBalance(account) >= amount, "Insufficient transferable balance for governance lock");
        _lockForGovernanceUntil(_proposalGovernanceLock[account], account, amount, unlockTime);
    }

    function releaseProposalGovernanceLock(address account, uint256 amount) external {
        require(msg.sender == governor, "Only governor");
        _releaseGovernanceLock(_proposalGovernanceLock[account], account, amount);
    }

    function releaseGovernanceLock(address account, uint256 amount) external {
        require(msg.sender == governor, "Only governor");
        _releaseGovernanceLock(_governanceLock[account], account, amount);
    }

    function _releaseGovernanceLock(GovernanceLock storage lock, address account, uint256 amount) internal {
        require(amount > 0, "Amount must be > 0");

        if (lock.unlockTime <= block.timestamp || lock.amount == 0) {
            return;
        }

        uint256 released = amount < lock.amount ? amount : lock.amount;
        lock.amount -= released;
        if (lock.amount == 0) {
            lock.unlockTime = block.timestamp;
        }

        emit GovernanceLockReleased(account, released, lock.amount);
    }

    function _lockForGovernanceUntil(GovernanceLock storage lock, address account, uint256 amount, uint256 unlockTime)
        internal
    {
        require(amount > 0, "Amount must be > 0");
        require(balanceOf(account) >= amount, "Insufficient balance for governance lock");
        require(unlockTime > block.timestamp, "Unlock time must be future");
        require(unlockTime <= block.timestamp + MAX_GOVERNANCE_LOCK_DURATION, "Governance lock too long");

        if (lock.unlockTime <= block.timestamp) {
            lock.amount = amount;
            lock.unlockTime = unlockTime;
        } else {
            uint256 currentBalance = balanceOf(account);
            uint256 lockableBase = currentBalance > amount ? currentBalance : amount;
            uint256 lockableBalance = lockableBase > lock.amount ? lockableBase - lock.amount : 0;
            uint256 additionalLock = amount > lockableBalance ? lockableBalance : amount;
            // N-3: Only extend the unlock window when new tokens are actually locked. Otherwise
            // voting in a second proposal would re-anchor the timer on already-locked tokens,
            // making any LREP that ever votes effectively semi-permanently locked under
            // continuous governance cadence.
            if (additionalLock > 0) {
                lock.amount += additionalLock;
                if (unlockTime > lock.unlockTime) {
                    lock.unlockTime = unlockTime;
                }
            }
        }

        emit GovernanceLocked(account, lock.amount, lock.unlockTime);
    }

    function getLockedBalance(address account) public view returns (uint256) {
        uint256 activeLock = _activeGovernanceLockAmount(_governanceLock[account]);
        uint256 activeProposalLock = _activeGovernanceLockAmount(_proposalGovernanceLock[account]);
        uint256 totalLocked = activeLock + activeProposalLock;
        uint256 balance = balanceOf(account);
        return totalLocked > balance ? balance : totalLocked;
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
        GovernanceLock storage proposalLock = _proposalGovernanceLock[account];
        amount = getLockedBalance(account);
        unlockTime = lock.unlockTime > proposalLock.unlockTime ? lock.unlockTime : proposalLock.unlockTime;
        if (amount == 0) {
            return (0, unlockTime);
        }
        return (amount, unlockTime);
    }

    function _activeGovernanceLockAmount(GovernanceLock storage lock) private view returns (uint256) {
        return lock.unlockTime > block.timestamp ? lock.amount : 0;
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

    /// @notice Signature-based delegation is disabled. The `_delegate` override forces
    ///         self-delegation, so delegateBySig had no legitimate user-facing function but
    ///         shared nonce space with `permit` — a captured delegate signature could burn
    ///         the signer's next permit nonce (L-Identity-8).
    function delegateBySig(address, uint256, uint256, uint8, bytes32, bytes32) public pure override {
        revert("delegateBySig disabled");
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
