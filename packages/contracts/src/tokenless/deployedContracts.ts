/**
 * Generated from rateloop-tokenless-deployment-v4.
 * Do not edit manually.
 */
export const tokenlessDeploymentSchema = "rateloop-tokenless-deployment-v4" as const;

export const tokenlessDeploymentStatus = {
  "schemaVersion": "rateloop-tokenless-deployment-v4",
  "status": "released",
  "chainId": 84532,
  "deploymentKey": "tokenless-v4:84532:0x0b2a1dbb8723583e5e0d4bfa9df0ed94a69b708b:0x09ea70d6de57fdfb5072f9e215f58e29976d7ee4:0xf4fa3259589f77a140c7fd82ffdf9e00a3e5402c:0xd6e6c750f5e465d2d43e6ae20d8b196f200b42e4"
} as const;

export const tokenlessDeployedContracts = {
  "84532": {
    "schemaVersion": "rateloop-tokenless-deployment-v4",
    "version": 4,
    "deploymentComplete": true,
    "deploymentProfile": "test",
    "networkName": "baseSepolia",
    "chainId": 84532,
    "deploymentBlockNumber": 44915850,
    "deploymentKey": "tokenless-v4:84532:0x0b2a1dbb8723583e5e0d4bfa9df0ed94a69b708b:0x09ea70d6de57fdfb5072f9e215f58e29976d7ee4:0xf4fa3259589f77a140c7fd82ffdf9e00a3e5402c:0xd6e6c750f5e465d2d43e6ae20d8b196f200b42e4",
    "feeRecipient": "0x508e98C391fFb0a11af2F23A311E8CB324f52A20",
    "beaconVerifier": "0xcc5c4FB3666241d18b8b0BE4dF058558bB9e11d4",
    "beaconVerifierArtifact": "QuicknetTBeaconVerifier",
    "beaconVerifierDeployedOnBlock": 44915850,
    "contracts": {
      "TestUSDC": {
        "address": "0x6c83966e8318e959401d3969518352be945ac3c5",
        "artifact": "MockERC20",
        "deployedOnBlock": 44915850,
        "runtimeCodeHash": "0x299ede3eb43a5b87660a0d35f93ffd9bf06d85e49b77229c54e3437c0b3c9673"
      },
      "CredentialIssuer": {
        "address": "0x09ea70d6de57fdfb5072f9e215f58e29976d7ee4",
        "artifact": "CredentialIssuer",
        "deployedOnBlock": 44915850,
        "runtimeCodeHash": "0x318fca6a907b6b0d8fbc6a3274d6dd61e0e6d256834730ce500b9dbfc5730c3f"
      },
      "TokenlessPanel": {
        "address": "0x0b2a1dbb8723583e5e0d4bfa9df0ed94a69b708b",
        "artifact": "TokenlessPanel",
        "deployedOnBlock": 44915850,
        "runtimeCodeHash": "0xfec11cfec452729cdc869000a4c92382cdff18d327d8dc9d824fb046b3aa5318"
      },
      "TokenlessFeedbackBonus": {
        "address": "0xd6e6c750f5e465d2d43e6ae20d8b196f200b42e4",
        "artifact": "TokenlessFeedbackBonus",
        "deployedOnBlock": 44915850,
        "runtimeCodeHash": "0x6a4a1362b0782ea7cbc54cba7b1a403fd9715be3aa91e2c8de3fca14649f5eee"
      },
      "X402PanelSubmitter": {
        "address": "0xf4fa3259589f77a140c7fd82ffdf9e00a3e5402c",
        "artifact": "X402PanelSubmitter",
        "deployedOnBlock": 44915851,
        "runtimeCodeHash": "0x2505fd98159fbfb2cb0971585b447df5cd6b4318e76fa549ccc5afd55208cc6d"
      }
    },
    "testCurrency": {
      "contract": "TestUSDC",
      "decimals": 6,
      "symbol": "tUSDC",
      "unrestrictedMint": true
    },
    "beaconVerifierRuntimeCodeHash": "0x7d12931d78e49216044b5809ab12df56cd5ae5332f7ee75d42c4d0bca4c6199a",
    "runtimeCodeEvidenceComplete": true
  }
} as const;
