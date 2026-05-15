export const AdvisoryVoteRecorderAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_votingEngine",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_registry",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "advisoryCommitCore",
    "inputs": [
      {
        "name": "advisoryCommitKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "voter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "commitHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "revealableAfter",
        "type": "uint48",
        "internalType": "uint48"
      },
      {
        "name": "revealed",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "isUp",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "predictedUpBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "launchCreditClaimed",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "scoreBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "advisoryCommitKeyByIdentity",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "advisoryCommitKeyByRater",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "advisoryCommitRevealData",
    "inputs": [
      {
        "name": "advisoryCommitKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "ciphertext",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "targetRound",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "drandChainHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "revealableAfter",
        "type": "uint48",
        "internalType": "uint48"
      },
      {
        "name": "revealed",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "stakeAmount",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimAdvisoryLaunchCredit",
    "inputs": [
      {
        "name": "advisoryCommitKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "scoreBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "paidAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getRoundAdvisoryCommitKey",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastAdvisoryVoteTimestamp",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastAdvisoryVoteTimestampByIdentity",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "protocolConfig",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ProtocolConfig"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "recordAdvisoryVote",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundContext",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "targetRound",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "drandChainHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "commitHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "ciphertext",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "advisoryCommitKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ContentRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revealAdvisoryVote",
    "inputs": [
      {
        "name": "advisoryCommitKey",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "isUp",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "predictedUpBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "roundAdvisoryCommitCount",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setPaused",
    "inputs": [
      {
        "name": "value",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "votingEngine",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract RoundVotingEngine"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AdvisoryLaunchCreditClaimed",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "voter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "advisoryCommitKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "scoreBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "paidAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AdvisoryVoteRecorded",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "voter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "advisoryCommitKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "commitHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "roundReferenceRatingBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "targetRound",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "drandChainHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AdvisoryVoteRevealed",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "voter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "advisoryCommitKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "isUp",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "predictedUpBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PausedUpdated",
    "inputs": [
      {
        "name": "paused",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AdvisoryRevealedAfterRealVote",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AdvisoryRevealedAfterSettlement",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyCommitted",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyRevealed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CooldownActive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EpochNotEnded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HashMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "IndexOutOfBounds",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCommitHash",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPrediction",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MaxAdvisoryVotersReached",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoCommit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotEnoughVotes",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Paused",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PendingCleanup",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RoundNotOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RoundNotSettled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ThresholdReached",
    "inputs": []
  },
  {
    "type": "error",
    "name": "VoteNotRevealed",
    "inputs": []
  }
] as const;
