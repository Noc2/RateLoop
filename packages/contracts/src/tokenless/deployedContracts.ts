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
    "deploymentBlockNumber": 44052097,
    "deploymentKey": "tokenless-v1:84532:0x124dd129f09f6aa1572f6469c5dcce3fc72f7b01:0xd98cbadad4bb2d9211ac8520b2bfada1b98f00c4:0xd48b308431bba56badc4f9e52acf7c0fdbfbdd10",
    "contracts": {
      "TestUSDC": {
        "address": "0xb386d726fe16e44d9d0b24a933af96d14fdc95d2",
        "artifact": "MockERC20",
        "deployedOnBlock": 44052094
      },
      "CredentialIssuer": {
        "address": "0xd98cbadad4bb2d9211ac8520b2bfada1b98f00c4",
        "artifact": "CredentialIssuer",
        "deployedOnBlock": 44052095
      },
      "TokenlessPanel": {
        "address": "0x124dd129f09f6aa1572f6469c5dcce3fc72f7b01",
        "artifact": "TokenlessPanel",
        "deployedOnBlock": 44052096
      },
      "X402PanelSubmitter": {
        "address": "0xd48b308431bba56badc4f9e52acf7c0fdbfbdd10",
        "artifact": "X402PanelSubmitter",
        "deployedOnBlock": 44052097
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
