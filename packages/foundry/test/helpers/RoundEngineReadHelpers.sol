// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Vm } from "forge-std/Vm.sol";
import { ContentRegistry } from "../../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../../contracts/ProtocolConfig.sol";
import { RoundLib } from "../../contracts/libraries/RoundLib.sol";

library RoundEngineReadHelpers {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant REGISTRY_SLOT = 1;
    uint256 internal constant ROUNDS_SLOT = 3;

    function activeRoundId(RoundVotingEngine engine, uint256 contentId) internal view returns (uint256 roundId) {
        roundId = engine.currentRoundId(contentId);
        if (roundId == 0) return 0;
        RoundLib.Round memory r = round(engine, contentId, roundId);
        if (r.state != RoundLib.RoundState.Open) return 0;
        if (r.voteCount == 0 && r.totalStake == 0) {
            uint48 lastActivityAt = _contentLastActivityAt(engine, contentId);
            if (lastActivityAt > r.startTime && lastActivityAt <= block.timestamp) return 0;
        }
    }

    function latestRoundId(RoundVotingEngine engine, uint256 contentId) internal view returns (uint256 roundId) {
        uint256 activeId = activeRoundId(engine, contentId);
        if (activeId != 0) {
            return activeId;
        }

        uint256 probe = 1;
        while (true) {
            RoundLib.Round memory r = round(engine, contentId, probe);
            if (r.startTime == 0) {
                return probe - 1;
            }
            probe++;
        }
    }

    function round(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (RoundLib.Round memory r)
    {
        uint8 upWins;
        (
            r.startTime, r.state, r.voteCount, r.revealedCount, r.totalStake, r.thresholdReachedAt, r.settledAt, upWins
        ) = engine.roundCore(contentId, roundId);
        r.upWins = upWins != 0;
        _readRoundPools(engine, contentId, roundId, r);
    }

    function _readRoundPools(RoundVotingEngine engine, uint256 contentId, uint256 roundId, RoundLib.Round memory r)
        private
        view
    {
        bytes32 slot = _roundStorageSlot(contentId, roundId);
        uint256 word0 = uint256(VM.load(address(engine), slot));
        uint256 word1 = uint256(VM.load(address(engine), bytes32(uint256(slot) + 1)));
        uint256 word2 = uint256(VM.load(address(engine), bytes32(uint256(slot) + 2)));
        r.upPool = uint64(word0 >> 152);
        r.downPool = uint64(word1);
        r.upCount = uint16(word1 >> 64);
        r.downCount = uint16(word1 >> 80);
        r.upWins = uint8(word1 >> 96) != 0;
        r.weightedUpPool = uint64(word2);
        r.weightedDownPool = uint64(word2 >> 64);
    }

    function _roundStorageSlot(uint256 contentId, uint256 roundId) private pure returns (bytes32) {
        return keccak256(abi.encode(roundId, keccak256(abi.encode(contentId, ROUNDS_SLOT))));
    }

    function _contentLastActivityAt(RoundVotingEngine engine, uint256 contentId)
        private
        view
        returns (uint48 lastActivityAt)
    {
        address registryAddress = address(uint160(uint256(VM.load(address(engine), bytes32(REGISTRY_SLOT)))));
        (,,,, lastActivityAt,,,,,) = ContentRegistry(registryAddress).contents(contentId);
    }

    function commit(RoundVotingEngine engine, uint256 contentId, uint256 roundId, bytes32 commitKey)
        internal
        view
        returns (RoundLib.Commit memory c)
    {
        (c.voter, c.stakeAmount, c.frontend, c.revealableAfter, c.revealed, c.isUp, c.epochIndex) =
            engine.commitCore(contentId, roundId, commitKey);
        (c.ciphertextHash, c.targetRound,, c.revealableAfter, c.revealed, c.stakeAmount) =
            engine.commitRevealData(contentId, roundId, commitKey);
    }

    function roundConfig(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (RoundLib.RoundConfig memory cfg)
    {
        (cfg.epochDuration, cfg.maxDuration, cfg.minVoters, cfg.maxVoters) =
            engine.roundConfigSnapshot(contentId, roundId);
        if (cfg.epochDuration == 0) {
            (cfg.epochDuration, cfg.maxDuration, cfg.minVoters, cfg.maxVoters) =
                ProtocolConfig(address(engine.protocolConfig())).config();
        }
    }

    function commitKeys(RoundVotingEngine engine, uint256 contentId, uint256 roundId)
        internal
        view
        returns (bytes32[] memory keys)
    {
        RoundLib.Round memory r = round(engine, contentId, roundId);
        uint256 count = r.voteCount;
        keys = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            keys[i] = engine.getRoundCommitKey(contentId, roundId, i);
        }
    }
}
