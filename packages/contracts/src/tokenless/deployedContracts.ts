/**
 * Generated from rateloop-tokenless-deployment-v1.
 * Do not edit manually.
 */
export const tokenlessDeploymentSchema = "rateloop-tokenless-deployment-v1" as const;

export const tokenlessDeployedContracts = {
  "84532": {
    "schemaVersion": "rateloop-tokenless-deployment-v1",
    "version": 1,
    "deploymentComplete": true,
    "deploymentProfile": "test",
    "networkName": "baseSepolia",
    "chainId": 84532,
    "deploymentBlockNumber": 44053599,
    "deploymentKey": "tokenless-v1:84532:0x0627e4f7f746e84edbd3ec066a58a7fdc3227e16:0xb046277842f11a0c371d860504694fd79a5afb40:0x442581f4732b0f18ed47bcfa46415a65e13f8a5e",
    "contracts": {
      "TestUSDC": {
        "address": "0x2fb6b468d9fcf89446cdadaa61e230419f76a838",
        "artifact": "MockERC20",
        "deployedOnBlock": 44053599
      },
      "CredentialIssuer": {
        "address": "0xb046277842f11a0c371d860504694fd79a5afb40",
        "artifact": "CredentialIssuer",
        "deployedOnBlock": 44053599
      },
      "TokenlessPanel": {
        "address": "0x0627e4f7f746e84edbd3ec066a58a7fdc3227e16",
        "artifact": "TokenlessPanel",
        "deployedOnBlock": 44053599
      },
      "X402PanelSubmitter": {
        "address": "0x442581f4732b0f18ed47bcfa46415a65e13f8a5e",
        "artifact": "X402PanelSubmitter",
        "deployedOnBlock": 44053599
      }
    },
    "testCurrency": {
      "contract": "TestUSDC",
      "decimals": 6,
      "symbol": "tUSDC",
      "unrestrictedMint": true
    }
  }
} as const;
