export const RaterRegistryAbi = [
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
        "name": "_worldIdRouter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_worldIdScope",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "_worldIdExternalNullifierHash",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_worldIdCredentialTtl",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ADMIN_ROLE",
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
    "name": "BASE_MULTIPLIER_BPS",
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
    "name": "CLUSTER_CHALLENGE_RESOLVER_ROLE",
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
    "name": "MAX_CLUSTER_DISCOUNT_BPS",
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
    "name": "MAX_CREDENTIAL_MULTIPLIER_BPS",
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
    "name": "MAX_TRUST_BOOST_BPS",
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
    "name": "SCORER_ROLE",
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
    "name": "SEEDER_ROLE",
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
    "name": "WORLD_ID_GROUP_ID",
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
    "name": "WORLD_ID_MULTIPLIER_BPS",
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
    "name": "attestSelfCredentialWithProof",
    "inputs": [
      {
        "name": "root",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nullifierHash",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "proof",
        "type": "uint256[8]",
        "internalType": "uint256[8]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "clusterScoreKey",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "scorerEpoch",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "algorithmHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "modelVersionHash",
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
    "name": "credentialMultiplierBps",
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
    "name": "followProfile",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "followerCount",
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
    "name": "followingCount",
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
    "name": "getClusterScore",
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
        "internalType": "struct RaterRegistry.ClusterScore",
        "components": [
          {
            "name": "clusterId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "discountBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "scorerEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "updatedAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getClusterScoreAt",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "scorerEpoch",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "algorithmHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "modelVersionHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RaterRegistry.VersionedClusterScore",
        "components": [
          {
            "name": "clusterId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "discountBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "scorerEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "updatedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "algorithmHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "modelVersionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "scoreRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "challengeWindowEndsAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "scoreKey",
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
    "name": "getClusterScoreByKey",
    "inputs": [
      {
        "name": "scoreKey",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RaterRegistry.VersionedClusterScore",
        "components": [
          {
            "name": "clusterId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "discountBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "scorerEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "updatedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "algorithmHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "modelVersionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "scoreRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "challengeWindowEndsAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "scoreKey",
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
    "name": "getClusterScoreChallenge",
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
        "internalType": "struct RaterRegistry.ClusterScoreChallenge",
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
            "name": "scorerEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "algorithmHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "modelVersionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "scoreKey",
            "type": "bytes32",
            "internalType": "bytes32"
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
            "name": "openedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "resolvedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum RaterRegistry.ClusterScoreChallengeStatus"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getProfile",
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
        "internalType": "struct RaterRegistry.RaterProfile",
        "components": [
          {
            "name": "raterType",
            "type": "uint8",
            "internalType": "enum RaterRegistry.RaterType"
          },
          {
            "name": "metadataHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "updatedAt",
            "type": "uint64",
            "internalType": "uint64"
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
    "name": "getSelfCredential",
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
        "internalType": "struct RaterRegistry.SelfCredential",
        "components": [
          {
            "name": "verified",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "legacy",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "revoked",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "nullifierHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "scope",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "verifiedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "multiplierBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "evidenceHash",
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
    "name": "getTrustAttestation",
    "inputs": [
      {
        "name": "attestationId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RaterRegistry.TrustAttestation",
        "components": [
          {
            "name": "issuer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "subject",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "categoryId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "trustBudget",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "maxBoostBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "metadataHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "issuedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "revoked",
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
    "name": "getTrustSeed",
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
        "internalType": "struct RaterRegistry.TrustSeed",
        "components": [
          {
            "name": "active",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "seededAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "sunsetAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "trustBudgetBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "seedRoot",
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
    "name": "getVersionedClusterScore",
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
        "internalType": "struct RaterRegistry.VersionedClusterScore",
        "components": [
          {
            "name": "clusterId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "discountBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "scorerEpoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "updatedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "algorithmHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "modelVersionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "scoreRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "challengeWindowEndsAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "scoreKey",
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
    "name": "hasActiveSelfCredential",
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasActiveTrustSeed",
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
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
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
    "name": "hashToField",
    "inputs": [
      {
        "name": "value",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "isFollowing",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
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
    "name": "nextClusterScoreChallengeId",
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
    "name": "openClusterScoreChallenge",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "scorerEpoch",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "algorithmHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "modelVersionHash",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "publishClusterScore",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "clusterId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "discountBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "scorerEpoch",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "metadata",
        "type": "tuple",
        "internalType": "struct RaterRegistry.ClusterScoreMetadata",
        "components": [
          {
            "name": "algorithmHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "modelVersionHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "scoreRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "challengeWindowEndsAt",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "scoreKey",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "resolveClusterScoreChallenge",
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
    "name": "revokeSelfCredential",
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
    "name": "revokeTrustAttestation",
    "inputs": [
      {
        "name": "subject",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "categoryId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeTrustSeed",
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
    "name": "seedLegacySelfCredential",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "sunsetAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "multiplierBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "trustBudgetBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "seedRoot",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "selfNullifierOwner",
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
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setClusterScore",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "clusterId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "discountBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "scorerEpoch",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setProfile",
    "inputs": [
      {
        "name": "raterType",
        "type": "uint8",
        "internalType": "enum RaterRegistry.RaterType"
      },
      {
        "name": "metadataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTrustAttestation",
    "inputs": [
      {
        "name": "subject",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "categoryId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "trustBudget",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "maxBoostBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "metadataHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "attestationId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTrustSeed",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "sunsetAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "trustBudgetBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "seedRoot",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "trustAttestationId",
    "inputs": [
      {
        "name": "issuer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "subject",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "categoryId",
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
    "name": "unfollowProfile",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "worldIdCredentialTtl",
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
    "name": "worldIdExternalNullifierHash",
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
    "name": "worldIdRouter",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IWorldIDRouter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "worldIdScope",
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
    "name": "worldIdSignalHash",
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
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "event",
    "name": "ClusterScoreChallengeOpened",
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
        "name": "scoreKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "rater",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "scorerEpoch",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "algorithmHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "modelVersionHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "openedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ClusterScoreChallengeResolved",
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
        "internalType": "enum RaterRegistry.ClusterScoreChallengeStatus"
      },
      {
        "name": "resolutionHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "resolvedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ClusterScoreUpdated",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "clusterId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "discountBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "scorerEpoch",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "updatedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProfileFollowed",
    "inputs": [
      {
        "name": "follower",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "target",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "followedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProfileUnfollowed",
    "inputs": [
      {
        "name": "follower",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "target",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "unfollowedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RaterProfileUpdated",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "raterType",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum RaterRegistry.RaterType"
      },
      {
        "name": "metadataHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "updatedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
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
    "name": "SelfCredentialAttested",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "nullifierHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "scope",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "legacy",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "verifiedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "multiplierBps",
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
    "name": "SelfCredentialRevoked",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "nullifierHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TrustAttestationRevoked",
    "inputs": [
      {
        "name": "attestationId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "subject",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TrustAttestationSet",
    "inputs": [
      {
        "name": "attestationId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "subject",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "categoryId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "trustBudget",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      },
      {
        "name": "maxBoostBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "metadataHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TrustSeedRevoked",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TrustSeedSet",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "seededAt",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "sunsetAt",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "trustBudgetBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "seedRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VersionedClusterScorePublished",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "scorerEpoch",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "modelVersionHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "clusterId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "discountBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "algorithmHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "scoreRoot",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "challengeWindowEndsAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "updatedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "scoreKey",
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
    "name": "InvalidClusterScore",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCredential",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidMultiplier",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTrustAttestation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NullifierAlreadyAssigned",
    "inputs": []
  }
] as const;
