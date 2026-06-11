export const RaterRegistryConfidentialityAbi = [
  {
    type: "function",
    name: "banIdentity",
    inputs: [
      {
        name: "provider",
        type: "uint8",
        internalType: "enum RaterRegistry.HumanCredentialProvider",
      },
      { name: "nullifierHash", type: "bytes32", internalType: "bytes32" },
      { name: "expiresAt", type: "uint64", internalType: "uint64" },
      { name: "reason", type: "string", internalType: "string" },
      { name: "evidenceHash", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "identityBan",
    inputs: [{ name: "identityKey", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "bannedAt", type: "uint64", internalType: "uint64" },
      { name: "expiresAt", type: "uint64", internalType: "uint64" },
      { name: "evidenceHash", type: "bytes32", internalType: "bytes32" },
      { name: "permanent", type: "bool", internalType: "bool" },
      { name: "active", type: "bool", internalType: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isIdentityKeyBanned",
    inputs: [{ name: "identityKey", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "unbanIdentity",
    inputs: [
      {
        name: "provider",
        type: "uint8",
        internalType: "enum RaterRegistry.HumanCredentialProvider",
      },
      { name: "nullifierHash", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "ConfidentialityEscrowUpdated",
    inputs: [
      { name: "previousEscrow", type: "address", indexed: true, internalType: "address" },
      { name: "newEscrow", type: "address", indexed: true, internalType: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "IdentityBanned",
    inputs: [
      {
        name: "provider",
        type: "uint8",
        indexed: true,
        internalType: "enum RaterRegistry.HumanCredentialProvider",
      },
      { name: "nullifierHash", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "expiresAt", type: "uint64", indexed: false, internalType: "uint64" },
      { name: "permanent", type: "bool", indexed: false, internalType: "bool" },
      { name: "evidenceHash", type: "bytes32", indexed: false, internalType: "bytes32" },
      { name: "reason", type: "string", indexed: false, internalType: "string" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "IdentityUnbanned",
    inputs: [
      {
        name: "provider",
        type: "uint8",
        indexed: true,
        internalType: "enum RaterRegistry.HumanCredentialProvider",
      },
      { name: "nullifierHash", type: "bytes32", indexed: true, internalType: "bytes32" },
    ],
    anonymous: false,
  },
] as const;
