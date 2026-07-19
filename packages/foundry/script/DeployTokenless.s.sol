// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { Script, console2 } from "forge-std/Script.sol";

import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { CredentialIssuer } from "../contracts/tokenless/CredentialIssuer.sol";
import { TokenlessFeedbackBonus } from "../contracts/tokenless/TokenlessFeedbackBonus.sol";
import { TokenlessPanel } from "../contracts/tokenless/TokenlessPanel.sol";
import { X402PanelSubmitter } from "../contracts/tokenless/X402PanelSubmitter.sol";

interface ISafeRotationAuthority {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

/// @notice Disposable Base Sepolia deployment for the next tokenless-v4 stack.
/// @dev Tokenless artifacts live under the isolated deployments/tokenless-v4 schema.
contract DeployTokenlessScript is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 internal constant EIP170_RUNTIME_CODE_SIZE_LIMIT = 24_576;
    uint256 internal constant EIP3860_INITCODE_SIZE_LIMIT = 49_152;

    string internal constant TEST_USDC_ARTIFACT = "MockERC20.sol:MockERC20";
    string internal constant CREDENTIAL_ISSUER_ARTIFACT = "CredentialIssuer.sol:CredentialIssuer";
    string internal constant FEEDBACK_BONUS_ARTIFACT = "TokenlessFeedbackBonus.sol:TokenlessFeedbackBonus";
    string internal constant TOKENLESS_PANEL_ARTIFACT = "TokenlessPanel.sol:TokenlessPanel";
    string internal constant X402_PANEL_SUBMITTER_ARTIFACT = "X402PanelSubmitter.sol:X402PanelSubmitter";

    error UnsupportedChain(uint256 chainId);
    error InvalidMaxScheduledGrace(uint256 value);
    error RotationAuthorityMustBeContract(address authority);
    error RotationAuthorityPolicyUnavailable(address authority);
    error RotationAuthorityThresholdTooLow(uint256 threshold);
    error RotationAuthorityOwnerSetTooSmall(uint256 ownerCount);
    error RotationAuthorityOwnerInvalid(address owner);
    error BeaconVerifierMustBeContract(address verifier);
    error RuntimeCodeSizeExceeded(string artifact, uint256 actual, uint256 limit);
    error InitcodeSizeExceeded(string artifact, uint256 actual, uint256 limit);

    function run() external {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert UnsupportedChain(block.chainid);

        address rotationAuthority = vm.envAddress("TOKENLESS_ROTATION_AUTHORITY");
        address initialSigner = vm.envAddress("TOKENLESS_INITIAL_SIGNER");
        address beaconVerifier = vm.envAddress("TOKENLESS_BEACON_VERIFIER");
        _assertRotationAuthority(rotationAuthority);
        if (beaconVerifier.code.length == 0) revert BeaconVerifierMustBeContract(beaconVerifier);
        uint256 maxScheduledGraceRaw = vm.envOr("TOKENLESS_MAX_SCHEDULED_GRACE", uint256(1 days));
        if (maxScheduledGraceRaw == 0 || maxScheduledGraceRaw > type(uint64).max) {
            revert InvalidMaxScheduledGrace(maxScheduledGraceRaw);
        }

        bytes memory testUsdcArgs = abi.encode("RateLoop Tokenless Test USDC", "tUSDC", uint8(6));
        bytes memory credentialIssuerArgs = abi.encode(rotationAuthority, initialSigner, uint64(maxScheduledGraceRaw));

        // The remaining constructors take only addresses, so their encoded size is value-independent.
        bytes memory twoAddressArgs = abi.encode(address(0), address(0));
        bytes memory threeAddressArgs = abi.encode(address(0), address(0), address(0));
        _assertDeployable(TEST_USDC_ARTIFACT, testUsdcArgs);
        _assertDeployable(CREDENTIAL_ISSUER_ARTIFACT, credentialIssuerArgs);
        _assertDeployable(FEEDBACK_BONUS_ARTIFACT, twoAddressArgs);
        _assertDeployable(TOKENLESS_PANEL_ARTIFACT, threeAddressArgs);
        _assertDeployable(X402_PANEL_SUBMITTER_ARTIFACT, twoAddressArgs);

        vm.startBroadcast();

        MockERC20 testUsdc = MockERC20(deployCode(TEST_USDC_ARTIFACT, testUsdcArgs));
        CredentialIssuer issuer = CredentialIssuer(deployCode(CREDENTIAL_ISSUER_ARTIFACT, credentialIssuerArgs));
        TokenlessPanel panel = TokenlessPanel(
            deployCode(TOKENLESS_PANEL_ARTIFACT, abi.encode(address(testUsdc), address(issuer), beaconVerifier))
        );
        TokenlessFeedbackBonus feedbackBonus = TokenlessFeedbackBonus(
            deployCode(FEEDBACK_BONUS_ARTIFACT, abi.encode(address(testUsdc), address(issuer)))
        );
        X402PanelSubmitter x402Submitter = X402PanelSubmitter(
            deployCode(X402_PANEL_SUBMITTER_ARTIFACT, abi.encode(address(testUsdc), address(panel)))
        );

        vm.stopBroadcast();

        console2.log("TokenlessTestUSDC:", address(testUsdc));
        console2.log("CredentialIssuer:", address(issuer));
        console2.log("TokenlessPanel:", address(panel));
        console2.log("BeaconVerifier:", beaconVerifier);
        console2.log("TokenlessFeedbackBonus:", address(feedbackBonus));
        console2.log("X402PanelSubmitter:", address(x402Submitter));
        console2.log("Tokenless deployment schema: rateloop-tokenless-deployment-v4");
    }

    function _assertDeployable(string memory artifact, bytes memory constructorArgs) internal view {
        uint256 runtimeSize = vm.getDeployedCode(artifact).length;
        if (runtimeSize > EIP170_RUNTIME_CODE_SIZE_LIMIT) {
            revert RuntimeCodeSizeExceeded(artifact, runtimeSize, EIP170_RUNTIME_CODE_SIZE_LIMIT);
        }

        uint256 initcodeSize = vm.getCode(artifact).length + constructorArgs.length;
        if (initcodeSize > EIP3860_INITCODE_SIZE_LIMIT) {
            revert InitcodeSizeExceeded(artifact, initcodeSize, EIP3860_INITCODE_SIZE_LIMIT);
        }
    }

    function _assertRotationAuthority(address authority) internal view {
        if (authority.code.length == 0) revert RotationAuthorityMustBeContract(authority);

        address[] memory owners;
        uint256 threshold;
        try ISafeRotationAuthority(authority).getOwners() returns (address[] memory configuredOwners) {
            owners = configuredOwners;
        } catch {
            revert RotationAuthorityPolicyUnavailable(authority);
        }
        try ISafeRotationAuthority(authority).getThreshold() returns (uint256 configuredThreshold) {
            threshold = configuredThreshold;
        } catch {
            revert RotationAuthorityPolicyUnavailable(authority);
        }

        if (threshold < 2) revert RotationAuthorityThresholdTooLow(threshold);
        if (owners.length < 3 || threshold > owners.length) revert RotationAuthorityOwnerSetTooSmall(owners.length);
        for (uint256 i; i < owners.length; ++i) {
            if (owners[i] == address(0)) revert RotationAuthorityOwnerInvalid(owners[i]);
            for (uint256 j; j < i; ++j) {
                if (owners[i] == owners[j]) revert RotationAuthorityOwnerInvalid(owners[i]);
            }
        }
    }
}
