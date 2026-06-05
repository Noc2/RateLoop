// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ContentRegistry } from "../ContentRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RaterRegistry } from "../RaterRegistry.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";

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
        address raterRegistryAddress = votingEngine.roundRaterRegistrySnapshot(contentId, roundId);
        if (raterRegistryAddress == address(0)) {
            raterRegistryAddress = config.raterRegistry();
        }
        if (raterRegistryAddress == address(0) || voteCount == 0) return new bytes32[](0);

        RaterRegistry raterRegistry = RaterRegistry(raterRegistryAddress);
        address submitterIdentity = registry.getSubmitterIdentity(contentId);
        bytes32[] memory candidates = new bytes32[](voteCount);
        uint256 anchorCount;

        for (uint256 i = 0; i < voteCount; i++) {
            bytes32 roundCommitKey = votingEngine.getRoundCommitKey(contentId, roundId, i);
            (address voter,,,, bool revealed,,) = votingEngine.commitCore(contentId, roundId, roundCommitKey);
            if (!revealed) continue;

            address anchorAccount = launchRewardAnchorAccount(votingEngine, contentId, roundId, roundCommitKey, voter);
            if (anchorAccount == rewardRecipient || anchorAccount == submitterIdentity) continue;

            bytes32 anchorId =
                launchRewardAnchorId(raterRegistry, anchorAccount, roundStartTime, minAnchorCredentialAgeSeconds);
            if (anchorId == bytes32(0) || launchRewardAnchorSeen(candidates, anchorCount, anchorId)) continue;

            candidates[anchorCount] = anchorId;
            anchorCount += 1;
        }

        anchorIds = new bytes32[](anchorCount);
        for (uint256 i = 0; i < anchorCount; i++) {
            anchorIds[i] = candidates[i];
        }
    }

    function launchRewardAnchorAccount(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address fallbackAccount
    ) internal view returns (address) {
        address holder = votingEngine.commitIdentityHolder(contentId, roundId, commitKey);
        return holder == address(0) ? fallbackAccount : holder;
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
                !credential.verified || credential.revoked || credential.expiresAt <= roundStartTime
                    || credential.nullifierHash == bytes32(0)
                    || (minAnchorCredentialAgeSeconds > 0
                        && uint256(credential.verifiedAt) + minAnchorCredentialAgeSeconds > roundStartTime)
            ) {
                return bytes32(0);
            }
            return raterRegistry.launchHumanIdentityKey(credential.provider, credential.nullifierHash);
        } catch {
            return bytes32(0);
        }
    }

    function launchRewardCredentialAnchorId(RaterRegistry.HumanCredentialProvider provider, bytes32 nullifierHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(provider, nullifierHash));
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
