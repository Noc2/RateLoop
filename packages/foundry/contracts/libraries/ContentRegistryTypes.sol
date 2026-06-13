// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

library ContentRegistryTypes {
    enum ContentStatus {
        Active,
        Dormant,
        Cancelled
    }

    struct Content {
        uint64 id;
        bytes32 contentHash;
        address submitter;
        uint48 createdAt;
        uint48 lastActivityAt;
        ContentStatus status;
        uint8 dormantCount;
        address reviver;
        uint8 rating;
        uint64 categoryId;
    }

    struct PendingRatingSettlement {
        address votingEngine;
        uint64 upEvidence;
        uint64 downEvidence;
        uint48 readyAt;
        uint16 referenceRatingBps;
        bool exists;
        bool applied;
    }
}
