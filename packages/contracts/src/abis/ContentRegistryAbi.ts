export const ContentRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [],
    "stateMutability": "nonpayable"
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
    "name": "applyRatingPayoutSnapshot",
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
    "name": "cancelContent",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelReservedSubmission",
    "inputs": [
      {
        "name": "revealCommitment",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "contentSubmitterIdentityKey",
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
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "contents",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "contentHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "submitter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "createdAt",
        "type": "uint48",
        "internalType": "uint48"
      },
      {
        "name": "lastActivityAt",
        "type": "uint48",
        "internalType": "uint48"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum ContentRegistryTypes.ContentStatus"
      },
      {
        "name": "dormantCount",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "reviver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "rating",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "categoryId",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "dormantKeyReleasableAt",
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
    "name": "getContentRoundConfig",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct RoundLib.RoundConfig",
        "components": [
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
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRating",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
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
    "name": "getSubmitterIdentity",
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
        "type": "address",
        "internalType": "address"
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
    "name": "initializeWithTreasury",
    "inputs": [
      {
        "name": "_admin",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_governance",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_treasuryAuthority",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_lrepToken",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "isContentActive",
    "inputs": [
      {
        "name": "contentId",
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
    "name": "isRoundPayoutSnapshotConsumed",
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
    "name": "lrepToken",
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
    "name": "markDormant",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "nextContentId",
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
    "name": "nextVotingRoundId",
    "inputs": [
      {
        "name": "contentId",
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
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
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
    "name": "questionBundleRoundObserver",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "bundleRewardPoolEscrow",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "questionRewardPoolEscrow",
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
    "name": "recordPendingRatingSettlement",
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
        "name": "referenceRatingBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "upEvidence",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "downEvidence",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "releaseDormantSubmissionKey",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
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
    "name": "repointPendingRatingClusterPayoutOracle",
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
        "name": "newOracle",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reserveNextVotingRound",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "reserveSubmission",
    "inputs": [
      {
        "name": "revealCommitment",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reviveContent",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "roundPayoutSnapshotSourceReadyAt",
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
    "name": "setCategoryRegistry",
    "inputs": [
      {
        "name": "_categoryRegistry",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setProtocolConfig",
    "inputs": [
      {
        "name": "_protocolConfig",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setQuestionRewardPoolEscrow",
    "inputs": [
      {
        "name": "_questionRewardPoolEscrow",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTreasury",
    "inputs": [
      {
        "name": "_treasury",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setVotingEngine",
    "inputs": [
      {
        "name": "_votingEngine",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submissionKeyUsed",
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
    "name": "submissionMediaValidator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract SubmissionMediaValidator"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "submitQuestion",
    "inputs": [
      {
        "name": "contextUrl",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "imageUrls",
        "type": "string[]",
        "internalType": "string[]"
      },
      {
        "name": "videoUrl",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "title",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "tags",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "categoryId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "details",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionDetails",
        "components": [
          {
            "name": "detailsUrl",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "detailsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "spec",
        "type": "tuple",
        "internalType": "struct ContentRegistry.QuestionSpecCommitment",
        "components": [
          {
            "name": "questionMetadataHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "resultSpecHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitQuestionBundleWithRewardAndRoundConfig",
    "inputs": [
      {
        "name": "questions",
        "type": "tuple[]",
        "internalType": "struct ContentRegistry.BundleQuestionInput[]",
        "components": [
          {
            "name": "contextUrl",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "imageUrls",
            "type": "string[]",
            "internalType": "string[]"
          },
          {
            "name": "videoUrl",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "title",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "tags",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "categoryId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "details",
            "type": "tuple",
            "internalType": "struct ContentRegistry.SubmissionDetails",
            "components": [
              {
                "name": "detailsUrl",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "detailsHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "spec",
            "type": "tuple",
            "internalType": "struct ContentRegistry.QuestionSpecCommitment",
            "components": [
              {
                "name": "questionMetadataHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "resultSpecHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ]
      },
      {
        "name": "rewardTerms",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionRewardTerms",
        "components": [
          {
            "name": "asset",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requiredVoters",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requiredSettledRounds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bountyStartBy",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bountyWindowSeconds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feedbackWindowSeconds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bountyEligibility",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "name": "roundConfig",
        "type": "tuple",
        "internalType": "struct RoundLib.RoundConfig",
        "components": [
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
        ]
      }
    ],
    "outputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "contentIds",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitQuestionFromX402Gateway",
    "inputs": [
      {
        "name": "contextUrl",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "imageUrls",
        "type": "string[]",
        "internalType": "string[]"
      },
      {
        "name": "videoUrl",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "title",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "tags",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "categoryId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "details",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionDetails",
        "components": [
          {
            "name": "detailsUrl",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "detailsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "rewardTerms",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionRewardTerms",
        "components": [
          {
            "name": "asset",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requiredVoters",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requiredSettledRounds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bountyStartBy",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bountyWindowSeconds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feedbackWindowSeconds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bountyEligibility",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "name": "roundConfig",
        "type": "tuple",
        "internalType": "struct RoundLib.RoundConfig",
        "components": [
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
        ]
      },
      {
        "name": "spec",
        "type": "tuple",
        "internalType": "struct ContentRegistry.QuestionSpecCommitment",
        "components": [
          {
            "name": "questionMetadataHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "resultSpecHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "submitter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "confidentiality",
        "type": "tuple",
        "internalType": "struct IConfidentialityEscrow.ConfidentialityConfig",
        "components": [
          {
            "name": "gated",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "bondAsset",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "bondAmount",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "flags",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitQuestionWithRewardAndRoundConfig",
    "inputs": [
      {
        "name": "contextUrl",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "imageUrls",
        "type": "string[]",
        "internalType": "string[]"
      },
      {
        "name": "videoUrl",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "title",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "tags",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "categoryId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "details",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionDetails",
        "components": [
          {
            "name": "detailsUrl",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "detailsHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "rewardTerms",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionRewardTerms",
        "components": [
          {
            "name": "asset",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requiredVoters",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "requiredSettledRounds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bountyStartBy",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bountyWindowSeconds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feedbackWindowSeconds",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "bountyEligibility",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      },
      {
        "name": "roundConfig",
        "type": "tuple",
        "internalType": "struct RoundLib.RoundConfig",
        "components": [
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
        ]
      },
      {
        "name": "spec",
        "type": "tuple",
        "internalType": "struct ContentRegistry.QuestionSpecCommitment",
        "components": [
          {
            "name": "questionMetadataHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "resultSpecHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "confidentiality",
        "type": "tuple",
        "internalType": "struct IConfidentialityEscrow.ConfidentialityConfig",
        "components": [
          {
            "name": "gated",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "bondAsset",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "bondAmount",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "flags",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
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
    "name": "supportsRoundPayoutSnapshotDomain",
    "inputs": [
      {
        "name": "domain",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "trackedVotingEngine",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "engine",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "treasury",
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
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateActivity",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
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
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "ContentCancelled",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ContentDetailsSubmitted",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "detailsUrl",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "detailsHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ContentDormant",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ContentRevived",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "reviver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ContentRoundConfigSet",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "epochDuration",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "maxDuration",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "minVoters",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "maxVoters",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ContentSubmitted",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "submitter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "contentHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "url",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "title",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "tags",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "categoryId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DormantSubmissionKeyReleased",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "submissionKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Initialized",
    "inputs": [
      {
        "name": "version",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PendingRatingClusterPayoutOracleRepointed",
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
        "name": "oldClusterPayoutOracle",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newClusterPayoutOracle",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuestionBundleContentLinked",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "bundleIndex",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuestionBundleSubmitted",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "submitter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "questionCount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "rewardAsset",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "requiredCompleters",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bountyStartBy",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bountyWindowSeconds",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "feedbackWindowSeconds",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "bountyEligibilityDataHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "bundleHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuestionContentAnchored",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "mediaType",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "mediaIndex",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "url",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "questionMetadataHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "resultSpecHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuestionRewardPoolEscrowUpdated",
    "inputs": [
      {
        "name": "rewardPoolEscrow",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RatingReviewPending",
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
        "name": "referenceRatingBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "rawUpEvidence",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "rawDownEvidence",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "readyAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RatingSnapshotApplied",
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
        "name": "snapshotKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "snapshotDigest",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "adjustedUpEvidence",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "adjustedDownEvidence",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RatingStateUpdated",
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
        "name": "referenceRatingBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "oldRatingBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "newRatingBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "conservativeRatingBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "upEvidence",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "downEvidence",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "confidenceMass",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "effectiveEvidence",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "settledRounds",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "lowSince",
        "type": "uint48",
        "indexed": false,
        "internalType": "uint48"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RatingUpdated",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "oldRating",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "newRating",
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
    "name": "SubmissionReservationCancelled",
    "inputs": [
      {
        "name": "submitter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "revealCommitment",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SubmissionReserved",
    "inputs": [
      {
        "name": "submitter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "revealCommitment",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "expiresAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SubmissionRewardPoolAttached",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "submitter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "rewardAsset",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "requiredVoters",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "requiredSettledRounds",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bountyStartBy",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bountyWindowSeconds",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "feedbackWindowSeconds",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "bountyEligibilityDataHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
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
    "name": "ActiveRoundOnPreviousEngine",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidInitialization",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotInitializing",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyVotingEngine",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  }
] as const;
