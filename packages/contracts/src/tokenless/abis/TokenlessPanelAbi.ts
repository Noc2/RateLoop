/**
 * Generated from rateloop-tokenless-deployment-v4.
 * Do not edit manually.
 */
export const TokenlessPanelAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "usdc_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "credentialIssuer_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BASE_PAY_BPS",
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
    "name": "COMMIT_TYPEHASH",
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
    "name": "MAXIMUM_COMMITS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_BEACON_FAILURE_HORIZON",
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
    "name": "MAX_CLAIM_GRACE_PERIOD",
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
    "name": "MAX_FEE_BPS",
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
    "name": "MAX_REVEAL_HORIZON",
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
    "name": "MIN_BEACON_GRACE",
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
    "name": "MIN_COMMIT_WINDOW",
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
    "name": "MIN_REVEAL_WINDOW",
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
    "name": "REVEAL_TYPEHASH",
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
    "name": "SCORING_VERSION",
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
    "name": "VOUCHER_TYPEHASH",
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
    "name": "beginSettlement",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelEmptyRound",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "commitKey",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "payoutAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "type": "function",
    "name": "claimCompensation",
    "inputs": [
      {
        "name": "commitKey",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "payoutAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "type": "function",
    "name": "commit",
    "inputs": [
      {
        "name": "voucher",
        "type": "tuple",
        "internalType": "struct TokenlessPanel.Voucher",
        "components": [
          {
            "name": "voteKey",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "roundId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nullifier",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "admissionPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "issuerEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "sealedCommitment",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sealedPayload",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "payoutCommitment",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "voucherSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "voteKeySignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "commitDigest",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sealedCommitment",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sealedPayloadHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "payoutCommitment",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nullifier",
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
    "name": "commitKeyFor",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "voteKey",
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
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "createRound",
    "inputs": [
      {
        "name": "terms",
        "type": "tuple",
        "internalType": "struct TokenlessPanel.RoundTerms",
        "components": [
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "termsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "beaconNetworkHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bountyAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feeAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "attemptReserve",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "attemptCompensation",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minimumReveals",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maximumCommits",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "admissionPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "commitDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "revealDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "beaconFailureDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "beaconRound",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "claimGracePeriod",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "feeRecipient",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createRoundFor",
    "inputs": [
      {
        "name": "terms",
        "type": "tuple",
        "internalType": "struct TokenlessPanel.RoundTerms",
        "components": [
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "termsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "beaconNetworkHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bountyAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feeAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "attemptReserve",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "attemptCompensation",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minimumReveals",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maximumCommits",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "admissionPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "commitDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "revealDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "beaconFailureDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "beaconRound",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "claimGracePeriod",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "feeRecipient",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "funder",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "credentialIssuer",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICredentialIssuer"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalizeScoringSeed",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "finalizeSettlement",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getCommit",
    "inputs": [
      {
        "name": "commitKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct TokenlessPanel.CommitRecord",
        "components": [
          {
            "name": "roundId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "voteKey",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sealedCommitment",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "sealedPayloadHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "payoutCommitment",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "responseHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "referenceCommitKey",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "peerCommitKey",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "finalizedPayout",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "predictedUpBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "informationScoreBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "predictionScoreBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "rbtsScoreBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "vote",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "revealed",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "claimed",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRound",
    "inputs": [
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
        "internalType": "struct TokenlessPanel.Round",
        "components": [
          {
            "name": "funder",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "termsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "beaconNetworkHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "feeRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "bountyAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feeAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "attemptReserve",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "attemptCompensation",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "fixedBasePay",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maximumBonus",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "compensationPerRecipient",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalRbtsScoreBps",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalFinalizedLiability",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalPaid",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "entropyBlock",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "revealSetXor",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "revealSetSum",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "scoringSeed",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "commitDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "revealDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "beaconFailureDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "beaconRound",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "claimGracePeriod",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "claimDeadline",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minimumReveals",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maximumCommits",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "admissionPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "commitCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "revealCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "compensatedRevealCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "frozenRevealCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "aggregateCursor",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "scoreCursor",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "upVotes",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum TokenlessPanel.RoundState"
          },
          {
            "name": "scoringMode",
            "type": "uint8",
            "internalType": "enum TokenlessPanel.ScoringMode"
          },
          {
            "name": "staleReturned",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextRoundId",
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
    "name": "nullifierUsed",
    "inputs": [
      {
        "name": "nullifier",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "used",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "openReveal",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "payoutCommitmentFor",
    "inputs": [
      {
        "name": "payoutAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
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
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "previewPayout",
    "inputs": [
      {
        "name": "commitKey",
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
    "name": "processAggregate",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cursor",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "count",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "processScores",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cursor",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "count",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "returnStaleShares",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
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
    "type": "function",
    "name": "reveal",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "voteKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vote",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "predictedUpBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "responseHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "payoutAddress",
        "type": "address",
        "internalType": "address"
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
    "name": "revealCommitment",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "voteKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "vote",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "predictedUpBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "responseHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "payoutAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
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
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "roundCommitKey",
    "inputs": [
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
    "name": "roundRevealKey",
    "inputs": [
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
    "name": "totalWithdrawableCredit",
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
    "name": "usdc",
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
    "name": "voucherDigest",
    "inputs": [
      {
        "name": "voucher",
        "type": "tuple",
        "internalType": "struct TokenlessPanel.Voucher",
        "components": [
          {
            "name": "voteKey",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "roundId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nullifier",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "admissionPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "issuerEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
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
    "name": "withdrawCredit",
    "inputs": [
      {
        "name": "destination",
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
    "type": "function",
    "name": "withdrawableCredit",
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
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "commitKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "payoutAddress",
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
    "name": "CommitAccepted",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "commitKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "nullifier",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sealedPayload",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CreditAccrued",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
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
    "name": "CreditWithdrawn",
    "inputs": [
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "destination",
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
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RevealAccepted",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "commitKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "vote",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "predictedUpBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "responseHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "scoringEligible",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RevealScored",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "commitKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "referenceCommitKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "peerCommitKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "informationScoreBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "predictionScoreBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "rbtsScoreBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "finalizedPayout",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundCreated",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "funder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "contentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "termsHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "admissionPolicyHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "bountyAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "feeAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "attemptReserve",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "fixedBasePay",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "maximumBonus",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "scoringVersion",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundFinalized",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "mode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TokenlessPanel.ScoringMode"
      },
      {
        "name": "totalRbtsScoreBps",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "totalFinalizedLiability",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "funderRefund",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "claimDeadline",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundTerminal",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "state",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TokenlessPanel.RoundState"
      },
      {
        "name": "funderRefund",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "compensation",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ScoringSeedFinalized",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "mode",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TokenlessPanel.ScoringMode"
      },
      {
        "name": "entropyBlock",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "entropy",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "scoringSeed",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "revealSetXor",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "revealSetSum",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SettlementBegun",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "frozenRevealCount",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "entropyBlock",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SettlementProgressed",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "state",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum TokenlessPanel.RoundState"
      },
      {
        "name": "cursor",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StaleSharesReturned",
    "inputs": [
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "funder",
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
    "type": "error",
    "name": "AlreadyClaimed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CapacityReached",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ClaimWindowOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CommitAlreadyExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CommitNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CursorMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCommitment",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDeadline",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPrediction",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPrediction",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRevealSet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTerms",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidVote",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidVoucher",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoCredit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotClaimable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToProcess",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NullifierAlreadyUsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
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
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "TransferAmountMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
