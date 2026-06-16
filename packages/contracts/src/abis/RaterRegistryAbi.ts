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
        "name": "_worldIdV4Verifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_worldIdV4RpId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4Action",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_worldIdV4PresenceAction",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_worldIdV4CredentialTtl",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4PresenceTtl",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4IssuerSchemaId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4CredentialGenesisIssuedAtMin",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "DELEGATE_AUTHORIZATION_TYPEHASH",
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
    "name": "DOMAIN_SEPARATOR",
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
    "name": "GOVERNANCE_ROLE",
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
    "name": "LAUNCH_CONSUMER_ROLE",
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
    "name": "SEEDED_HUMAN_SCOPE",
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
    "name": "WORLD_CREDENTIAL_PASSPORT",
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
    "name": "WORLD_CREDENTIAL_PROOF_OF_HUMAN",
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
    "name": "WORLD_CREDENTIAL_SELFIE",
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
    "name": "acceptDelegate",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptDelegateWithSig",
    "inputs": [
      {
        "name": "holder",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "deadline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "addressIdentityKey",
    "inputs": [
      {
        "name": "account",
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
    "name": "attestHumanCredentialWithProof",
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
    "name": "attestHumanCredentialWithV4Proof",
    "inputs": [
      {
        "name": "nullifier",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiresAtMin",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "proof",
        "type": "uint256[5]",
        "internalType": "uint256[5]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "attestHumanPresenceWithV4Proof",
    "inputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "",
        "type": "uint256[5]",
        "internalType": "uint256[5]"
      }
    ],
    "outputs": [],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "attestWorldCredentialWithV4Proof",
    "inputs": [
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "nullifier",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiresAtMin",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "proof",
        "type": "uint256[5]",
        "internalType": "uint256[5]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "banIdentity",
    "inputs": [
      {
        "name": "provider",
        "type": "uint8",
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      },
      {
        "name": "nullifierHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "reason",
        "type": "string",
        "internalType": "string"
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
    "name": "banKnownCredentialNullifier",
    "inputs": [
      {
        "name": "provider",
        "type": "uint8",
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      },
      {
        "name": "nullifierHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "reason",
        "type": "string",
        "internalType": "string"
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
    "name": "clearRevokedHumanNullifier",
    "inputs": [
      {
        "name": "provider",
        "type": "uint8",
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      },
      {
        "name": "nullifierHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confidentialityEscrow",
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
    "name": "credentialIdentityKey",
    "inputs": [
      {
        "name": "provider",
        "type": "uint8",
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      },
      {
        "name": "nullifierHash",
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
    "name": "credentialStatusBits",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "activeMask",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "freshMask",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "delegateAuthorizationDigest",
    "inputs": [
      {
        "name": "holder",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "delegate",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
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
    "name": "delegateAuthorizationNonces",
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
    "name": "delegateOf",
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
    "name": "delegateTo",
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
    "name": "freezeWorldCredentialV4Config",
    "inputs": [
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "freezeWorldIdV4PresenceConfig",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "freezeWorldIdV4VerifierConfig",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "freezeWorldIdVerifierConfig",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "freezeWorldPresenceV4Config",
    "inputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getHumanCredential",
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
        "internalType": "struct RaterRegistry.HumanCredential",
        "components": [
          {
            "name": "verified",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "revoked",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "provider",
            "type": "uint8",
            "internalType": "enum RaterRegistry.HumanCredentialProvider"
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
    "name": "getHumanPresence",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "presence",
        "type": "tuple",
        "internalType": "struct RaterRegistry.HumanPresence",
        "components": [
          {
            "name": "verified",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "lastRecheckedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "freshUntil",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "pure"
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
    "name": "getWorldCredential",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RaterRegistry.WorldCredential",
        "components": [
          {
            "name": "verified",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "revoked",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "uint8"
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
    "name": "hasActiveCredentialKind",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "kind",
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
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasActiveHumanCredential",
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
    "name": "hasRecentCredentialRecheck",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
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
    "name": "initialize",
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
        "name": "_worldIdV4Verifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_worldIdV4RpId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4Action",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_worldIdV4PresenceAction",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_worldIdV4CredentialTtl",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4PresenceTtl",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4IssuerSchemaId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4CredentialGenesisIssuedAtMin",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "initializeWithWorldIdV3",
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
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "isIdentityKeyBanned",
    "inputs": [
      {
        "name": "identityKey",
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
    "name": "launchHumanIdentityKey",
    "inputs": [
      {
        "name": "provider",
        "type": "uint8",
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      },
      {
        "name": "nullifierHash",
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
    "name": "legacyWorldIdAttestationDisabled",
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
    "name": "maxSeededCredentialTtl",
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
    "name": "pendingDelegateOf",
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
    "name": "pendingDelegateTo",
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
    "name": "removeDelegate",
    "inputs": [],
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
    "name": "resolveRater",
    "inputs": [
      {
        "name": "actor",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "resolved",
        "type": "tuple",
        "internalType": "struct IRaterIdentityRegistry.ResolvedRater",
        "components": [
          {
            "name": "holder",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "identityKey",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "humanNullifier",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "hasActiveHumanCredential",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "delegated",
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
    "name": "revokeHumanCredential",
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
    "name": "revokeWorldCredential",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "rotateCanonicalIdentityKey",
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
    "name": "seedHumanCredential",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "anchorId",
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
    "name": "setConfidentialityEscrow",
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
    "name": "setDelegate",
    "inputs": [
      {
        "name": "delegate",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setLegacyWorldIdAttestationDisabled",
    "inputs": [
      {
        "name": "disabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setMaxSeededCredentialTtl",
    "inputs": [
      {
        "name": "cap",
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
    "name": "setWorldCredentialV4Config",
    "inputs": [
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "verifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "rpId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "action",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "credentialTtl",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "issuerSchemaId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "credentialGenesisIssuedAtMin",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "enabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setWorldIdV4PresenceConfig",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setWorldIdV4VerifierConfig",
    "inputs": [
      {
        "name": "_worldIdV4Verifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_worldIdV4RpId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4Action",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "_worldIdV4CredentialTtl",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4IssuerSchemaId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "_worldIdV4CredentialGenesisIssuedAtMin",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setWorldIdVerifierConfig",
    "inputs": [
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
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setWorldPresenceV4Config",
    "inputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "view"
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
    "name": "unbanIdentity",
    "inputs": [
      {
        "name": "provider",
        "type": "uint8",
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      },
      {
        "name": "nullifierHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
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
    "name": "worldCredentialV4Config",
    "inputs": [
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "verifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "rpId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "action",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "ttl",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "issuerSchemaId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "credentialGenesisIssuedAtMin",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "enabled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "frozen",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
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
    "type": "function",
    "name": "worldIdV4Action",
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
    "name": "worldIdV4CredentialGenesisIssuedAtMin",
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
    "name": "worldIdV4CredentialTtl",
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
    "name": "worldIdV4IssuerSchemaId",
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
    "name": "worldIdV4PresenceAction",
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
    "name": "worldIdV4PresenceConfigFrozen",
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
    "name": "worldIdV4PresenceTtl",
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
    "name": "worldIdV4RpId",
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
    "name": "worldIdV4Verifier",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IWorldIDVerifier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "worldIdV4VerifierConfigFrozen",
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
    "name": "worldIdVerifierConfigFrozen",
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
    "name": "worldPresenceV4Config",
    "inputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "verifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "rpId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "action",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "ttl",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "issuerSchemaId",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "credentialGenesisIssuedAtMin",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "enabled",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "frozen",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "event",
    "name": "CanonicalHumanIdentityKeyCleared",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "previousKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CanonicalHumanIdentityKeyRotated",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "previousKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "newKey",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "provider",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DelegateRemoved",
    "inputs": [
      {
        "name": "holder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "previousDelegate",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DelegateRequested",
    "inputs": [
      {
        "name": "holder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "delegate",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DelegateSet",
    "inputs": [
      {
        "name": "holder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "delegate",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HumanCredentialRevoked",
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
        "name": "provider",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HumanCredentialVerified",
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
        "name": "provider",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
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
    "name": "HumanNullifierRevocationCleared",
    "inputs": [
      {
        "name": "nullifierHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "provider",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      },
      {
        "name": "prevOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HumanPresenceVerified",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "nullifierHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "lastRecheckedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "freshUntil",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
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
    "name": "IdentityBanned",
    "inputs": [
      {
        "name": "provider",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
      },
      {
        "name": "nullifierHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "permanent",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "reason",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "IdentityUnbanned",
    "inputs": [
      {
        "name": "provider",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum RaterRegistry.HumanCredentialProvider"
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
    "name": "LegacyWorldIdAttestationDisabledSet",
    "inputs": [
      {
        "name": "disabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MaxSeededCredentialTtlUpdated",
    "inputs": [
      {
        "name": "previousCap",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "newCap",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PendingDelegateRemoved",
    "inputs": [
      {
        "name": "holder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "previousPendingDelegate",
        "type": "address",
        "indexed": true,
        "internalType": "address"
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
    "name": "WorldCredentialRevoked",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
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
    "name": "WorldCredentialV4ConfigLocked",
    "inputs": [
      {
        "name": "kind",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorldCredentialV4ConfigUpdated",
    "inputs": [
      {
        "name": "kind",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "verifier",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "rpId",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "action",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "credentialTtl",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "issuerSchemaId",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "credentialGenesisIssuedAtMin",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorldCredentialVerified",
    "inputs": [
      {
        "name": "rater",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
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
        "indexed": false,
        "internalType": "bytes32"
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
    "name": "WorldIdV4VerifierConfigLocked",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorldIdV4VerifierConfigUpdated",
    "inputs": [
      {
        "name": "verifier",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "rpId",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "action",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "credentialTtl",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "issuerSchemaId",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "credentialGenesisIssuedAtMin",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorldIdVerifierConfigLocked",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorldIdVerifierConfigUpdated",
    "inputs": [
      {
        "name": "router",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "scope",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "externalNullifierHash",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "credentialTtl",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorldPresenceV4ConfigLocked",
    "inputs": [
      {
        "name": "kind",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorldPresenceV4ConfigUpdated",
    "inputs": [
      {
        "name": "kind",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8"
      },
      {
        "name": "verifier",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "rpId",
        "type": "uint64",
        "indexed": true,
        "internalType": "uint64"
      },
      {
        "name": "action",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "presenceTtl",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "issuerSchemaId",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "credentialGenesisIssuedAtMin",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
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
    "name": "ActiveHumanCredentialRequiresHumanProfile",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CallerIsDelegate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CannotDelegateSelf",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DelegateAlreadyAssigned",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DelegateIsHolder",
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
    "name": "InvalidAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBan",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidCredential",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidInitialization",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LegacyWorldIdAttestationDisabled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoDelegateSet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPendingDelegate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotInitializing",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NullifierAlreadyAssigned",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SignatureExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnsupportedCredentialKind",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WorldCredentialConfigFrozen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WorldIdV4PresenceConfigFrozen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WorldIdV4VerifierConfigFrozen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WorldIdV4VerifierNotConfigured",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WorldIdVerifierConfigFrozen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WorldPresenceConfigFrozen",
    "inputs": []
  }
] as const;
