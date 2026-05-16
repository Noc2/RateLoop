export const QuestionRewardPoolEscrowAbi = [
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
    "name": "advanceQualificationCursor",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxRounds",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "skipped",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nextRoundToEvaluate",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimQuestionBundleReward",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundSetIndex",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "rewardAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimQuestionReward",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "payoutWeight",
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
        "name": "rewardAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimQuestionReward",
    "inputs": [
      {
        "name": "rewardPoolId",
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
        "name": "rewardAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimableQuestionBundleReward",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundSetIndex",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "claimableAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimableQuestionReward",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "claimableAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimableQuestionRewardWithPayoutWeight",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payoutWeight",
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
        "name": "claimableAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createChallengeRewardPool",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
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
        "name": "challengedRoundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createChallengeRewardPoolWithEligibility",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
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
        "name": "challengedRoundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createRerateRewardPool",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
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
        "name": "previousRoundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createRerateRewardPoolWithEligibility",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
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
        "name": "previousRoundId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reasonHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createRewardPool",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
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
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createRewardPoolWithEligibility",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
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
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createSubmissionBundleFromRegistry",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "contentIds",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "funder",
        "type": "address",
        "internalType": "address"
      },
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
        "name": "requiredCompleters",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "requiredSettledRounds",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createSubmissionBundleFromRegistry",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "contentIds",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "funder",
        "type": "address",
        "internalType": "address"
      },
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
        "name": "requiredCompleters",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "requiredSettledRounds",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createSubmissionRewardPoolFromRegistry",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "funder",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payer",
        "type": "address",
        "internalType": "address"
      },
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
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createSubmissionRewardPoolFromRegistry",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "funder",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payer",
        "type": "address",
        "internalType": "address"
      },
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
        "name": "bountyClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "defaultFrontendFeeBps",
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
    "name": "getQuestionBundleEligibility",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "bountyEligibilityDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRewardPoolEligibility",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "bountyEligibilityDataHash",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "getRoundSnapshot",
    "inputs": [
      {
        "name": "rewardPoolId",
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
        "internalType": "struct RoundSnapshot",
        "components": [
          {
            "name": "qualified",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "eligibleVoters",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "rawEligibleVoters",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "allocation",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "claimedCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "frontendFeeAllocation",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalClaimWeight",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "claimedWeight",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "claimedAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "frontendFeeClaimedAmount",
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
    "name": "initialize",
    "inputs": [
      {
        "name": "admin",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "lrepToken_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "usdcToken_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "registry_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "votingEngine_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "raterRegistry_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
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
    "name": "qualifyRound",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      },
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
    "name": "recordBundleQuestionTerminal",
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
        "name": "settled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recoverNonAssetToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refundExpiredRewardPool",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "refundAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refundInactiveRewardPool",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "refundAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refundQuestionBundleReward",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "refundAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
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
    "name": "syncBundleQuestionTerminal",
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
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "DefaultFrontendFeeBpsUpdated",
    "inputs": [
      {
        "name": "previousFrontendFeeBps",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "newFrontendFeeBps",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
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
    "name": "NonAssetTokenRecovered",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
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
    "name": "QuestionBundleEligibilitySet",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuestionBundleRewardClaimed",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "roundSetIndex",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "claimant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "identityKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "frontend",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "frontendRecipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "frontendFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "grossAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuestionBundleRewardCreated",
    "inputs": [
      {
        "name": "bundleId",
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
        "name": "funderIdentityKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
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
        "name": "questionCount",
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
        "name": "bountyOpensAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bountyClosesAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "frontendFeeBps",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "asset",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
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
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuestionBundleRewardForfeited",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "treasury",
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
    "name": "QuestionBundleRewardRefunded",
    "inputs": [
      {
        "name": "bundleId",
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
    "type": "event",
    "name": "QuestionBundleRoundRecorded",
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
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "bundleIndex",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "roundSetIndex",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuestionBundleRoundSetQualified",
    "inputs": [
      {
        "name": "bundleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "roundSetIndex",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "allocation",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "frontendFeeAllocation",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuestionRewardClaimed",
    "inputs": [
      {
        "name": "rewardPoolId",
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
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "claimant",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "identityKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "frontend",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "frontendRecipient",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "frontendFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "grossAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RewardPoolClusterPayoutOracleSnapshotted",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "clusterPayoutOracle",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RewardPoolCreated",
    "inputs": [
      {
        "name": "rewardPoolId",
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
        "name": "funder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "funderIdentityKey",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
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
        "name": "startRoundId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bountyOpensAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "bountyClosesAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "frontendFeeBps",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "asset",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
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
        "name": "nonRefundable",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RewardPoolCursorAdvanced",
    "inputs": [
      {
        "name": "rewardPoolId",
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
        "name": "fromRoundId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "toRoundId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "skipped",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RewardPoolEligibilitySet",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "bountyEligibility",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RewardPoolForfeited",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "treasury",
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
    "name": "RewardPoolPurposeSet",
    "inputs": [
      {
        "name": "rewardPoolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "bountyKind",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "challengedRoundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
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
    "name": "RewardPoolRefunded",
    "inputs": [
      {
        "name": "rewardPoolId",
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
    "type": "event",
    "name": "RewardPoolRoundCorrelationSnapshotApplied",
    "inputs": [
      {
        "name": "rewardPoolId",
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
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "correlationEpochId",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "weightRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RewardPoolRoundEffectiveUnits",
    "inputs": [
      {
        "name": "rewardPoolId",
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
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "rawEligibleVoters",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "effectiveParticipantUnits",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "totalClaimWeight",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RewardPoolRoundQualified",
    "inputs": [
      {
        "name": "rewardPoolId",
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
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "allocation",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "eligibleVoters",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "frontendFeeAllocation",
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
    "name": "NotInitializing",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RewardPoolCursorNeedsAdvance",
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
  }
] as const;
