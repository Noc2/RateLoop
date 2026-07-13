/**
 * The active registry is intentionally empty until a complete v2 bundle is freshly deployed.
 * The v1 entry remains exported only as explicit historical evidence.
 */
export const tokenlessDeploymentSchema = "rateloop-tokenless-deployment-v2" as const;
export const tokenlessDeployedContracts = {} as const;

export const tokenlessHistoricalDeploymentSchema = "rateloop-tokenless-deployment-v1" as const;
export const tokenlessHistoricalDeployments = {
  "84532": {
    "schemaVersion": "rateloop-tokenless-deployment-v1",
    "version": 1,
    "deploymentComplete": true,
    "deploymentStatus": "historical",
    "supersededBySchema": "rateloop-tokenless-deployment-v2",
    "deploymentProfile": "test",
    "networkName": "baseSepolia",
    "chainId": 84532,
    "deploymentBlockNumber": 44083251,
    "deploymentKey": "tokenless-v1:84532:0x9f21adbac4c007dd45c55d24e38f0067d1e1c5ba:0x830bee10d5304142cd87acac983af140d946def0:0x226891915c1ccce315ddfe58195fdc0a16bd977d",
    "contracts": {
      "TestUSDC": {
        "address": "0x1a63af26f6bd65de51b20dbaef093c088a52c9df",
        "artifact": "MockERC20",
        "deployedOnBlock": 44083251
      },
      "CredentialIssuer": {
        "address": "0x830bee10d5304142cd87acac983af140d946def0",
        "artifact": "CredentialIssuer",
        "deployedOnBlock": 44083251
      },
      "TokenlessPanel": {
        "address": "0x9f21adbac4c007dd45c55d24e38f0067d1e1c5ba",
        "artifact": "TokenlessPanel",
        "deployedOnBlock": 44083251
      },
      "X402PanelSubmitter": {
        "address": "0x226891915c1ccce315ddfe58195fdc0a16bd977d",
        "artifact": "X402PanelSubmitter",
        "deployedOnBlock": 44083251
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
