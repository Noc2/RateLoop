/**
 * Generated from rateloop-tokenless-deployment-v4.
 * Do not edit manually.
 */
export const X402PanelSubmitterAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "usdc_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "panel_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ROUND_AUTHORIZATION_TYPEHASH",
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
    "name": "ROUND_TERMS_TYPEHASH",
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
    "name": "authorizationToken",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC3009"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createRoundWithAuthorization",
    "inputs": [
      {
        "name": "funder",
        "type": "address",
        "internalType": "address"
      },
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
            "name": "scoringBeaconRound",
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
        "name": "authorization",
        "type": "tuple",
        "internalType": "struct X402PanelSubmitter.Authorization",
        "components": [
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
      },
      {
        "name": "roundAuthorizationSignature",
        "type": "bytes",
        "internalType": "bytes"
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
    "name": "panel",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract TokenlessPanel"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "roundAuthorizationDigest",
    "inputs": [
      {
        "name": "funder",
        "type": "address",
        "internalType": "address"
      },
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
            "name": "scoringBeaconRound",
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
        "name": "authorization",
        "type": "tuple",
        "internalType": "struct X402PanelSubmitter.Authorization",
        "components": [
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
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "roundTermsDigest",
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
            "name": "scoringBeaconRound",
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
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
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
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RoundSubmitted",
    "inputs": [
      {
        "name": "funder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "roundId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
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
    "name": "InvalidAddress",
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
  }
] as const;
