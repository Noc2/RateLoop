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

        vm.startBroadcast();

        MockERC20 testUsdc = new MockERC20("RateLoop Tokenless Test USDC", "tUSDC", 6);
        CredentialIssuer issuer = new CredentialIssuer(rotationAuthority, initialSigner, uint64(maxScheduledGraceRaw));
        TokenlessPanel panel = new TokenlessPanel(address(testUsdc), address(issuer));
        X402PanelSubmitter x402Submitter = new X402PanelSubmitter(address(testUsdc), address(panel));

        vm.stopBroadcast();

        console2.log("TokenlessTestUSDC:", address(testUsdc));
        console2.log("CredentialIssuer:", address(issuer));
        console2.log("TokenlessPanel:", address(panel));
        console2.log("X402PanelSubmitter:", address(x402Submitter));
        console2.log("Tokenless deployment schema: rateloop-tokenless-deployment-v2");
    }
}
