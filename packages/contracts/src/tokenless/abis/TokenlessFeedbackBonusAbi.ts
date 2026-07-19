/**
 * Generated from rateloop-tokenless-deployment-v4.
 * Do not edit manually.
 */
export const TokenlessFeedbackBonusAbi = [
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
    "name": "FEEDBACK_TYPEHASH",
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
    "name": "MAX_AWARD_WINDOW",
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
    "name": "MAX_FEEDBACK_HORIZON",
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
    "name": "MIN_FEEDBACK_WINDOW",
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
    "name": "award",
    "inputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "voteKey",
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
    "name": "claimAward",
    "inputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "voteKey",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payoutAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payoutSalt",
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
    "name": "createPool",
    "inputs": [
      {
        "name": "terms",
        "type": "tuple",
        "internalType": "struct TokenlessFeedbackBonus.PoolTerms",
        "components": [
          {
            "name": "reviewId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "admissionPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feedbackDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "awardDeadline",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "designatedAwarder",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createPoolFor",
    "inputs": [
      {
        "name": "terms",
        "type": "tuple",
        "internalType": "struct TokenlessFeedbackBonus.PoolTerms",
        "components": [
          {
            "name": "reviewId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "admissionPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feedbackDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "awardDeadline",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "funder",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "awarder",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "poolId",
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
    "name": "feedbackDigest",
    "inputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "responseHash",
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
    "name": "feedbackKeyFor",
    "inputs": [
      {
        "name": "poolId",
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
    "name": "getFeedback",
    "inputs": [
      {
        "name": "poolId",
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
        "type": "tuple",
        "internalType": "struct TokenlessFeedbackBonus.FeedbackRecord",
        "components": [
          {
            "name": "voteKey",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "responseHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "payoutCommitment",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "registeredAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "awardAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "awarded",
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
    "name": "getPool",
    "inputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct TokenlessFeedbackBonus.Pool",
        "components": [
          {
            "name": "reviewId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "admissionPolicyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "funder",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "awarder",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "depositedAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "awardedAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feedbackDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "awardDeadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "refunded",
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
    "name": "nextPoolId",
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
    "name": "poolKeyFor",
    "inputs": [
      {
        "name": "requester",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "reviewId",
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
    "name": "refundRemainder",
    "inputs": [
      {
        "name": "poolId",
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
    "name": "registerFeedback",
    "inputs": [
      {
        "name": "voucher",
        "type": "tuple",
        "internalType": "struct TokenlessFeedbackBonus.Voucher",
        "components": [
          {
            "name": "voteKey",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "reviewId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "poolId",
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
        "name": "responseHash",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "remainingAmount",
    "inputs": [
      {
        "name": "poolId",
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
    "name": "responseAwarded",
    "inputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "responseHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "awarded",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reviewPoolId",
    "inputs": [
      {
        "name": "poolKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "internalType": "uint256"
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
        "internalType": "struct TokenlessFeedbackBonus.Voucher",
        "components": [
          {
            "name": "voteKey",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "reviewId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "contentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "poolId",
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
    "name": "FeedbackAwardClaimed",
    "inputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "feedbackKey",
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
    "name": "FeedbackAwarded",
    "inputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "feedbackKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "responseHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "voteKey",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "payoutCommitment",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
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
    "name": "FeedbackRegistered",
    "inputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "feedbackKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "responseHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "voteKey",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "payoutCommitment",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PoolCreated",
    "inputs": [
      {
        "name": "poolId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "reviewId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "contentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "admissionPolicyHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "payer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "funder",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "awarder",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "feedbackDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "awardDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RemainderRefunded",
    "inputs": [
      {
        "name": "poolId",
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
    "name": "AlreadyAwarded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AwardNotClaimable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AwardWindowClosed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FeedbackAlreadyRegistered",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FeedbackWindowClosed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FeedbackWindowOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDeadline",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidFeedback",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPool",
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
    "name": "InvalidTerms",
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
    "name": "NothingToRefund",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NullifierAlreadyUsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PoolAlreadyExists",
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
