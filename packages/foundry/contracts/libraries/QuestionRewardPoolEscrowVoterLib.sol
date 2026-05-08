// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IVoterIdNFT } from "../interfaces/IVoterIdNFT.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";

library QuestionRewardPoolEscrowVoterLib {
    function timelyRevealedCommitFrontend(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint64 closesAt
    ) external view returns (bool revealed, address frontend) {
        // Use the narrow commitCore getter -- this helper is called inside claim/bundle
        // iteration loops, and materializing the full ciphertext on every read is expensive.
        (address voter,, address commitFrontend, uint48 commitRevealedAt, bool commitRevealed,,) =
            votingEngine.commitCore(contentId, roundId, commitKey);
        return
            (voter != address(0) && commitRevealed && (closesAt == 0 || commitRevealedAt <= closesAt), commitFrontend);
    }

    function resolveRoundRewardClaim(
        RoundVotingEngine votingEngine,
        IVoterIdNFT defaultVoterIdNft,
        uint256 contentId,
        uint256 roundId,
        address account
    ) external view returns (uint256 voterId, bytes32 commitKey, address rewardRecipient) {
        rewardRecipient = account;
        address voterIdNftAddress = _roundVoterIdNftAddress(votingEngine, defaultVoterIdNft, contentId, roundId);
        if (voterIdNftAddress != address(0)) {
            IVoterIdNFT roundVoterIdNft = IVoterIdNFT(voterIdNftAddress);
            voterId = roundVoterIdNft.getTokenId(account);
            if (voterId != 0) {
                rewardRecipient = roundVoterIdNft.getHolder(voterId);
                commitKey = _commitKeyForVoter(votingEngine, contentId, roundId, roundVoterIdNft, voterId);
                return (voterId, commitKey, rewardRecipient);
            }
        }

        bytes32 directCommitHash = votingEngine.voterCommitHash(contentId, roundId, account);
        commitKey = directCommitHash == bytes32(0) ? bytes32(0) : keccak256(abi.encodePacked(account, directCommitHash));
        voterId = 0;
        rewardRecipient = account;
    }

    function bundleCompleterAccount(
        RoundVotingEngine votingEngine,
        IVoterIdNFT defaultVoterIdNft,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey
    ) external view returns (address voter) {
        uint256 voterId = votingEngine.commitVoterId(contentId, roundId, commitKey);
        if (voterId != 0) {
            IVoterIdNFT roundVoterIdNft =
                IVoterIdNFT(_roundVoterIdNftAddress(votingEngine, defaultVoterIdNft, contentId, roundId));
            voter = roundVoterIdNft.getHolder(voterId);
            if (voter != address(0)) {
                return voter;
            }

            uint256 nullifier = roundVoterIdNft.getNullifier(voterId);
            if (nullifier != 0) {
                voter = roundVoterIdNft.getHolder(roundVoterIdNft.getTokenIdForNullifier(nullifier));
                if (voter != address(0)) {
                    return voter;
                }
            }
        }

        (voter,,,,,,) = votingEngine.commitCore(contentId, roundId, commitKey);
    }

    function _commitKeyForVoter(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        IVoterIdNFT voterIdNft,
        uint256 voterId
    ) private view returns (bytes32 commitKey) {
        commitKey = votingEngine.voterIdCommitKey(contentId, roundId, voterId);
        if (commitKey == bytes32(0)) {
            uint256 nullifier = voterIdNft.getNullifier(voterId);
            if (nullifier != 0) {
                commitKey = votingEngine.voterNullifierCommitKey(contentId, roundId, nullifier);
            }
        }
    }

    function _roundVoterIdNftAddress(
        RoundVotingEngine votingEngine,
        IVoterIdNFT defaultVoterIdNft,
        uint256 contentId,
        uint256 roundId
    ) private view returns (address) {
        address snapshot = votingEngine.roundVoterIdNFTSnapshot(contentId, roundId);
        return snapshot == address(0) ? address(defaultVoterIdNft) : snapshot;
    }
}
