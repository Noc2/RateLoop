export const X402QuestionSubmitterAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_registry",
        "type": "address",
        "internalType": "contract ContentRegistry"
      },
      {
        "name": "_usdcToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_questionRewardPoolEscrow",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_feedbackBonusEscrow",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialOwner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "computeX402QuestionOneShotPaymentNonce",
    "inputs": [
      {
        "name": "metadata",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionMetadata",
        "components": [
          {
            "name": "url",
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
          }
        ]
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
        "name": "feedbackBonusTerms",
        "type": "tuple",
        "internalType": "struct X402QuestionSubmitter.FeedbackBonusTerms",
        "components": [
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "awarder",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "payer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payee",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "validAfter",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "validBefore",
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
    "name": "computeX402QuestionOneShotPaymentNonce",
    "inputs": [
      {
        "name": "metadata",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionMetadata",
        "components": [
          {
            "name": "url",
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
          }
        ]
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
      },
      {
        "name": "feedbackBonusTerms",
        "type": "tuple",
        "internalType": "struct X402QuestionSubmitter.FeedbackBonusTerms",
        "components": [
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "awarder",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "payer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payee",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "validAfter",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "validBefore",
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
    "name": "computeX402QuestionPaymentNonce",
    "inputs": [
      {
        "name": "metadata",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionMetadata",
        "components": [
          {
            "name": "url",
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
          }
        ]
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
        "name": "payer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payee",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "validAfter",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "validBefore",
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
    "name": "computeX402QuestionPaymentNonce",
    "inputs": [
      {
        "name": "metadata",
        "type": "tuple",
        "internalType": "struct ContentRegistry.SubmissionMetadata",
        "components": [
          {
            "name": "url",
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
          }
        ]
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
      },
      {
        "name": "payer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payee",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "validAfter",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "validBefore",
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
    "name": "feedbackBonusEscrow",
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
    "name": "rescueToken",
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
    "name": "setFeedbackBonusEscrow",
    "inputs": [
      {
        "name": "newEscrow",
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
        "name": "newEscrow",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitQuestionWithX402OneShotPayment",
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
      },
      {
        "name": "feedbackBonusTerms",
        "type": "tuple",
        "internalType": "struct X402QuestionSubmitter.FeedbackBonusTerms",
        "components": [
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "awarder",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "paymentAuthorization",
        "type": "tuple",
        "internalType": "struct Eip3009Authorization",
        "components": [
          {
            "name": "from",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "to",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "v",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "r",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "s",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackBonusPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitQuestionWithX402OneShotPayment",
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
        "name": "feedbackBonusTerms",
        "type": "tuple",
        "internalType": "struct X402QuestionSubmitter.FeedbackBonusTerms",
        "components": [
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "awarder",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "paymentAuthorization",
        "type": "tuple",
        "internalType": "struct Eip3009Authorization",
        "components": [
          {
            "name": "from",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "to",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "v",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "r",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "s",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "feedbackBonusPoolId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitQuestionWithX402Payment",
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
        "name": "paymentAuthorization",
        "type": "tuple",
        "internalType": "struct Eip3009Authorization",
        "components": [
          {
            "name": "from",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "to",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "v",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "r",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "s",
            "type": "bytes32",
            "internalType": "bytes32"
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
    "name": "submitQuestionWithX402Payment",
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
      },
      {
        "name": "paymentAuthorization",
        "type": "tuple",
        "internalType": "struct Eip3009Authorization",
        "components": [
          {
            "name": "from",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "to",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "value",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validAfter",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validBefore",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "v",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "r",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "s",
            "type": "bytes32",
            "internalType": "bytes32"
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
    "name": "usdcToken",
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
    "type": "event",
    "name": "FeedbackBonusEscrowUpdated",
    "inputs": [
      {
        "name": "previousEscrow",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "currentEscrow",
        "type": "address",
        "indexed": true,
        "internalType": "address"
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
    "name": "QuestionRewardPoolEscrowUpdated",
    "inputs": [
      {
        "name": "previousEscrow",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "currentEscrow",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "X402FeedbackBonusAttached",
    "inputs": [
      {
        "name": "contentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "feedbackBonusPoolId",
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
      },
      {
        "name": "feedbackClosesAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "awarder",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "X402QuestionSubmitted",
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
        "name": "paymentNonce",
        "type": "bytes32",
        "indexed": true,
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
  }
] as const;
