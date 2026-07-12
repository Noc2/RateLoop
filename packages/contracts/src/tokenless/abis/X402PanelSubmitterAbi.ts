/**
 * Generated from rateloop-tokenless-deployment-v1.
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
            "name": "requiredTier",
            "type": "uint32",
            "internalType": "uint32"
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
        "name": "roundId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
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
    "name": "TransferAmountMismatch",
    "inputs": []
  }
] as const;
