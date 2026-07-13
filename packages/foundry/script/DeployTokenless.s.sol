// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Script, console2 } from "forge-std/Script.sol";

import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { CredentialIssuer } from "../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessPanel } from "../contracts/tokenless/TokenlessPanel.sol";
import { X402PanelSubmitter } from "../contracts/tokenless/X402PanelSubmitter.sol";

/// @notice Disposable Base Sepolia deployment for the next tokenless-v2 stack.
/// @dev Tokenless artifacts live under the isolated deployments/tokenless-v2 schema.
contract DeployTokenlessScript is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    string internal constant TEST_USDC_ARTIFACT = "MockERC20.sol:MockERC20";
    string internal constant CREDENTIAL_ISSUER_ARTIFACT = "CredentialIssuer.sol:CredentialIssuer";
    string internal constant TOKENLESS_PANEL_ARTIFACT = "TokenlessPanel.sol:TokenlessPanel";
    string internal constant X402_PANEL_SUBMITTER_ARTIFACT = "X402PanelSubmitter.sol:X402PanelSubmitter";

    error UnsupportedChain(uint256 chainId);
    error InvalidMaxScheduledGrace(uint256 value);

    function run() external {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert UnsupportedChain(block.chainid);

        address rotationAuthority = vm.envAddress("TOKENLESS_ROTATION_AUTHORITY");
        address initialSigner = vm.envAddress("TOKENLESS_INITIAL_SIGNER");
        uint256 maxScheduledGraceRaw = vm.envOr("TOKENLESS_MAX_SCHEDULED_GRACE", uint256(1 days));
        if (maxScheduledGraceRaw == 0 || maxScheduledGraceRaw > type(uint64).max) {
            revert InvalidMaxScheduledGrace(maxScheduledGraceRaw);
        }

        bytes memory testUsdcArgs = abi.encode("RateLoop Tokenless Test USDC", "tUSDC", uint8(6));
        bytes memory credentialIssuerArgs = abi.encode(rotationAuthority, initialSigner, uint64(maxScheduledGraceRaw));

        vm.startBroadcast();

        MockERC20 testUsdc = MockERC20(deployCode(TEST_USDC_ARTIFACT, testUsdcArgs));
        CredentialIssuer issuer = CredentialIssuer(deployCode(CREDENTIAL_ISSUER_ARTIFACT, credentialIssuerArgs));
        TokenlessPanel panel =
            TokenlessPanel(deployCode(TOKENLESS_PANEL_ARTIFACT, abi.encode(address(testUsdc), address(issuer))));
        X402PanelSubmitter x402Submitter = X402PanelSubmitter(
            deployCode(X402_PANEL_SUBMITTER_ARTIFACT, abi.encode(address(testUsdc), address(panel)))
        );

        vm.stopBroadcast();

        console2.log("TokenlessTestUSDC:", address(testUsdc));
        console2.log("CredentialIssuer:", address(issuer));
        console2.log("TokenlessPanel:", address(panel));
        console2.log("X402PanelSubmitter:", address(x402Submitter));
        console2.log("Tokenless deployment schema: rateloop-tokenless-deployment-v2");
    }
}
