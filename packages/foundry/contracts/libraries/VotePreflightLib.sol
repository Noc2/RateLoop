// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ContentRegistry } from "../ContentRegistry.sol";
import { IAdvisoryVoteRecorder } from "../interfaces/IAdvisoryVoteRecorder.sol";
import { IFrontendRegistry } from "../interfaces/IFrontendRegistry.sol";
import { IRaterIdentityRegistry } from "../interfaces/IRaterIdentityRegistry.sol";

/// @title VotePreflightLib
/// @notice Extracts external preflight checks for vote commits to reduce RoundVotingEngine runtime size.
library VotePreflightLib {
    error SelfVote();
    error ContentNotActive();
    error CooldownActive();
    error InvalidStake();
    error AlreadyCommitted();
    error MaxVotersReached();

    struct CommitPreflightParams {
        address voter;
        address identityHolder;
        uint256 contentId;
        uint256 roundId;
        bytes32 identityKey;
        uint256 cooldownWindow;
        uint256 maxStake;
        uint256 stakeAmount;
        bytes32 commitHash;
        uint256 roundVoteCount;
        uint256 maxVoters;
    }

    function validateVoterAndContent(
        IRaterIdentityRegistry identityRegistry,
        ContentRegistry registry,
        address voter,
        uint256 contentId
    ) external view returns (IRaterIdentityRegistry.ResolvedRater memory resolved) {
        resolved = resolveRater(identityRegistry, voter);
        _validateContentAndNotSubmitter(registry, voter, contentId, resolved);
    }

    function validateRoundOpener(
        IRaterIdentityRegistry identityRegistry,
        ContentRegistry registry,
        address opener,
        uint256 contentId
    ) external view {
        IRaterIdentityRegistry.ResolvedRater memory resolved = resolveRater(identityRegistry, opener);
        _validateContentAndNotSubmitter(registry, opener, contentId, resolved);
    }

    function _validateContentAndNotSubmitter(
        ContentRegistry registry,
        address actor,
        uint256 contentId,
        IRaterIdentityRegistry.ResolvedRater memory resolved
    ) private view {
        (,, address rawSubmitter,,,,,,,) = registry.contents(contentId);
        if (actor == rawSubmitter) revert SelfVote();

        if (resolved.holder == registry.getSubmitterIdentity(contentId)) revert SelfVote();
        bytes32 submitterIdentityKey = registry.contentSubmitterIdentityKey(contentId);
        if (submitterIdentityKey != bytes32(0) && resolved.identityKey == submitterIdentityKey) revert SelfVote();
        if (!registry.isContentActive(contentId)) revert ContentNotActive();
    }

    function resolveRater(IRaterIdentityRegistry identityRegistry, address actor)
        public
        view
        returns (IRaterIdentityRegistry.ResolvedRater memory resolved)
    {
        if (actor == address(0)) return resolved;
        if (address(identityRegistry) != address(0)) {
            resolved = identityRegistry.resolveRater(actor);
            if (resolved.identityKey != bytes32(0) && resolved.holder != address(0)) return resolved;
        }

        resolved = IRaterIdentityRegistry.ResolvedRater({
            holder: actor,
            identityKey: addressIdentityKey(actor),
            humanNullifier: bytes32(0),
            hasActiveHumanCredential: false,
            delegated: false
        });
    }

    function addressIdentityKey(address account) public pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function isFrontendEligible(IFrontendRegistry frontendRegistry, address frontend)
        external
        view
        returns (bool eligible)
    {
        if (frontend == address(0) || address(frontendRegistry) == address(0)) {
            return false;
        }

        try frontendRegistry.isEligible(frontend) returns (bool isEligible) {
            return isEligible;
        } catch {
            return false;
        }
    }

    function validateNoAdvisoryConflict(
        address advisoryRecorder,
        uint256 contentId,
        uint256 roundId,
        address voter,
        address identityHolder,
        bytes32 identityKey,
        uint256 cooldownWindow
    ) external view {
        if (advisoryRecorder == address(0)) return;

        IAdvisoryVoteRecorder recorder = IAdvisoryVoteRecorder(advisoryRecorder);
        if (recorder.advisoryCommitKeyByRater(contentId, roundId, voter) != bytes32(0)) {
            revert AlreadyCommitted();
        }

        uint256 lastAdvisoryVote = recorder.lastAdvisoryVoteTimestamp(contentId, voter);
        if (identityHolder != address(0) && identityHolder != voter) {
            if (recorder.advisoryCommitKeyByRater(contentId, roundId, identityHolder) != bytes32(0)) {
                revert AlreadyCommitted();
            }

            uint256 lastHolderAdvisoryVote = recorder.lastAdvisoryVoteTimestamp(contentId, identityHolder);
            if (lastHolderAdvisoryVote > lastAdvisoryVote) {
                lastAdvisoryVote = lastHolderAdvisoryVote;
            }
        }
        if (identityKey != bytes32(0)) {
            if (recorder.advisoryCommitKeyByIdentity(contentId, roundId, identityKey) != bytes32(0)) {
                revert AlreadyCommitted();
            }

            uint256 lastIdentityAdvisoryVote = recorder.lastAdvisoryVoteTimestampByIdentity(contentId, identityKey);
            if (lastIdentityAdvisoryVote > lastAdvisoryVote) {
                lastAdvisoryVote = lastIdentityAdvisoryVote;
            }
        }

        if (lastAdvisoryVote > 0 && block.timestamp < lastAdvisoryVote + cooldownWindow) {
            revert CooldownActive();
        }
    }

    function prepareCommit(
        mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) storage voterCommitHash,
        mapping(
            uint256 => mapping(uint256 => mapping(bytes32 => bytes32))
        ) storage identityCommitKey,
        mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) storage holderCommitKey,
        mapping(uint256 => mapping(address => uint256)) storage lastVoteTimestamp,
        mapping(uint256 => mapping(bytes32 => uint256)) storage lastVoteTimestampByIdentity,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) storage identityRoundStake,
        CommitPreflightParams memory params
    ) external view returns (bytes32 commitKey) {
        _validateCooldown(
            lastVoteTimestamp,
            lastVoteTimestampByIdentity,
            params.voter,
            params.identityHolder,
            params.contentId,
            params.identityKey,
            params.cooldownWindow,
            block.timestamp
        );
        commitKey = _validateCommitCapacityAndKey(
            voterCommitHash,
            identityCommitKey,
            holderCommitKey,
            params.voter,
            params.identityHolder,
            params.contentId,
            params.roundId,
            params.identityKey,
            params.commitHash,
            params.roundVoteCount,
            params.maxVoters
        );
        _validateStakeLimit(
            identityRoundStake,
            params.contentId,
            params.roundId,
            params.identityKey,
            params.stakeAmount,
            params.maxStake
        );
    }

    function _validateCooldown(
        mapping(uint256 => mapping(address => uint256)) storage lastVoteTimestamp,
        mapping(uint256 => mapping(bytes32 => uint256)) storage lastVoteTimestampByIdentity,
        address voter,
        address identityHolder,
        uint256 contentId,
        bytes32 identityKey,
        uint256 cooldownWindow,
        uint256 timestamp
    ) private view {
        uint256 lastVote = lastVoteTimestamp[contentId][voter];
        if (identityHolder != address(0) && identityHolder != voter) {
            uint256 lastHolderVote = lastVoteTimestamp[contentId][identityHolder];
            if (lastHolderVote > lastVote) lastVote = lastHolderVote;
        }
        uint256 lastVoteByIdentity = lastVoteTimestampByIdentity[contentId][identityKey];
        if (lastVoteByIdentity > lastVote) lastVote = lastVoteByIdentity;
        if (lastVote > 0 && timestamp < lastVote + cooldownWindow) revert CooldownActive();
    }

    function _validateCommitCapacityAndKey(
        mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) storage voterCommitHash,
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => bytes32))) storage identityCommitKey,
        mapping(uint256 => mapping(uint256 => mapping(address => bytes32))) storage holderCommitKey,
        address voter,
        address identityHolder,
        uint256 contentId,
        uint256 roundId,
        bytes32 identityKey,
        bytes32 commitHash,
        uint256 roundVoteCount,
        uint256 maxVoters
    ) private view returns (bytes32 commitKey) {
        if (voterCommitHash[contentId][roundId][voter] != bytes32(0)) revert AlreadyCommitted();
        if (
            identityHolder != address(0) && identityHolder != voter
                && voterCommitHash[contentId][roundId][identityHolder] != bytes32(0)
        ) {
            revert AlreadyCommitted();
        }
        if (identityKey != bytes32(0) && identityCommitKey[contentId][roundId][identityKey] != bytes32(0)) {
            revert AlreadyCommitted();
        }
        if (identityHolder != address(0) && holderCommitKey[contentId][roundId][identityHolder] != bytes32(0)) {
            revert AlreadyCommitted();
        }
        if (roundVoteCount >= maxVoters) revert MaxVotersReached();

        commitKey = keccak256(abi.encodePacked(voter, commitHash));
    }

    function _validateStakeLimit(
        mapping(uint256 => mapping(uint256 => mapping(bytes32 => uint256))) storage identityRoundStake,
        uint256 contentId,
        uint256 roundId,
        bytes32 identityKey,
        uint256 stakeAmount,
        uint256 maxStake
    ) private view {
        uint256 currentStake = identityRoundStake[contentId][roundId][identityKey];
        if (currentStake + stakeAmount > maxStake) revert InvalidStake();
    }
}
