// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IRaterIdentityRegistry } from "../interfaces/IRaterIdentityRegistry.sol";
import { ProtocolConfig } from "../ProtocolConfig.sol";
import { RoundVotingEngine } from "../RoundVotingEngine.sol";

library QuestionRewardPoolEscrowVoterLib {
    function timelyRevealedCommitFrontend(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        uint64 closesAt
    ) internal view returns (bool revealed, address frontend) {
        // Use the narrow commitCore getter -- this helper is called inside claim/bundle
        // iteration loops, and materializing the full ciphertext on every read is expensive.
        (address voter,, address commitFrontend, uint48 commitRevealedAt, bool commitRevealed,,) =
            votingEngine.commitCore(contentId, roundId, commitKey);
        uint48 committedAt = votingEngine.commitCommittedAt(contentId, roundId, commitKey);
        return (
            voter != address(0) && commitRevealed && committedByBountyClose(closesAt, committedAt, commitRevealedAt),
            commitFrontend
        );
    }

    function committedByBountyClose(uint64 closesAt, uint48 committedAt, uint48 revealedAt)
        internal
        pure
        returns (bool)
    {
        if (closesAt == 0) return true;
        uint48 eligibilityTimestamp = committedAt == 0 ? revealedAt : committedAt;
        return eligibilityTimestamp <= closesAt;
    }

    function resolveCurrentRater(ProtocolConfig protocolConfig, address account)
        internal
        view
        returns (IRaterIdentityRegistry.ResolvedRater memory resolved)
    {
        return _resolveRater(_currentRaterRegistry(protocolConfig), account);
    }

    function resolveRoundRater(
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId,
        address account
    ) internal view returns (IRaterIdentityRegistry.ResolvedRater memory resolved) {
        return _resolveRater(_roundRaterRegistry(votingEngine, protocolConfig, contentId, roundId), account);
    }

    function commitIdentity(
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey,
        address voter
    ) internal view returns (bytes32 identityKey, address holder) {
        identityKey = votingEngine.commitIdentityKey(contentId, roundId, commitKey);
        holder = votingEngine.commitIdentityHolder(contentId, roundId, commitKey);

        if (identityKey == bytes32(0) || holder == address(0)) {
            IRaterIdentityRegistry.ResolvedRater memory resolved =
                resolveRoundRater(votingEngine, protocolConfig, contentId, roundId, voter);
            if (identityKey == bytes32(0)) {
                identityKey = resolved.identityKey;
            }
            if (holder == address(0)) {
                holder = resolved.holder;
            }
        }
        if (holder == address(0)) {
            holder = voter;
        }
    }

    function resolveRoundRewardClaim(
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId,
        address account
    ) internal view returns (bytes32 identityKey, bytes32 commitKey, address rewardRecipient) {
        IRaterIdentityRegistry.ResolvedRater memory resolved =
            resolveRoundRater(votingEngine, protocolConfig, contentId, roundId, account);
        identityKey = resolved.identityKey;
        rewardRecipient = resolved.holder == address(0) ? account : resolved.holder;

        if (identityKey != bytes32(0)) {
            commitKey = votingEngine.identityCommitKey(contentId, roundId, identityKey);
            if (commitKey != bytes32(0)) {
                address resolvedCommitHolder = votingEngine.commitIdentityHolder(contentId, roundId, commitKey);
                if (resolvedCommitHolder != address(0)) {
                    rewardRecipient = resolvedCommitHolder;
                }
                return (identityKey, commitKey, rewardRecipient);
            }
        }
        address holder = rewardRecipient;
        commitKey = votingEngine.holderCommitKey(contentId, roundId, holder);
        if (commitKey != bytes32(0)) {
            bytes32 holderCommitIdentityKey = votingEngine.commitIdentityKey(contentId, roundId, commitKey);
            if (holderCommitIdentityKey != bytes32(0)) {
                identityKey = holderCommitIdentityKey;
            }
            address holderCommitHolder = votingEngine.commitIdentityHolder(contentId, roundId, commitKey);
            if (holderCommitHolder != address(0)) {
                rewardRecipient = holderCommitHolder;
            }
            return (identityKey, commitKey, rewardRecipient);
        }

        if (holder != account) {
            bytes32 holderCommitHash = votingEngine.voterCommitHash(contentId, roundId, holder);
            if (holderCommitHash != bytes32(0)) {
                commitKey = keccak256(abi.encodePacked(holder, holderCommitHash));
                bytes32 holderDirectIdentityKey = votingEngine.commitIdentityKey(contentId, roundId, commitKey);
                if (holderDirectIdentityKey != bytes32(0)) {
                    identityKey = holderDirectIdentityKey;
                }
                address holderDirectCommitHolder = votingEngine.commitIdentityHolder(contentId, roundId, commitKey);
                if (holderDirectCommitHolder != address(0)) {
                    rewardRecipient = holderDirectCommitHolder;
                }
                return (identityKey, commitKey, rewardRecipient);
            }
        }

        bytes32 directCommitHash = votingEngine.voterCommitHash(contentId, roundId, account);
        if (directCommitHash == bytes32(0)) {
            return (identityKey, bytes32(0), rewardRecipient);
        }

        commitKey = keccak256(abi.encodePacked(account, directCommitHash));
        bytes32 commitIdentityKey = votingEngine.commitIdentityKey(contentId, roundId, commitKey);
        if (commitIdentityKey != bytes32(0)) {
            identityKey = commitIdentityKey;
        }
        address commitHolder = votingEngine.commitIdentityHolder(contentId, roundId, commitKey);
        if (commitHolder != address(0)) {
            rewardRecipient = commitHolder;
        }
    }

    function bundleCompleterAccount(
        RoundVotingEngine votingEngine,
        uint256 contentId,
        uint256 roundId,
        bytes32 commitKey
    ) internal view returns (address voter) {
        voter = votingEngine.commitIdentityHolder(contentId, roundId, commitKey);
        if (voter != address(0)) {
            return voter;
        }

        (voter,,,,,,) = votingEngine.commitCore(contentId, roundId, commitKey);
    }

    function identityKeyForCurrentRater(ProtocolConfig protocolConfig, address account)
        internal
        view
        returns (bytes32)
    {
        return resolveCurrentRater(protocolConfig, account).identityKey;
    }

    function identityKeyForRoundRater(
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId,
        address account
    ) internal view returns (bytes32) {
        return resolveRoundRater(votingEngine, protocolConfig, contentId, roundId, account).identityKey;
    }

    function addressIdentityKey(address account) internal pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function _roundRaterRegistry(
        RoundVotingEngine votingEngine,
        ProtocolConfig protocolConfig,
        uint256 contentId,
        uint256 roundId
    ) private view returns (IRaterIdentityRegistry) {
        address snapshot = votingEngine.roundRaterRegistrySnapshot(contentId, roundId);
        if (snapshot == address(0)) {
            snapshot = address(_currentRaterRegistry(protocolConfig));
        }
        return IRaterIdentityRegistry(snapshot);
    }

    function _currentRaterRegistry(ProtocolConfig protocolConfig) private view returns (IRaterIdentityRegistry) {
        if (address(protocolConfig) == address(0)) {
            return IRaterIdentityRegistry(address(0));
        }
        return IRaterIdentityRegistry(protocolConfig.raterRegistry());
    }

    function _resolveRater(IRaterIdentityRegistry identityRegistry, address account)
        private
        view
        returns (IRaterIdentityRegistry.ResolvedRater memory resolved)
    {
        if (account == address(0)) return resolved;
        if (address(identityRegistry) != address(0)) {
            resolved = identityRegistry.resolveRater(account);
            if (resolved.identityKey != bytes32(0) && resolved.holder != address(0)) {
                return resolved;
            }
        }

        resolved = IRaterIdentityRegistry.ResolvedRater({
            holder: account,
            identityKey: addressIdentityKey(account),
            humanNullifier: bytes32(0),
            hasActiveHumanCredential: false,
            delegated: false
        });
    }
}
