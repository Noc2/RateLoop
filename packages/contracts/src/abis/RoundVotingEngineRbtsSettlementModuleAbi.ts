export const RoundVotingEngineRbtsSettlementModuleAbi = [
  {
    "type": "function",
    "name": "RATELOOP_RBTS_SETTLEMENT_MODULE_MARKER",
    "inputs": [],
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
    "name": "applyRbtsSettlementSnapshot",
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
        "name": "payoutWeights",
        "type": "tuple[]",
        "internalType": "struct IClusterPayoutOracle.PayoutWeight[]",
        "components": [
          {
            "name": "domain",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "rewardPoolId",
            "type": "uint256",
            "internalType": "uint256"
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
            "name": "commitKey",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "identityKey",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "account",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "baseWeight",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "independenceBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "effectiveWeight",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "reasonHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "proofs",
        "type": "bytes32[][]",
        "internalType": "bytes32[][]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "currentRoundId",
    "inputs": [
      {
        "name": "",
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
    "name": "hasCommits",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
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
    "name": "pendingRatingSettlementReplay",
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
    "name": "roundConfigSnapshot",
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
      }
    ],
    "outputs": [
      {
        "name": "epochDuration",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "maxDuration",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "minVoters",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxVoters",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "roundFrontendRegistrySnapshot",
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
      }
    ],
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
    "name": "roundRaterRegistrySnapshot",
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
      }
    ],
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
    "type": "event",
    "name": "RbtsSettlementSnapshotApplied",
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
        "name": "snapshotDigest",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "effectiveParticipantUnits",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "forfeitsEnabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RbtsSettlementSnapshotTimedOut",
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
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "RoundNotExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RoundNotOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SnapshotAvailable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnrevealedPastEpochVotes",
    "inputs": []
  }
] as const;
