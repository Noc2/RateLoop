// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IFrontendRegistry } from "../interfaces/IFrontendRegistry.sol";
import { RoundLib } from "./RoundLib.sol";
import { RoundCleanupLib } from "./RoundCleanupLib.sol";
import { VotePreflightLib } from "./VotePreflightLib.sol";

/// @title RoundCommitStorageLib
/// @notice Moves post-validation commit storage/index writes out of RoundVotingEngine bytecode.
library RoundCommitStorageLib {
    using SafeCast for uint256;

    struct StoreParams {
        uint256 contentId;
        uint256 roundId;
        bytes32 commitKey;
        address voter;
        uint64 stakeAmount64;
        bytes32 ciphertextHash;
        address frontend;
        uint256 epochEnd;
        uint256 effectiveRevealableAfter;
        uint64 targetRound;
        bytes32 commitHash;
        bytes32 identityKey;
        address identityHolder;
        uint8 credentialMask;
        uint8 freshCredentialMask;
    }

    function storeCommittedVote(
        mapping(bytes32 => RoundLib.Commit) storage roundCommits,
        mapping(bytes32 => uint48) storage commitCommittedAt,
        mapping(bytes32 => bool) storage frontendEligibleAtCommit,
        bytes32[] storage roundCommitHashes,
        mapping(uint256 => uint256) storage epochUnrevealedCount,
        mapping(uint256 => uint256) storage lastCommitRevealableAfter,
        mapping(address => bytes32) storage voterCommitHash,
        mapping(bytes32 => bytes32) storage identityCommitKey,
        mapping(bytes32 => bytes32) storage commitIdentityKey,
        mapping(bytes32 => address) storage commitIdentityHolder,
        mapping(address => bytes32) storage holderCommitKey,
        mapping(bytes32 => uint8) storage commitCredentialMask,
        mapping(bytes32 => uint8) storage commitFreshCredentialMask,
        mapping(uint256 => bool) storage hasCommits,
        address frontendRegistry,
        StoreParams memory params
    ) external {
        roundCommits[params.commitKey] = RoundLib.Commit({
            voter: params.voter,
            stakeAmount: params.stakeAmount64,
            ciphertextHash: params.ciphertextHash,
            frontend: params.frontend,
            revealableAfter: params.epochEnd.toUint48(),
            targetRound: params.targetRound,
            revealed: false,
            isUp: false,
            epochIndex: 0
        });
        commitCommittedAt[params.commitKey] = block.timestamp.toUint48();
        if (
            params.frontend != address(0)
                && VotePreflightLib.isFrontendEligible(IFrontendRegistry(frontendRegistry), params.frontend)
        ) {
            frontendEligibleAtCommit[params.commitKey] = true;
        }
        hasCommits[params.contentId] = true;
        RoundCleanupLib.recordCommitIndexes(
            roundCommitHashes,
            epochUnrevealedCount,
            lastCommitRevealableAfter,
            voterCommitHash,
            params.roundId,
            params.commitKey,
            params.epochEnd,
            params.effectiveRevealableAfter,
            params.voter,
            params.commitHash
        );
        RoundCleanupLib.recordIdentityCommitIndex(
            identityCommitKey,
            commitIdentityKey,
            commitIdentityHolder,
            holderCommitKey,
            params.commitKey,
            params.identityKey,
            params.identityHolder,
            params.voter
        );
        commitCredentialMask[params.commitKey] = params.credentialMask;
        commitFreshCredentialMask[params.commitKey] = params.freshCredentialMask;
    }
}
