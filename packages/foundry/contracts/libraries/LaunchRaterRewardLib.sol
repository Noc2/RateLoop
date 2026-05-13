// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ContentRegistry} from "../ContentRegistry.sol";
import {ProtocolConfig} from "../ProtocolConfig.sol";
import {RaterRegistry} from "../RaterRegistry.sol";
import {RoundVotingEngine} from "../RoundVotingEngine.sol";
import {IVoterIdNFT} from "../interfaces/IVoterIdNFT.sol";

/// @notice Linked helper for launch-distribution rater reward qualification.
library LaunchRaterRewardLib {
    function collectAnchorIds(
        ProtocolConfig config,
        RoundVotingEngine votingEngine,
        ContentRegistry registry,
        uint256 contentId,
        uint256 roundId,
        address rewardRecipient,
        uint256 voteCount,
        uint48 roundStartTime,
        uint32 minAnchorCredentialAgeSeconds
    ) external view returns (bytes32[] memory anchorIds) {
        address raterRegistryAddress = config.raterRegistry();
        if (raterRegistryAddress == address(0) || voteCount == 0) return new bytes32[](0);

        RaterRegistry raterRegistry = RaterRegistry(raterRegistryAddress);
        address submitterIdentity = registry.getSubmitterIdentity(contentId);
        address voterIdNftAddress = roundVoterIdNftAddress(votingEngine, config, contentId, roundId);
        bytes32[] memory candidates = new bytes32[](voteCount);
        uint256 anchorCount;

        for (uint256 i = 0; i < voteCount; i++) {
            bytes32 roundCommitKey = votingEngine.getRoundCommitKey(contentId, roundId, i);
            (address voter,,,, bool revealed,,) = votingEngine.commitCore(contentId, roundId, roundCommitKey);
            if (!revealed) continue;

            address anchorAccount =
                launchRewardAnchorAccount(votingEngine, voterIdNftAddress, contentId, roundId, roundCommitKey, voter);
            if (anchorAccount == rewardRecipient || anchorAccount == submitterIdentity) continue;

            bytes32 anchorId = launchRewardAnchorId(
                raterRegistry, anchorAccount, roundStartTime, minAnchorCredentialAgeSeconds
            );
            if (anchorId == bytes32(0) || launchRewardAnchorSeen(candidates, anchorCount, anchorId)) continue;

            candidates[anchorCount] = anchorId;
            anchorCount += 1;
        }

        anchorIds = new bytes32[](anchorCount);
        for (uint256 i = 0; i < anchorCount; i++) {
            anchorIds[i] = candidates[i];
        }
    }

    function roundVoterIdNftAddress(
        RoundVotingEngine votingEngine,
        ProtocolConfig config,
        uint256 contentId,
        uint256 roundId
    ) internal view returns (address) {
        address snapshot = votingEngine.roundVoterIdNFTSnapshot(contentId, roundId);
        if (snapshot != address(0)) return snapshot;
        return config.voterIdNFT();
    }

    function launchRewardAnchorAccount(
        RoundVotingEngine votingEngine,
        address voterIdNftAddress,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address fallbackAccount
    ) internal view returns (address) {
        if (voterIdNftAddress == address(0)) return fallbackAccount;
        uint256 voterId = votingEngine.commitVoterId(contentId, roundId, commitKey);
        if (voterId == 0) return fallbackAccount;

        address rewardRecipient = currentVoterIdRewardRecipient(IVoterIdNFT(voterIdNftAddress), voterId);
        return rewardRecipient == address(0) ? fallbackAccount : rewardRecipient;
    }

    function currentVoterIdRewardRecipient(IVoterIdNFT voterIdNft, uint256 voterId)
        internal
        view
        returns (address rewardRecipient)
    {
        rewardRecipient = voterIdNft.getHolder(voterId);
        if (rewardRecipient != address(0)) return rewardRecipient;

        uint256 nullifier = voterIdNft.getNullifier(voterId);
        if (nullifier == 0) return address(0);

        uint256 currentVoterId = voterIdNft.getTokenIdForNullifier(nullifier);
        if (currentVoterId == 0) return address(0);

        return voterIdNft.getHolder(currentVoterId);
    }

    function launchRewardAnchorId(
        RaterRegistry raterRegistry,
        address account,
        uint48 roundStartTime,
        uint32 minAnchorCredentialAgeSeconds
    ) internal view returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        try raterRegistry.getHumanCredential(account) returns (RaterRegistry.HumanCredential memory credential) {
            if (
                !credential.verified || credential.revoked || credential.expiresAt <= block.timestamp
                    || credential.nullifierHash == bytes32(0)
                    || (
                        minAnchorCredentialAgeSeconds > 0
                            && uint256(credential.verifiedAt) + minAnchorCredentialAgeSeconds > roundStartTime
                    )
            ) {
                return bytes32(0);
            }
            return credential.nullifierHash;
        } catch {
            return bytes32(0);
        }
    }

    function launchRewardAnchorSeen(bytes32[] memory anchors, uint256 anchorCount, bytes32 anchorId)
        internal
        pure
        returns (bool)
    {
        for (uint256 i = 0; i < anchorCount; i++) {
            if (anchors[i] == anchorId) return true;
        }
        return false;
    }
}
