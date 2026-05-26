export const ClusterPayoutOracleAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "admin",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newFrontendRegistry",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newChallengeBondToken",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ARBITER_ROLE",
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
    "name": "BPS_DENOMINATOR",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "CONFIG_ROLE",
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
    "name": "CORRELATION_EPOCH_DOMAIN",
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
    "name": "DEFAULT_ADMIN_ROLE",
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
    "name": "DEFAULT_CHALLENGE_BOND",
    "inputs": [],
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
    "name": "DEFAULT_CHALLENGE_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "FINALIZATION_VETO_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_CHALLENGE_BOND",
    "inputs": [],
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
    "name": "MAX_CHALLENGE_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_CHALLENGE_BOND",
    "inputs": [],
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
    "name": "PAYOUT_DOMAIN_LAUNCH_CREDIT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PAYOUT_DOMAIN_QUESTION_REWARD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PAYOUT_WEIGHT_DOMAIN",
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
    "name": "ROUND_SNAPSHOT_DOMAIN",
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
    "name": "bondRecipient",
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
    "name": "challengeBond",
    "inputs": [],
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
    "name": "challengeBondToken",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "challengeCorrelationEpoch",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "challengeRoundPayoutSnapshot",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "challengeWindow",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "correlationEpochSnapshot",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ClusterPayoutOracle.CorrelationEpochSnapshot",
        "components": [
          {
            "name": "epochId",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "fromRoundId",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "toRoundId",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "proposedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "finalizedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "proposer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "challenger",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "clusterRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "parameterHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "artifactHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "artifactURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum IClusterPayoutOracle.SnapshotStatus"
          },
          {
            "name": "bond",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalizeChallengedCorrelationEpoch",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeChallengedRoundPayoutSnapshot",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeCorrelationEpoch",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeRoundPayoutSnapshot",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "frontendRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IFrontendRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRoleAdmin",
    "inputs": [
      {
        "name": "role",
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
    "name": "getRoundPayoutSnapshot",
    "inputs": [
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IClusterPayoutOracle.RoundPayoutSnapshot",
        "components": [
          {
            "name": "snapshotKey",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "domain",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "correlationEpochId",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "finalizedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "rawEligibleVoters",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "effectiveParticipantUnits",
            "type": "uint32",
            "internalType": "uint32"
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
            "name": "totalClaimWeight",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "weightRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reasonRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum IClusterPayoutOracle.SnapshotStatus"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "grantRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hasRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
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
    "name": "isRoundPayoutSnapshotFinalized",
    "inputs": [
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
    "name": "payoutWeightLeaf",
    "inputs": [
      {
        "name": "payout",
        "type": "tuple",
        "internalType": "struct IClusterPayoutOracle.PayoutWeight",
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
    "name": "pendingBondWithdrawals",
    "inputs": [
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
    "name": "proposeCorrelationEpoch",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "fromRoundId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "toRoundId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "clusterRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "parameterHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "artifactHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "artifactURI",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "proposeRoundPayoutSnapshot",
    "inputs": [
      {
        "name": "input",
        "type": "tuple",
        "internalType": "struct IClusterPayoutOracle.RoundPayoutSnapshotInput",
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
            "name": "correlationEpochId",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "rawEligibleVoters",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "effectiveParticipantUnits",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "totalClaimWeight",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "weightRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "reasonRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "artifactHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "artifactURI",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "rejectCorrelationEpoch",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rejectFinalizedCorrelationEpoch",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rejectFinalizedRoundPayoutSnapshot",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rejectFinalizedRoundPayoutSnapshotRoot",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rejectRoundPayoutSnapshot",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rejectRoundPayoutSnapshotRoot",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rejectedCorrelationEpochRoots",
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "rejectedRoundPayoutSnapshotConsumed",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "rejectedRoundPayoutSnapshotDigests",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "rejectedRoundPayoutSnapshotRoots",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "callerConfirmation",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "roundPayoutProposal",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ClusterPayoutOracle.RoundPayoutProposal",
        "components": [
          {
            "name": "snapshot",
            "type": "tuple",
            "internalType": "struct IClusterPayoutOracle.RoundPayoutSnapshot",
            "components": [
              {
                "name": "snapshotKey",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "domain",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "correlationEpochId",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "finalizedAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "rawEligibleVoters",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "effectiveParticipantUnits",
                "type": "uint32",
                "internalType": "uint32"
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
                "name": "totalClaimWeight",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "weightRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "reasonRoot",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "status",
                "type": "uint8",
                "internalType": "enum IClusterPayoutOracle.SnapshotStatus"
              }
            ]
          },
          {
            "name": "proposedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "consumer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "proposer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "challenger",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "artifactHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "artifactURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "bond",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "proposerBond",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "roundPayoutSnapshotConsumer",
    "inputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
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
    "name": "roundPayoutSnapshotConsumerFor",
    "inputs": [
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
    "name": "roundPayoutSnapshotKey",
    "inputs": [
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "roundPayoutSnapshotProposalDigest",
    "inputs": [
      {
        "name": "snapshotKey",
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
    "name": "roundPayoutSnapshotProposedAt",
    "inputs": [
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
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setFrontendRegistry",
    "inputs": [
      {
        "name": "newFrontendRegistry",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setOracleConfig",
    "inputs": [
      {
        "name": "newChallengeWindow",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "newChallengeBond",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "newBondRecipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setRoundPayoutSnapshotConsumer",
    "inputs": [
      {
        "name": "domain",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "consumer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceId",
        "type": "bytes4",
        "internalType": "bytes4"
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
    "name": "verifyPayoutWeight",
    "inputs": [
      {
        "name": "payout",
        "type": "tuple",
        "internalType": "struct IClusterPayoutOracle.PayoutWeight",
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
        "name": "proof",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
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
    "name": "withdrawBondCredit",
    "inputs": [],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawBondCreditTo",
    "inputs": [
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "BondWithdrawalCredited",
    "inputs": [
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BondWithdrawn",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CorrelationEpochChallengeDismissed",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "arbiter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CorrelationEpochChallenged",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "challenger",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CorrelationEpochFinalized",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "clusterRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "parameterHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CorrelationEpochProposed",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "fromRoundId",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "toRoundId",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "frontendOperator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "clusterRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "parameterHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "artifactHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "artifactURI",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CorrelationEpochRejected",
    "inputs": [
      {
        "name": "epochId",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "arbiter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FrontendRegistryUpdated",
    "inputs": [
      {
        "name": "frontendRegistry",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OracleConfigUpdated",
    "inputs": [
      {
        "name": "challengeWindow",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "challengeBond",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bondRecipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProposerBondUnrecoverable",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "proposer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "missingAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleAdminChanged",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "previousAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "newAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleGranted",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoleRevoked",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundPayoutSnapshotChallengeDismissed",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "arbiter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundPayoutSnapshotChallenged",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "challenger",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundPayoutSnapshotConsumerUpdated",
    "inputs": [
      {
        "name": "domain",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "consumer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundPayoutSnapshotFinalized",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "domain",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "correlationEpochId",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundPayoutSnapshotProposed",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "domain",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "correlationEpochId",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "frontendOperator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "rawEligibleVoters",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "effectiveParticipantUnits",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "totalClaimWeight",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "weightRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "reasonRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "artifactHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "artifactURI",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundPayoutSnapshotRejected",
    "inputs": [
      {
        "name": "snapshotKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "arbiter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AccessControlBadConfirmation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AccessControlUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "neededRole",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "FrontendNotEligible",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBond",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProof",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSnapshot",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeCastOverflowedUintDowncast",
    "inputs": [
      {
        "name": "bits",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SnapshotChallenged",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SnapshotConsumed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SnapshotExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SnapshotFinalized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SnapshotNotFinalizable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SnapshotNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SourceNotReady",
    "inputs": []
  }
] as const;
