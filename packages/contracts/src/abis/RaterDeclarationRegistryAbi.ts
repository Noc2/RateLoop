export const RaterDeclarationRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "admin",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "governance",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "lrepToken_",
        "type": "address",
        "internalType": "contract IERC20"
      },
      {
        "name": "treasury_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "minDeclarationBondLrep_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "challengeBondLrep_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
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
    "name": "CHALLENGE_RESOLVER_ROLE",
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
    "name": "MAX_TIER_MULTIPLIER_BPS",
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
    "name": "MIN_CHALLENGE_BOND_LREP_FLOOR",
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
    "name": "MIN_DECLARATION_BOND_LREP_FLOOR",
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
    "name": "PROBE_ROLE",
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
    "name": "RATER_DECLARATION_TYPEHASH",
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
    "name": "RETIRED_DECLARATION_BOND_LOCK",
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
    "name": "activeOperatorDeclarations",
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
    "name": "challengeBondLrep",
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
    "name": "challengeOperatorBondAmount",
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
    "name": "challengerRewardBps",
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
    "name": "declarationBondAmount",
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
    "name": "declarationBondOperator",
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
        "type": "address",
        "internalType": "address"
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
    "name": "flagBehavioralDrift",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "version",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "driftScoreBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getChallenge",
    "inputs": [
      {
        "name": "challengeId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RaterDeclarationRegistry.Challenge",
        "components": [
          {
            "name": "challenger",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "rater",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "declarationVersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "resolutionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bondAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "openedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum RaterDeclarationRegistry.ChallengeStatus"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getDeclaration",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RaterDeclarationRegistry.StoredDeclaration",
        "components": [
          {
            "name": "declaration",
            "type": "tuple",
            "internalType": "struct RaterDeclarationRegistry.RaterDeclaration",
            "components": [
              {
                "name": "rater",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "operator",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "modelClass",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "modelId",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "provider",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "endpointHint",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "promptTemplateHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "retrievalConfigHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "toolingHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "version",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "effectiveEpoch",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "expiresAtEpoch",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "disclosure",
                "type": "uint8",
                "internalType": "uint8"
              },
              {
                "name": "nonce",
                "type": "uint96",
                "internalType": "uint96"
              }
            ]
          },
          {
            "name": "tier",
            "type": "uint8",
            "internalType": "enum RaterDeclarationRegistry.RaterTier"
          },
          {
            "name": "declaredAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "probePending",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "declarationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "lastProbeResultHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getLatestProbeResult",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RaterDeclarationRegistry.ProbeResult",
        "components": [
          {
            "name": "probeLibraryHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "resultHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "confidenceBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "recordedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "passed",
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
    "name": "hashDeclaration",
    "inputs": [
      {
        "name": "declaration",
        "type": "tuple",
        "internalType": "struct RaterDeclarationRegistry.RaterDeclaration",
        "components": [
          {
            "name": "rater",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "modelClass",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "modelId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "provider",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "endpointHint",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "promptTemplateHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "retrievalConfigHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "toolingHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "effectiveEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAtEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "disclosure",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "nonce",
            "type": "uint96",
            "internalType": "uint96"
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
    "name": "hashTypedDeclaration",
    "inputs": [
      {
        "name": "declaration",
        "type": "tuple",
        "internalType": "struct RaterDeclarationRegistry.RaterDeclaration",
        "components": [
          {
            "name": "rater",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "modelClass",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "modelId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "provider",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "endpointHint",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "promptTemplateHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "retrievalConfigHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "toolingHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "effectiveEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAtEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "disclosure",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "nonce",
            "type": "uint96",
            "internalType": "uint96"
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
    "name": "minDeclarationBondLrep",
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
    "name": "nextChallengeId",
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
    "name": "nonces",
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
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "openChallenge",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "challengeId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "openDeclarationChallenges",
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
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "openOperatorChallenges",
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
    "name": "operatorBond",
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
    "name": "operatorBondReserved",
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
    "name": "recordProbeResult",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "version",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "probeLibraryHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "confidenceBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "passed",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "resultHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "releaseRetiredDeclarationBond",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
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
    "name": "resolveChallenge",
    "inputs": [
      {
        "name": "challengeId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sustained",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "slashBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "resolutionHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "retireDeclaration",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "retiredDeclarationBondReleaseAt",
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
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
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
    "name": "setDeclarationParameters",
    "inputs": [
      {
        "name": "minDeclarationBondLrep_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "challengeBondLrep_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "challengerRewardBps_",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "treasury_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitDeclaration",
    "inputs": [
      {
        "name": "declaration",
        "type": "tuple",
        "internalType": "struct RaterDeclarationRegistry.RaterDeclaration",
        "components": [
          {
            "name": "rater",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "modelClass",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "modelId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "provider",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "endpointHint",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "promptTemplateHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "retrievalConfigHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "toolingHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "version",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "effectiveEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAtEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "disclosure",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "nonce",
            "type": "uint96",
            "internalType": "uint96"
          }
        ]
      },
      {
        "name": "operatorSignature",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "bondAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "requestProbe",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "declarationHash",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "tierMultiplierBps",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
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
    "name": "withdrawRetiredOperatorBond",
    "inputs": [
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
    "type": "event",
    "name": "BehavioralDriftFlagged",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "version",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "driftScoreBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ChallengeOpened",
    "inputs": [
      {
        "name": "challengeId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "challenger",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "declarationVersion",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "bondAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ChallengeResolved",
    "inputs": [
      {
        "name": "challengeId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "status",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum RaterDeclarationRegistry.ChallengeStatus"
      },
      {
        "name": "operatorSlash",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "challengerReward",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "resolutionHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DeclarationBondReleased",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DeclarationParametersUpdated",
    "inputs": [
      {
        "name": "minDeclarationBondLrep",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "challengeBondLrep",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "challengerRewardBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "treasury",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DeclarationRetired",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "version",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DeclarationSubmitted",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "version",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "effectiveEpoch",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "expiresAtEpoch",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "tier",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum RaterDeclarationRegistry.RaterTier"
      },
      {
        "name": "behaviorChanged",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "probePending",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "declarationHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "modelClass",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "modelId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "provider",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "promptTemplateHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "retrievalConfigHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "toolingHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "disclosure",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
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
    "name": "OperatorBondDeposited",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payer",
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
        "name": "totalBond",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OperatorBondWithdrawn",
    "inputs": [
      {
        "name": "operator",
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
        "name": "remainingBond",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProbeRequested",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "version",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "declarationHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProbeResultRecorded",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "version",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "passed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "confidenceBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "probeLibraryHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "resultHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
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
    "name": "ActiveDeclarations",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BondReleasePending",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureLength",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureS",
    "inputs": [
      {
        "name": "s",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientBond",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidChallenge",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDeclaration",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidProbeResult",
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
    "name": "OpenChallenges",
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
  }
] as const;
