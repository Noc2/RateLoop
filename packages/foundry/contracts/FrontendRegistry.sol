// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IFrontendRegistry } from "./interfaces/IFrontendRegistry.sol";
import { IRoundVotingEngine } from "./interfaces/IRoundVotingEngine.sol";
import { IRoundRewardDistributor } from "./interfaces/IRoundRewardDistributor.sol";

/// @title FrontendRegistry
/// @notice Manages frontend operator registration (fixed 1,000 LREP stake) and fee distribution.
/// @dev Frontend operators stake LREP, can be slashed by governance, and earn LREP fees from predictions using their code.
contract FrontendRegistry is IFrontendRegistry, Initializable, AccessControlUpgradeable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // --- Access Control Roles ---
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant FEE_CREDITOR_ROLE = keccak256("FEE_CREDITOR_ROLE");

    /// @notice Maximum LREP that can be credited in a single creditFees() call (50,000 LREP with 6 decimals)
    /// @dev Launch round caps allow at most about 38,000 LREP of frontend fees in one round.
    uint256 public constant MAX_FEE_CREDIT = 50_000e6;
    /// @notice Maximum bytes allowed in a slashing reason.
    uint256 public constant MAX_SLASH_REASON_LENGTH = 280;

    /// @notice Fixed LREP stake required for frontend registration (1,000 LREP with 6 decimals)
    uint256 public constant STAKE_AMOUNT = 1000e6;

    /// @notice Slashable cooldown before a frontend can complete a voluntary exit.
    uint256 public constant UNBONDING_PERIOD = 14 days;

    // --- Structs ---
    struct Frontend {
        address operator;
        uint64 stakedAmount;
        uint128 lrepFees;
        bool slashed;
        uint48 registeredAt;
    }

    // --- State ---
    IERC20 public lrepToken;
    IRoundVotingEngine public votingEngine;
    address public confiscationRecipient;

    mapping(address => Frontend) public frontends;
    address[] public registeredFrontends;
    mapping(address => uint256) private registeredFrontendIndexPlusOne;
    mapping(address => uint256) public frontendExitAvailableAt;
    bool public initialFeeCreditorConfigured;
    address public feeCreditor;
    mapping(address => bool) private authorizedFeeCreditors;
    /// @notice I-Frontend-A: promoted from `private` to `public` so off-chain monitors can read
    ///         the engine→creditor binding without ERC-1967 storage-slot reads. Mapping value is
    ///         the fee creditor that was current when the given voting engine was the active
    ///         router; preserved after rotation so historical rounds settled by a now-rotated
    ///         engine still resolve to the right creditor (see `creditFees`).
    mapping(address => address) public feeCreditorForEngine;

    /// @dev Reserved storage gap for future upgrades
    uint256[44] private __gap;

    // --- Events ---
    event FrontendRegistered(address indexed frontend, address indexed operator, uint256 stakedAmount);
    event FrontendSlashed(address indexed frontend, uint256 amount, string reason);
    event FrontendUnslashed(address indexed frontend);
    event FrontendExitRequested(address indexed frontend, uint256 availableAt);
    event FrontendDeregistered(address indexed frontend);
    event FrontendStakeToppedUp(address indexed frontend, uint256 amount, uint256 newStakedAmount);
    event FeesCredited(address indexed frontend, uint256 lrepAmount);
    event FeesClaimed(address indexed frontend, uint256 lrepAmount);
    event FeesConfiscated(address indexed frontend, uint256 lrepAmount);
    event VotingEngineUpdated(address votingEngine);
    /// @notice L-Frontend-2: emitted when governance rotates the confiscation recipient.
    event ConfiscationRecipientUpdated(address indexed previous, address indexed current);
    event FeeCreditorUpdated(address indexed oldCreditor, address indexed newCreditor);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the frontend registry contract.
    /// @param _admin Address with temporary admin role for initial wiring.
    /// @param _governance Address with permanent governance roles (timelock).
    /// @param _lrepToken LREP token address for staking and fee distribution.
    function initialize(address _admin, address _governance, address _lrepToken) public initializer {
        __AccessControl_init();

        require(_admin != address(0), "Invalid admin");
        require(_governance != address(0), "Invalid governance");
        require(_lrepToken != address(0), "Invalid token");

        // Governance gets all permanent roles
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(ADMIN_ROLE, _governance);
        _grantRole(GOVERNANCE_ROLE, _governance);

        // Admin gets only ADMIN_ROLE for initial cross-contract wiring
        if (_admin != _governance) {
            _grantRole(ADMIN_ROLE, _admin);
        }

        // FEE_CREDITOR_ROLE is administered by governance, not DEFAULT_ADMIN_ROLE.
        _setRoleAdmin(FEE_CREDITOR_ROLE, GOVERNANCE_ROLE);

        lrepToken = IERC20(_lrepToken);
        confiscationRecipient = _governance;
    }

    // --- View Functions ---

    /// @inheritdoc IFrontendRegistry
    function isEligible(address frontend) external view override returns (bool) {
        Frontend storage f = frontends[frontend];
        return _isEligible(frontend, f);
    }

    /// @inheritdoc IFrontendRegistry
    function getAccumulatedFees(address frontend) external view override returns (uint256 lrepFees) {
        Frontend storage f = frontends[frontend];
        return uint256(f.lrepFees);
    }

    /// @inheritdoc IFrontendRegistry
    /// @dev A frontend mid-unbonding (`frontendExitAvailableAt != 0`) cannot receive newly
    ///      claimed historical fees. The unbonding window is the slashing review period; the
    ///      main `claimFees` path enforces this guard, so historical-fee resolution must
    ///      mirror it. Without the check, bounty-side fee routing (which calls this view via
    ///      `_resolveFrontendRewardRecipient`) would leak fees to the operator EOA mid-window.
    function canReceiveHistoricalFees(address frontend) public view override returns (bool) {
        Frontend storage f = frontends[frontend];
        return f.operator != address(0) && !f.slashed && uint256(f.stakedAmount) >= STAKE_AMOUNT
            && frontendExitAvailableAt[frontend] == 0;
    }

    /// @inheritdoc IFrontendRegistry
    /// @dev Registration timestamp gate: a frontend that re-registers at or after a round settled
    ///      cannot claim that round's fees. Without this, deregister + re-register would
    ///      revive fees that should have routed to Protocol (admin-confiscatable).
    function canClaimFeesForRound(address frontend, uint48 roundSettledAt) external view override returns (bool) {
        if (!canReceiveHistoricalFees(frontend)) return false;
        return frontends[frontend].registeredAt < roundSettledAt;
    }

    /// @inheritdoc IFrontendRegistry
    function getFrontendInfo(address frontend)
        external
        view
        override
        returns (address operator, uint256 stakedAmount, bool eligible, bool slashed)
    {
        Frontend storage f = frontends[frontend];
        return (f.operator, uint256(f.stakedAmount), _isEligible(frontend, f), f.slashed);
    }

    /// @notice Get a paginated slice of the registered frontend addresses
    /// @param offset Index to start from
    /// @param limit Maximum number of addresses to return
    /// @return addresses The slice of frontend addresses
    /// @return total The total number of registered frontends
    function getRegisteredFrontendsPaginated(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory addresses, uint256 total)
    {
        total = registeredFrontends.length;
        if (offset >= total || limit == 0) {
            return (new address[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 resultLength = end - offset;
        addresses = new address[](resultLength);
        for (uint256 i = 0; i < resultLength; i++) {
            addresses[i] = registeredFrontends[offset + i];
        }
    }

    // --- Registration Functions ---

    /// @notice Register as a frontend operator by staking 1,000 LREP
    /// @dev Fully bonded, unslashed frontends can earn fees immediately after registration.
    function register() external nonReentrant {
        require(frontends[msg.sender].operator == address(0), "Already registered");

        lrepToken.safeTransferFrom(msg.sender, address(this), STAKE_AMOUNT);

        frontends[msg.sender] = Frontend({
            operator: msg.sender,
            stakedAmount: STAKE_AMOUNT.toUint64(),
            lrepFees: 0,
            slashed: false,
            registeredAt: block.timestamp.toUint48()
        });

        registeredFrontends.push(msg.sender);
        registeredFrontendIndexPlusOne[msg.sender] = registeredFrontends.length;

        emit FrontendRegistered(msg.sender, msg.sender, STAKE_AMOUNT);
    }

    /// @notice Start voluntary deregistration. Stake remains slashable during unbonding.
    function requestDeregister() external nonReentrant {
        _requestDeregister(msg.sender);
    }

    /// @notice Complete deregistration after the unbonding window has elapsed.
    function completeDeregister() external nonReentrant {
        Frontend storage f = frontends[msg.sender];
        require(f.operator != address(0), "Not registered");
        require(!f.slashed, "Frontend is slashed");
        uint256 availableAt = frontendExitAvailableAt[msg.sender];
        require(availableAt != 0, "Exit not requested");
        require(block.timestamp >= availableAt, "Unbonding period active");

        uint256 refund = uint256(f.stakedAmount);
        uint256 pendingFees = uint256(f.lrepFees);
        f.stakedAmount = 0;
        f.lrepFees = 0;
        f.operator = address(0); // Allow re-registration
        delete frontendExitAvailableAt[msg.sender];
        _removeRegisteredFrontend(msg.sender);

        uint256 total = refund + pendingFees;
        if (total > 0) {
            lrepToken.safeTransfer(msg.sender, total);
        }

        if (pendingFees > 0) {
            emit FeesClaimed(msg.sender, pendingFees);
        }
        emit FrontendDeregistered(msg.sender);
    }

    /// @notice Claim accumulated LREP fees
    function claimFees() external nonReentrant {
        Frontend storage f = frontends[msg.sender];
        require(f.operator != address(0), "Not registered");
        require(!f.slashed, "Frontend is slashed");
        if (frontendExitAvailableAt[msg.sender] != 0) revert FrontendExitPending();
        require(uint256(f.stakedAmount) >= STAKE_AMOUNT, "Frontend is underbonded");

        uint256 lrepAmount = uint256(f.lrepFees);

        require(lrepAmount > 0, "No fees to claim");

        f.lrepFees = 0;

        lrepToken.safeTransfer(msg.sender, lrepAmount);

        emit FeesClaimed(msg.sender, lrepAmount);
    }

    // --- Fee Crediting (called by RoundVotingEngine) ---

    /// @inheritdoc IFrontendRegistry
    /// @dev No eligibility check here — commit-time eligibility is snapshotted in RoundVotingEngine.
    ///      Slashed or underbonded frontends cannot accrue newly claimed historical fees.
    function creditFees(address frontend, uint256 lrepAmount) external override onlyRole(FEE_CREDITOR_ROLE) {
        require(authorizedFeeCreditors[msg.sender], "Unauthorized fee creditor");
        address creditorEngine = _feeCreditorVotingEngine(msg.sender);
        address engineCreditor = feeCreditorForEngine[creditorEngine];
        if (engineCreditor == address(0) && msg.sender == feeCreditor && creditorEngine == address(votingEngine)) {
            engineCreditor = msg.sender;
        }
        require(engineCreditor == msg.sender, "Unauthorized fee creditor");
        require(lrepAmount <= MAX_FEE_CREDIT, "Fee credit too large");
        Frontend storage f = frontends[frontend];
        require(f.operator != address(0), "Frontend not registered");
        require(!f.slashed, "Frontend is slashed");
        require(uint256(f.stakedAmount) >= STAKE_AMOUNT, "Frontend is underbonded");
        if (frontendExitAvailableAt[frontend] != 0) revert FrontendExitPending();
        f.lrepFees = (uint256(f.lrepFees) + lrepAmount).toUint128();
        emit FeesCredited(frontend, lrepAmount);
    }

    /// @notice Restore stake after a partial slash so the frontend can earn fees again.
    /// @dev Slashed frontends cannot top up — governance must `unslashFrontend` first so the
    ///      slash signal is not silently neutralised by re-bonding before the violation is
    ///      adjudicated.
    /// @param amount Additional LREP to bond.
    function topUpStake(uint256 amount) external nonReentrant {
        Frontend storage f = frontends[msg.sender];
        require(f.operator != address(0), "Not registered");
        require(!f.slashed, "Frontend is slashed");
        if (frontendExitAvailableAt[msg.sender] != 0) revert FrontendExitPending();
        require(amount > 0, "Invalid top-up amount");
        require(uint256(f.stakedAmount) < STAKE_AMOUNT, "Already fully bonded");

        uint256 missingStake = STAKE_AMOUNT - uint256(f.stakedAmount);
        require(amount <= missingStake, "Top-up exceeds requirement");

        lrepToken.safeTransferFrom(msg.sender, address(this), amount);
        f.stakedAmount += amount.toUint64();

        emit FrontendStakeToppedUp(msg.sender, amount, uint256(f.stakedAmount));
    }

    // --- Governance Functions ---

    /// @notice Slash a frontend's stake (partial or full)
    /// @param frontend The frontend address to slash
    /// @param amount Amount of LREP to slash
    /// @param reason Reason for the slash
    function slashFrontend(address frontend, uint256 amount, string calldata reason)
        external
        nonReentrant
        onlyRole(GOVERNANCE_ROLE)
    {
        require(bytes(reason).length <= MAX_SLASH_REASON_LENGTH, "Slash reason too long");
        require(address(votingEngine) != address(0), "VotingEngine not set");
        Frontend storage f = frontends[frontend];
        require(f.operator != address(0), "Frontend not registered");
        require(uint256(f.stakedAmount) >= amount, "Slash exceeds stake");

        uint256 confiscatedFees = uint256(f.lrepFees);
        f.stakedAmount -= amount.toUint64();
        f.lrepFees = 0;
        f.slashed = true;

        // L-Frontend-3: slashing must reset the unbonding clock. Otherwise a slash → unslash →
        // immediate-exit pattern lets governance be coerced into shortening the operator's
        // review window to zero — the timer keeps running while the operator is frozen.
        if (frontendExitAvailableAt[frontend] != 0) {
            uint256 newAvailableAt = block.timestamp + UNBONDING_PERIOD;
            frontendExitAvailableAt[frontend] = newAvailableAt;
            emit FrontendExitRequested(frontend, newAvailableAt);
        }

        uint256 totalConfiscated = amount + confiscatedFees;
        if (totalConfiscated > 0) {
            lrepToken.safeTransfer(confiscationRecipient, totalConfiscated);
        }

        if (confiscatedFees > 0) {
            emit FeesConfiscated(frontend, confiscatedFees);
        }

        emit FrontendSlashed(frontend, amount, reason);
    }

    /// @notice Unslash a frontend (restore ability to operate)
    /// @param frontend The frontend address to unslash
    function unslashFrontend(address frontend) external onlyRole(GOVERNANCE_ROLE) {
        Frontend storage f = frontends[frontend];
        require(f.operator != address(0), "Frontend not registered");
        require(f.slashed, "Frontend not slashed");

        f.slashed = false;
        emit FrontendUnslashed(frontend);
    }

    // --- Admin Functions ---

    /// @notice Update the voting engine address
    /// @param _votingEngine New voting engine address
    function setVotingEngine(address _votingEngine) external onlyRole(ADMIN_ROLE) {
        require(_votingEngine != address(0), "Invalid voting engine");
        require(_votingEngine.code.length != 0, "Invalid voting engine");
        if (address(votingEngine) == _votingEngine) return;
        address oldCreditor = feeCreditor;
        if (oldCreditor != address(0)) {
            address oldEngine = address(votingEngine);
            if (feeCreditorForEngine[oldEngine] == address(0)) {
                feeCreditorForEngine[oldEngine] = oldCreditor;
            }
            feeCreditor = address(0);
            emit FeeCreditorUpdated(oldCreditor, address(0));
        }
        votingEngine = IRoundVotingEngine(_votingEngine);
        emit VotingEngineUpdated(_votingEngine);
    }

    /// @notice L-Frontend-2: governance-rotation setter for the confiscation recipient.
    ///         `confiscationRecipient` was init-only; if governance later rotated (timelock
    ///         multisig swap, governance migration), slashed LREP would continue flowing to
    ///         the OLD address. If the recipient ever reverts on receive, `slashFrontend`
    ///         reverts and slashing is bricked until governance can fix it — which it can
    ///         now do via this setter.
    function setConfiscationRecipient(address newRecipient) external onlyRole(GOVERNANCE_ROLE) {
        require(newRecipient != address(0), "Invalid recipient");
        address previous = confiscationRecipient;
        if (previous == newRecipient) return;
        confiscationRecipient = newRecipient;
        emit ConfiscationRecipientUpdated(previous, newRecipient);
    }

    /// @notice Grant fee creditor role to the reward distributor for the current voting engine.
    /// @param creditor The address to grant the role to
    function addFeeCreditor(address creditor) external onlyRole(GOVERNANCE_ROLE) {
        address creditorEngine = _requireFeeCreditorForEngine(creditor, address(votingEngine));
        address oldCreditor = feeCreditor;
        if (oldCreditor != address(0) && oldCreditor != creditor) {
            authorizedFeeCreditors[oldCreditor] = false;
            _revokeRole(FEE_CREDITOR_ROLE, oldCreditor);
        }
        feeCreditor = creditor;
        authorizedFeeCreditors[creditor] = true;
        feeCreditorForEngine[creditorEngine] = creditor;
        _grantRole(FEE_CREDITOR_ROLE, creditor);
        emit FeeCreditorUpdated(oldCreditor, creditor);
    }

    /// @notice Revoke fee creditor role
    /// @param creditor The address to revoke the role from
    function removeFeeCreditor(address creditor) external onlyRole(GOVERNANCE_ROLE) {
        if (creditor == feeCreditor) {
            feeCreditor = address(0);
            emit FeeCreditorUpdated(creditor, address(0));
        }
        authorizedFeeCreditors[creditor] = false;
        _clearFeeCreditorForEngine(creditor);
        _revokeRole(FEE_CREDITOR_ROLE, creditor);
    }

    /// @notice One-shot deploy-time fee creditor wiring after the registry is connected to VotingEngine.
    /// @param creditor The initial contract allowed to credit frontend fees.
    function initializeFeeCreditor(address creditor) external onlyRole(ADMIN_ROLE) {
        require(!initialFeeCreditorConfigured, "Initial fee creditor set");
        address creditorEngine = _requireFeeCreditorForEngine(creditor, address(votingEngine));
        initialFeeCreditorConfigured = true;
        feeCreditor = creditor;
        authorizedFeeCreditors[creditor] = true;
        feeCreditorForEngine[creditorEngine] = creditor;
        _grantRole(FEE_CREDITOR_ROLE, creditor);
        emit FeeCreditorUpdated(address(0), creditor);
    }

    function _requestDeregister(address frontend) internal {
        Frontend storage f = frontends[frontend];
        require(f.operator != address(0), "Not registered");
        require(!f.slashed, "Frontend is slashed");
        if (frontendExitAvailableAt[frontend] != 0) revert FrontendExitPending();

        uint256 availableAt = block.timestamp + UNBONDING_PERIOD;
        frontendExitAvailableAt[frontend] = availableAt;

        emit FrontendExitRequested(frontend, availableAt);
    }

    function _removeRegisteredFrontend(address frontend) internal {
        uint256 indexPlusOne = registeredFrontendIndexPlusOne[frontend];
        if (indexPlusOne == 0) {
            return;
        }

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = registeredFrontends.length - 1;

        if (index != lastIndex) {
            address movedFrontend = registeredFrontends[lastIndex];
            registeredFrontends[index] = movedFrontend;
            registeredFrontendIndexPlusOne[movedFrontend] = index + 1;
        }

        registeredFrontends.pop();
        delete registeredFrontendIndexPlusOne[frontend];
    }

    function _isEligible(address frontend, Frontend storage f) internal view returns (bool) {
        return f.operator != address(0) && !f.slashed && uint256(f.stakedAmount) >= STAKE_AMOUNT
            && frontendExitAvailableAt[frontend] == 0;
    }

    function _requireFeeCreditorForEngine(address creditor, address engine)
        internal
        view
        returns (address creditorEngine)
    {
        require(engine != address(0), "VotingEngine not set");
        creditorEngine = _feeCreditorVotingEngine(creditor);
        require(creditorEngine == engine, "Invalid fee creditor");
    }

    function _feeCreditorVotingEngine(address creditor) internal view returns (address creditorEngine) {
        require(creditor.code.length != 0, "Invalid fee creditor");
        try IRoundRewardDistributor(creditor).votingEngine() returns (address engine) {
            return engine;
        } catch {
            revert("Invalid fee creditor");
        }
    }

    function _clearFeeCreditorForEngine(address creditor) internal {
        if (creditor.code.length == 0) return;
        try IRoundRewardDistributor(creditor).votingEngine() returns (address engine) {
            if (feeCreditorForEngine[engine] == creditor) {
                delete feeCreditorForEngine[engine];
            }
        } catch { }
    }
}
