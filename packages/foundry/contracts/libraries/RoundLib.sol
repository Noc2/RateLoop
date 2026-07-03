// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title RoundLib
/// @notice Helpers for per-content round state transitions and timing.
/// @dev Rounds replace global epochs. Each content item has independent rounds that
///      accumulate votes during one tlock blind window. Settlement triggers when ≥3
///      votes are revealed. If the voting window passes below commit quorum
///      the round cancels with refunds;
///      once commit quorum exists, failure to reach reveal quorum can finalize as RevealFailed.
///      Tlock is the primary reveal mechanism — votes are encrypted to the epoch end time
///      and become decryptable via drand after the accepted blind window. Current protocol
///      config requires `maxDuration == epochDuration`, so every accepted vote has full
///      stake weight. Multi-epoch weighting has been removed; a future config relaxation
///      must introduce new economics and tests explicitly.
library RoundLib {
    // --- Enums ---

    enum RoundState {
        Open, // Accepting votes during the blind window; reveals happen after it ends
        Settled, // ≥3 votes revealed, rewards distributed
        Cancelled, // Expired with commit count below minVoters — full refund
        Tied, // Equal weighted pools after ≥3 reveals — revealed voters refund, unrevealed cleaned separately
        RevealFailed, // Commit quorum reached, but reveal quorum never did before the final reveal grace deadline
        SettlementPending // Scoring set closed; RBTS stake/reward accounting waits for a correlation snapshot
    }

    // --- Structs ---

    struct RoundConfig {
        uint32 epochDuration; // Duration of each voting epoch (default: 20 minutes)
        uint32 maxDuration; // Max time before round expires (default: 20 minutes)
        uint16 minVoters; // Minimum revealed votes to trigger settlement (default: 3)
        uint16 maxVoters; // Gas safety cap (default: 100)
    }

    struct Round {
        uint48 startTime; // When round timing was anchored (by openRound or first commit)
        RoundState state;
        uint16 voteCount; // Total commits across all epochs
        uint16 revealedCount; // Total revealed votes
        uint64 totalStake; // Total staked across all voters
        uint64 upPool; // Total raw stake by UP voters (updated as votes are revealed)
        uint64 downPool; // Total raw stake by DOWN voters (updated as votes are revealed)
        uint16 upCount; // Number of UP voters (updated as votes are revealed)
        uint16 downCount; // Number of DOWN voters (updated as votes are revealed)
        bool upWins; // Set after settlement
        uint48 settledAt; // Timestamp when round was settled/tied (for forfeit cutoff)
        uint48 thresholdReachedAt; // When revealedCount first reached minVoters (0 = not yet)
        uint64 weightedUpPool; // Effective stake for UP side (currently equal to raw revealed stake)
        uint64 weightedDownPool; // Effective stake for DOWN side (currently equal to raw revealed stake)
    }

    /// @dev `revealableAfter` is dual-purpose to save a storage slot:
    ///      - while `revealed == false`: epoch-end timestamp (gates the earliest reveal call)
    ///      - while `revealed == true`:  reveal timestamp (used by cleanup and deadline checks)
    ///      Every reader MUST gate its interpretation on `revealed`. Bounty eligibility reads
    ///      `RoundVotingEngine.commitCommittedAt`; this field still backs the reveal-time
    ///      deadline checks listed below.
    ///      See:
    ///        - RoundCleanupLib.processUnrevealedVotes (epoch-end semantics, guarded by !revealed)
    ///        - QuestionRewardPoolEscrow._timelyRevealedCommitFrontend (reveal-time, guarded by revealed)
    ///        - QuestionRewardPoolEscrowQualificationLib (reveal-time, guarded by revealed)
    ///      Deploy policy: this dual semantics is in-place-upgrade unsafe — a future
    ///      implementation that reinterpreted the field on revealed records would silently
    ///      corrupt cleanup and bounty timing. Do not switch to in-place UUPS upgrades for the
    ///      voting engine without first introducing a `commitVersion` discriminant.
    struct Commit {
        address voter;
        uint64 stakeAmount;
        bytes32 ciphertextHash; // keccak256 of the tlock-encrypted payload emitted at commit time
        uint64 targetRound; // drand round targeted by the ciphertext
        address frontend; // Frontend operator address (for fee distribution)
        uint48 revealableAfter; // Dual-purpose; see struct NatSpec above. Always check `revealed` first.
        bool revealed;
        bool isUp; // Set after reveal
        uint8 epochIndex; // Compatibility field; current accepted configs always store 0.
    }

    // --- State checks ---

    /// @notice Check if a round has expired without reaching settlement.
    function isExpired(Round storage round, uint256 maxDuration) internal view returns (bool) {
        return round.state == RoundState.Open && round.startTime > 0
            && block.timestamp >= uint256(round.startTime) + maxDuration;
    }

    /// @notice Check if a round is in a terminal state.
    function isTerminal(Round storage round) internal view returns (bool) {
        return round.state == RoundState.Settled || round.state == RoundState.Cancelled
            || round.state == RoundState.Tied || round.state == RoundState.RevealFailed
            || round.state == RoundState.SettlementPending;
    }

    /// @notice Check if a round accepts new votes (Open and not expired).
    function acceptsVotes(Round storage round, uint256 maxDuration) internal view returns (bool) {
        return round.state == RoundState.Open && !isExpired(round, maxDuration);
    }

    /// @notice Compute the blind-window end time for a vote committed in the current round.
    /// @param round The round containing the vote.
    /// @param epochDuration Duration of each epoch in seconds.
    /// @return epochEnd The timestamp when this vote's blind window ends (and it becomes revealable).
    function computeEpochEnd(Round storage round, uint256 epochDuration) internal view returns (uint256) {
        return uint256(round.startTime) + epochDuration;
    }
}
