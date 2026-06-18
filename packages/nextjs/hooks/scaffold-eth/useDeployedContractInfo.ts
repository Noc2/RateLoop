import { useEffect, useState } from "react";
import { useIsMounted } from "usehooks-ts";
import { usePublicClient } from "wagmi";
import { useSelectedNetwork } from "~~/hooks/scaffold-eth";
import {
  Contract,
  ContractCodeStatus,
  ContractName,
  UseDeployedContractConfig,
  contracts,
} from "~~/utils/scaffold-eth/contract";

const LOCAL_DEVELOPMENT_CHAIN_ID = 31337;

type DeployedContractData<TContractName extends ContractName> = {
  data: Contract<TContractName> | undefined;
  isLoading: boolean;
};

/**
 * Gets the matching contract info for the provided contract name from the generated deployedContracts.ts
 * corresponding to targetNetworks configured in scaffold.config.ts
 */
export function useDeployedContractInfo<TContractName extends ContractName>(
  config: UseDeployedContractConfig<TContractName>,
): DeployedContractData<TContractName>;

export function useDeployedContractInfo<TContractName extends ContractName>(
  config: UseDeployedContractConfig<TContractName>,
): DeployedContractData<TContractName> {
  const isMounted = useIsMounted();
  const { contractName, chainId } = config;
  const selectedNetwork = useSelectedNetwork(chainId);
  const deployedContract = contracts?.[selectedNetwork.id]?.[contractName as ContractName] as Contract<TContractName>;
  const [status, setStatus] = useState<ContractCodeStatus>(ContractCodeStatus.LOADING);
  const publicClient = usePublicClient({ chainId: selectedNetwork.id });
  const shouldVerifyContractCode = selectedNetwork.id === LOCAL_DEVELOPMENT_CHAIN_ID;

  useEffect(() => {
    const checkContractDeployment = async () => {
      try {
        if (!deployedContract) {
          setStatus(ContractCodeStatus.NOT_FOUND);
          return;
        }

        if (!shouldVerifyContractCode) {
          setStatus(ContractCodeStatus.DEPLOYED);
          return;
        }

        if (!isMounted() || !publicClient) return;

        setStatus(ContractCodeStatus.LOADING);
        const code = await publicClient.getBytecode({
          address: deployedContract.address,
        });

        // If contract code is `0x` => no contract deployed on that address
        if (code === "0x") {
          setStatus(ContractCodeStatus.NOT_FOUND);
          return;
        }
        setStatus(ContractCodeStatus.DEPLOYED);
      } catch (e) {
        console.error(e);
        setStatus(ContractCodeStatus.NOT_FOUND);
      }
    };

    checkContractDeployment();
  }, [isMounted, contractName, deployedContract, publicClient, shouldVerifyContractCode]);

  return {
    data: status === ContractCodeStatus.DEPLOYED ? deployedContract : undefined,
    isLoading: status === ContractCodeStatus.LOADING,
  };
}
