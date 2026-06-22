import { getUsdcEip712DomainName } from "@rateloop/contracts/protocol";
import { type Address, type Hex, parseSignature } from "viem";

const WALLET_SIGNATURE_VALIDITY_SECONDS = 30 * 60;

type Eip3009SignatureParts = {
  r: Hex;
  s: Hex;
  v: number;
};

export function getSignatureParts(signature: Hex): Eip3009SignatureParts {
  if (signature.length !== 132) {
    throw new Error("Expected a 65-byte signature.");
  }
  const parsed = parseSignature(signature);
  return {
    r: parsed.r,
    s: parsed.s,
    v: Number(parsed.v ?? BigInt(parsed.yParity + 27)),
  };
}

export function getDefaultSignatureDeadline(nowSeconds = Math.floor(Date.now() / 1000)) {
  return BigInt(nowSeconds + WALLET_SIGNATURE_VALIDITY_SECONDS);
}

export function buildLrepPermitTypedData(params: {
  chainId: number;
  deadline: bigint;
  nonce: bigint;
  owner: Address;
  spender: Address;
  tokenAddress: Address;
  value: bigint;
}) {
  return {
    domain: {
      chainId: params.chainId,
      name: "Loop Reputation",
      verifyingContract: params.tokenAddress,
      version: "1",
    },
    message: {
      deadline: params.deadline,
      nonce: params.nonce,
      owner: params.owner,
      spender: params.spender,
      value: params.value,
    },
    primaryType: "Permit",
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
  } as const;
}

export function buildRaterDelegateAuthorizationTypedData(params: {
  chainId: number;
  deadline: bigint;
  delegate: Address;
  holder: Address;
  nonce: bigint;
  registryAddress: Address;
}) {
  return {
    domain: {
      chainId: params.chainId,
      name: "RateLoop RaterRegistry",
      verifyingContract: params.registryAddress,
      version: "1",
    },
    message: {
      deadline: params.deadline,
      delegate: params.delegate,
      holder: params.holder,
      nonce: params.nonce,
    },
    primaryType: "DelegateAuthorization",
    types: {
      DelegateAuthorization: [
        { name: "holder", type: "address" },
        { name: "delegate", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
  } as const;
}

export function buildUsdcReceiveWithAuthorizationTypedData(params: {
  authorization: {
    from: Address;
    nonce: Hex;
    to: Address;
    validAfter: bigint;
    validBefore: bigint;
    value: bigint;
  };
  chainId: number;
  tokenAddress: Address;
}) {
  return {
    domain: {
      chainId: params.chainId,
      name: getUsdcEip712DomainName(params.chainId),
      verifyingContract: params.tokenAddress,
      version: "2",
    },
    message: {
      from: params.authorization.from,
      nonce: params.authorization.nonce,
      to: params.authorization.to,
      validAfter: params.authorization.validAfter,
      validBefore: params.authorization.validBefore,
      value: params.authorization.value,
    },
    primaryType: "ReceiveWithAuthorization",
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
  } as const;
}
