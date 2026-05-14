"use client";

import { useEffect, useState } from "react";
import deployedContracts from "@rateloop/contracts/deployedContracts";
import { Address, AddressInput, Balance, EtherInput } from "@scaffold-ui/components";
import { useQueryClient } from "@tanstack/react-query";
import { Address as AddressType, createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { hardhat } from "viem/chains";
import { useAccount } from "wagmi";
import { GiftIcon } from "@heroicons/react/24/outline";
import { useTransactor } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

// Account index to use from generated hardhat accounts.
const FAUCET_ACCOUNT_INDEX = 0;

// LREP token has 6 decimals
const HREP_DECIMALS = 6;
const USDC_DECIMALS = 6;

const localWalletClient = createWalletClient({
  chain: hardhat,
  transport: http(),
});

const localPublicClient = createPublicClient({
  chain: hardhat,
  transport: http(),
});

// Minimal ABI for local mintable ERC20 token functions we need
const localMintableTokenAbi = [
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const questionRewardPoolEscrowAbi = [
  {
    type: "function",
    name: "usdcToken",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

/**
 * Shared ID used by faucet triggers and the single app-level modal.
 */
const FAUCET_MODAL_ID = "faucet-modal";

type FaucetTriggerProps = {
  className?: string;
  textClassName?: string;
};

export const FaucetTrigger = ({
  className = "flex items-center justify-center xl:justify-start gap-3 xl:px-4 py-3 rounded-xl transition-colors text-base-content/60 hover:text-base-content hover:bg-base-200 w-full cursor-pointer",
  textClassName = "hidden xl:inline",
}: FaucetTriggerProps) => {
  const { chain: connectedChain } = useAccount();

  if (connectedChain?.id !== hardhat.id) {
    return null;
  }

  return (
    <label htmlFor={FAUCET_MODAL_ID} className={className}>
      <GiftIcon className="w-6 h-6 shrink-0" />
      <span className={textClassName}>Faucet</span>
    </label>
  );
};

/**
 * Faucet modal which lets you send ETH and claim LREP tokens on local testnet.
 */
export const FaucetModal = () => {
  const [loading, setLoading] = useState(false);
  const [hrepLoading, setHrepLoading] = useState(false);
  const [usdcLoading, setUsdcLoading] = useState(false);
  const [inputAddress, setInputAddress] = useState<AddressType>();
  const [faucetAddress, setFaucetAddress] = useState<AddressType>();
  const [sendValue, setSendValue] = useState("");
  const [hrepAmount, setHrepAmount] = useState("1000");
  const [usdcAmount, setUsdcAmount] = useState("1000");
  const [mockUsdcTokenAddress, setMockUsdcTokenAddress] = useState<AddressType>();
  const { chain: ConnectedChain, address: connectedAddress } = useAccount();

  const isHardhat = ConnectedChain?.id === hardhat.id;

  const faucetTxn = useTransactor(localWalletClient);
  const queryClient = useQueryClient();

  // Get contract addresses from localhost deployment
  const hrepTokenAddress = (deployedContracts as any)[31337]?.LoopReputation?.address as AddressType | undefined;
  const directMockUsdcTokenAddress = (deployedContracts as any)[31337]?.MockERC20?.address as AddressType | undefined;
  const questionRewardPoolEscrowAddress = (deployedContracts as any)[31337]?.QuestionRewardPoolEscrow?.address as
    | AddressType
    | undefined;

  useEffect(() => {
    if (!isHardhat) return;
    const getFaucetAddress = async () => {
      try {
        const accounts = await localWalletClient.getAddresses();
        setFaucetAddress(accounts[FAUCET_ACCOUNT_INDEX]);
      } catch {
        notification.error(
          <>
            <p className="font-bold mt-0 mb-1">Cannot connect to local provider</p>
            <p className="m-0">
              - Did you forget to run <code className="italic bg-base-300 text-base font-bold">yarn chain</code> ?
            </p>
            <p className="mt-1 break-normal">
              - Or you can change <code className="italic bg-base-300 text-base font-bold">targetNetwork</code> in{" "}
              <code className="italic bg-base-300 text-base font-bold">scaffold.config.ts</code>
            </p>
          </>,
        );
      }
    };
    getFaucetAddress();
  }, [isHardhat]);

  useEffect(() => {
    if (!isHardhat) {
      setMockUsdcTokenAddress(undefined);
      return;
    }

    if (directMockUsdcTokenAddress) {
      setMockUsdcTokenAddress(directMockUsdcTokenAddress);
      return;
    }

    if (!questionRewardPoolEscrowAddress) {
      setMockUsdcTokenAddress(undefined);
      return;
    }

    let active = true;
    const resolveMockUsdcAddress = async () => {
      try {
        const address = await localPublicClient.readContract({
          address: questionRewardPoolEscrowAddress,
          abi: questionRewardPoolEscrowAbi,
          functionName: "usdcToken",
        });
        if (active) {
          setMockUsdcTokenAddress(address as AddressType);
        }
      } catch {
        if (active) {
          setMockUsdcTokenAddress(undefined);
        }
      }
    };

    void resolveMockUsdcAddress();

    return () => {
      active = false;
    };
  }, [directMockUsdcTokenAddress, isHardhat, questionRewardPoolEscrowAddress]);

  // Set input address to connected address by default
  useEffect(() => {
    if (connectedAddress && !inputAddress) {
      setInputAddress(connectedAddress);
    }
  }, [connectedAddress, inputAddress]);

  const sendETH = async () => {
    if (!faucetAddress || !inputAddress) {
      return;
    }
    try {
      setLoading(true);
      await faucetTxn({
        to: inputAddress,
        value: parseUnits(sendValue as `${number}`, 18),
        account: faucetAddress,
      });
      setLoading(false);
      setSendValue("");
    } catch {
      setLoading(false);
    }
  };

  const claimHREP = async () => {
    if (!inputAddress || !hrepTokenAddress) {
      notification.error("Missing destination address or LoopReputation contract");
      return;
    }

    try {
      setHrepLoading(true);
      const amount = parseUnits(hrepAmount, HREP_DECIMALS);

      if (faucetAddress) {
        const txHash = await localWalletClient.writeContract({
          address: hrepTokenAddress,
          abi: localMintableTokenAbi,
          functionName: "transfer",
          args: [inputAddress, amount],
          account: faucetAddress,
        });
        await localPublicClient.waitForTransactionReceipt({ hash: txHash });
      } else {
        notification.error("Missing faucet address");
        setHrepLoading(false);
        return;
      }

      queryClient.invalidateQueries();
      notification.success(`Sent ${hrepAmount} LREP to ${inputAddress.slice(0, 6)}...${inputAddress.slice(-4)}`);
      setHrepLoading(false);
    } catch (error: any) {
      notification.error(error?.message || "Failed to claim LREP tokens");
      setHrepLoading(false);
    }
  };

  const claimUSDC = async () => {
    if (!inputAddress || !mockUsdcTokenAddress) {
      notification.error("Missing destination address or mock USDC contract");
      return;
    }
    if (!faucetAddress) {
      notification.error("Missing faucet address");
      return;
    }

    try {
      setUsdcLoading(true);
      const amount = parseUnits(usdcAmount, USDC_DECIMALS);

      const txHash = await localWalletClient.writeContract({
        address: mockUsdcTokenAddress,
        abi: localMintableTokenAbi,
        functionName: "mint",
        args: [inputAddress, amount],
        account: faucetAddress,
      });
      await localPublicClient.waitForTransactionReceipt({ hash: txHash });

      queryClient.invalidateQueries();
      notification.success(`Sent ${usdcAmount} mock USDC to ${inputAddress.slice(0, 6)}...${inputAddress.slice(-4)}`);
      setUsdcLoading(false);
    } catch (error: any) {
      notification.error(error?.message || "Failed to claim mock USDC");
      setUsdcLoading(false);
    }
  };

  // Only render on localhost (hardhat)
  if (!isHardhat) {
    return null;
  }

  return (
    <div>
      <input type="checkbox" id={FAUCET_MODAL_ID} className="modal-toggle" />
      <label htmlFor={FAUCET_MODAL_ID} className="modal cursor-pointer">
        <label className="modal-box relative">
          {/* dummy input to capture event onclick on modal box */}
          <input className="h-0 w-0 absolute top-0 left-0" />
          <h3 className="text-xl font-bold mb-3">Local Testnet Faucet</h3>
          <label htmlFor={FAUCET_MODAL_ID} className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3">
            ✕
          </label>
          <div className="space-y-4">
            {/* Destination Address */}
            <div>
              <span className="text-base font-bold">Destination Address:</span>
              <AddressInput
                placeholder="Destination Address"
                value={inputAddress ?? ""}
                onChange={value => setInputAddress(value as AddressType)}
              />
            </div>

            {/* Faucet Info + ETH Section (hardhat only) */}
            {isHardhat && (
              <>
                <div className="flex space-x-4">
                  <div>
                    <span className="text-base font-bold">From:</span>
                    <Address address={faucetAddress} onlyEnsOrAddress />
                  </div>
                  <div>
                    <span className="text-base font-bold pl-3">ETH Available:</span>
                    <Balance address={faucetAddress} />
                  </div>
                </div>

                <div className="bg-base-200 rounded-xl p-4 space-y-3">
                  <h4 className="font-semibold">Send ETH</h4>
                  <EtherInput
                    placeholder="Amount to send"
                    onValueChange={({ valueInEth }) => setSendValue(valueInEth)}
                    style={{ width: "100%" }}
                  />
                  <button
                    className="h-10 btn btn-outline btn-sm px-4 rounded-full w-full"
                    onClick={sendETH}
                    disabled={loading || !sendValue}
                  >
                    {!loading ? (
                      <GiftIcon className="h-5 w-5" />
                    ) : (
                      <span className="loading loading-spinner loading-sm"></span>
                    )}
                    <span>Send ETH</span>
                  </button>
                </div>
              </>
            )}

            {/* LREP Faucet Section */}
            <div className="bg-primary/10 rounded-xl p-4 space-y-3">
              <h4 className="font-semibold text-primary">Claim LREP Tokens</h4>
              <p className="text-base text-base-content/60">Mint LREP tokens directly to your wallet for testing.</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  className="input input-bordered input-sm flex-1"
                  placeholder="Amount"
                  value={hrepAmount}
                  onChange={e => setHrepAmount(e.target.value)}
                  min="1"
                />
                <span className="self-center text-base font-medium">LREP</span>
              </div>
              <button
                className="h-10 btn btn-primary btn-sm px-4 rounded-full w-full"
                onClick={claimHREP}
                disabled={hrepLoading || !hrepAmount || !inputAddress}
              >
                {!hrepLoading ? (
                  <GiftIcon className="h-5 w-5" />
                ) : (
                  <span className="loading loading-spinner loading-sm"></span>
                )}
                <span>Claim LREP</span>
              </button>
            </div>

            {/* Mock USDC Faucet Section */}
            <div className="bg-accent/10 rounded-xl p-4 space-y-3">
              <h4 className="font-semibold text-primary">Claim Mock USDC</h4>
              <p className="text-base text-base-content/60">Fund local bounties without using real USDC.</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  className="input input-bordered input-sm flex-1"
                  placeholder="Amount"
                  value={usdcAmount}
                  onChange={e => setUsdcAmount(e.target.value)}
                  min="1"
                />
                <span className="self-center text-base font-medium">USDC</span>
              </div>
              <button
                className="h-10 btn btn-primary btn-sm px-4 rounded-full w-full"
                onClick={claimUSDC}
                disabled={usdcLoading || !usdcAmount || !inputAddress || !mockUsdcTokenAddress}
              >
                {!usdcLoading ? (
                  <GiftIcon className="h-5 w-5" />
                ) : (
                  <span className="loading loading-spinner loading-sm"></span>
                )}
                <span>Claim Mock USDC</span>
              </button>
            </div>
          </div>
        </label>
      </label>
    </div>
  );
};
