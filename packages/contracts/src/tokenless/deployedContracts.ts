/**
 * Generated from rateloop-tokenless-deployment-v4.
 * Do not edit manually.
 */
export const tokenlessDeploymentSchema = "rateloop-tokenless-deployment-v4" as const;

export const tokenlessDeploymentStatus = {
  "schemaVersion": "rateloop-tokenless-deployment-v4",
  "status": "released",
  "chainId": 84532,
  "deploymentKey": "tokenless-v4:84532:0xedf08f770135db33cec87f00e415c2ae39a3a885:0x7a1b58f9338886169ab3ec53bf042458bc0897c4:0xceddb0b2e34d3d332f347fe76fc5efcb9df5ae03:0xee5785e51d7e8a4438dc029a3c642bac2d558bc4"
} as const;

export const tokenlessDeployedContracts = {
  "84532": {
    "schemaVersion": "rateloop-tokenless-deployment-v4",
    "version": 4,
    "deploymentComplete": true,
    "deploymentProfile": "test",
    "networkName": "baseSepolia",
    "chainId": 84532,
    "deploymentBlockNumber": 45115708,
    "deploymentKey": "tokenless-v4:84532:0xedf08f770135db33cec87f00e415c2ae39a3a885:0x7a1b58f9338886169ab3ec53bf042458bc0897c4:0xceddb0b2e34d3d332f347fe76fc5efcb9df5ae03:0xee5785e51d7e8a4438dc029a3c642bac2d558bc4",
    "feeRecipient": "0x508e98C391fFb0a11af2F23A311E8CB324f52A20",
    "beaconVerifier": "0xb10b3Dd440A0aE22152de0cF8b73ED02EEbB5Af9",
    "beaconVerifierArtifact": "QuicknetTBeaconVerifier",
    "beaconVerifierDeployedOnBlock": 45115708,
    "beaconVerifierCreationCodeHash": "0x96ece33510f0da107f959485a6ae234ba289ad2f4d45c7b5ce8a8f1a2abed2b0",
    "beaconVerifierDeploymentInputHash": "0x96ece33510f0da107f959485a6ae234ba289ad2f4d45c7b5ce8a8f1a2abed2b0",
    "contracts": {
      "TestUSDC": {
        "address": "0x264e49ff51c763eb1226136de585bd8f10d7a90f",
        "artifact": "MockERC20",
        "deployedOnBlock": 45115708,
        "creationCodeHash": "0xd680a2c322c712a7f0f5d33d09d20654e2809e0d5ef17a6c3d297f9175dd11e9",
        "deploymentInputHash": "0x252a4d47526943b40e66cd9037cffdf7bf67fb08b40bc2aeed35c18336a527b2",
        "runtimeCodeHash": "0xcf268e8ba06b76dcf577ee241f319d903ad1c2f030dd566bfd564208340d8f87"
      },
      "CredentialIssuer": {
        "address": "0x7a1b58f9338886169ab3ec53bf042458bc0897c4",
        "artifact": "CredentialIssuer",
        "deployedOnBlock": 45115708,
        "creationCodeHash": "0x66e835d3988eae54d56b9bb825beed360d3ba95418a700d23b61e37664059d8c",
        "deploymentInputHash": "0xb9446af8e7f92fd3d7cf37fe257c285365808f57635dda6d17df38d4d4da780a",
        "runtimeCodeHash": "0x4e2dd52b98aac1de809f3875233e4e298155028341a2283effd0499aacd8f100"
      },
      "TokenlessPanel": {
        "address": "0xedf08f770135db33cec87f00e415c2ae39a3a885",
        "artifact": "TokenlessPanel",
        "deployedOnBlock": 45115708,
        "creationCodeHash": "0x53e58f49879beb9f07fcc3ca7ae92032e319f80db5fbbb35bf08962539934410",
        "deploymentInputHash": "0x3bf9cf8a718baf60508dab28ad58b664085f3ae480d6ade11799b3a8a53b18e8",
        "runtimeCodeHash": "0x77566da7ebf888a161920789aefee8c8bbe370706c42ca77c30ab21a9cb62a8b"
      },
      "TokenlessFeedbackBonus": {
        "address": "0xee5785e51d7e8a4438dc029a3c642bac2d558bc4",
        "artifact": "TokenlessFeedbackBonus",
        "deployedOnBlock": 45115708,
        "creationCodeHash": "0x070b5e1792c54c44e7e95ab65cf4b20f97c98a6ccd961ddac60078f71546268f",
        "deploymentInputHash": "0xc658c666ec61284b30682cd90689ba99b7f316359741b238f1072b60335e99e4",
        "runtimeCodeHash": "0x6e134399b5a11d0c3ae9e6e522b58844ce9ae57c3c1b615ff3985dba2d48fbc1"
      },
      "X402PanelSubmitter": {
        "address": "0xceddb0b2e34d3d332f347fe76fc5efcb9df5ae03",
        "artifact": "X402PanelSubmitter",
        "deployedOnBlock": 45115708,
        "creationCodeHash": "0x745a216af2af446937384d7db5bb81f3b34e6823d6eaed248faf0e280a5ff691",
        "deploymentInputHash": "0x43ce7686373cb35cbe41a2a427f32e966e2933c09ad0258ecaf4d8dec63c551b",
        "runtimeCodeHash": "0x82f2ae6c135c714d1a3a44c86dc6be599d632832899fda177b1e6c5eecb1d440"
      }
    },
    "testCurrency": {
      "contract": "TestUSDC",
      "decimals": 6,
      "symbol": "tUSDC",
      "unrestrictedMint": true
    },
    "beaconVerifierRuntimeCodeHash": "0x7d12931d78e49216044b5809ab12df56cd5ae5332f7ee75d42c4d0bca4c6199a",
    "runtimeCodeEvidenceComplete": true,
    "codeEvidenceHash": "0x9677bf4e40653c60fd12a49b1956bf610cff195128ba19f7b113718903668904"
  }
} as const;
