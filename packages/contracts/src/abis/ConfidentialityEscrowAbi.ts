export const ConfidentialityEscrowAbi = [
  {
    type: "function",
    name: "confidentialityConfig",
    inputs: [{ name: "contentId", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "config",
        type: "tuple",
        internalType: "struct IConfidentialityEscrow.ConfidentialityConfig",
        components: [
          { name: "gated", type: "bool", internalType: "bool" },
          { name: "bondAsset", type: "uint8", internalType: "uint8" },
          { name: "bondAmount", type: "uint64", internalType: "uint64" },
          { name: "flags", type: "uint8", internalType: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasActiveBond",
    inputs: [
      { name: "contentId", type: "uint256", internalType: "uint256" },
      { name: "identityKey", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "slashBond",
    inputs: [
      { name: "contentId", type: "uint256", internalType: "uint256" },
      { name: "identityKey", type: "bytes32", internalType: "bytes32" },
      { name: "reason", type: "string", internalType: "string" },
      { name: "evidenceHash", type: "bytes32", internalType: "bytes32" },
      { name: "reporterRecipient", type: "address", internalType: "address" },
    ],
    outputs: [
      { name: "reporterAmount", type: "uint256", internalType: "uint256" },
      { name: "confiscatedAmount", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "ConfidentialityConfigured",
    inputs: [
      { name: "contentId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "gated", type: "bool", indexed: false, internalType: "bool" },
      { name: "bondAsset", type: "uint8", indexed: true, internalType: "uint8" },
      { name: "bondAmount", type: "uint64", indexed: false, internalType: "uint64" },
      { name: "flags", type: "uint8", indexed: false, internalType: "uint8" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BondPosted",
    inputs: [
      { name: "contentId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "identityKey", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "poster", type: "address", indexed: true, internalType: "address" },
      { name: "asset", type: "uint8", indexed: false, internalType: "uint8" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BondReleased",
    inputs: [
      { name: "contentId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "identityKey", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "poster", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BondSlashed",
    inputs: [
      { name: "contentId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "identityKey", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "poster", type: "address", indexed: true, internalType: "address" },
      { name: "reporterRecipient", type: "address", indexed: false, internalType: "address" },
      { name: "reporterAmount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "confiscatedAmount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "evidenceHash", type: "bytes32", indexed: false, internalType: "bytes32" },
      { name: "reason", type: "string", indexed: false, internalType: "string" },
    ],
    anonymous: false,
  },
] as const;
