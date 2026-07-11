// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Script } from "forge-std/Script.sol";
import { ProxyAdmin } from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { WorldIdV4BackendIssuer } from "../contracts/WorldIdV4BackendIssuer.sol";

/// @notice Deploys only the contracts needed to prepare the governed World ID v4 backend issuer rollout.
/// @dev This script deliberately does not mutate the RaterRegistry proxy or activate issuance.
contract DeployWorldIdV4BackendIssuerScript is Script {
    uint256 public constant BASE_CHAIN_ID = 8453;
    address public constant RATER_REGISTRY = 0x0Cc33Cef83e2D83C7Ac572a047164a1f43a4CC8e;
    address public constant RATER_REGISTRY_PROXY_ADMIN = 0x77a93e251DeA0E5839717D247e7eE76Cd5439a52;
    address public constant TIMELOCK = 0xE40055A0056425b4Ae6fd990474F070d9c3414a5;
    uint64 public constant MAX_BACKEND_CREDENTIAL_TTL = 7 days;

    error InvalidProductionProfile();
    error InvalidChain(uint256 chainId);
    error InvalidKnownDeployment();
    error InvalidSigner();
    error InvalidRpId();
    error InvalidAction();
    error InvalidCredentialTtl();

    function run() external returns (RaterRegistry implementation, WorldIdV4BackendIssuer issuer) {
        string memory profile = vm.envString("RATELOOP_DEPLOYMENT_PROFILE");
        address signer = vm.envAddress("WORLD_ID_V4_BACKEND_SIGNER");
        uint256 rawRpId = vm.envUint("WORLD_ID_V4_RP_ID");
        uint256 action = vm.envUint("WORLD_ID_V4_ACTION");
        uint256 rawMaxCredentialTtl = vm.envUint("WORLD_ID_V4_MAX_CREDENTIAL_TTL");

        (uint64 rpId, uint64 maxCredentialTtl) = validateInputs(profile, signer, rawRpId, action, rawMaxCredentialTtl);
        _validateKnownDeployment();

        vm.startBroadcast();
        (implementation, issuer) = _deploy(RATER_REGISTRY, TIMELOCK, signer, rpId, action, maxCredentialTtl);
        vm.stopBroadcast();
    }

    function validateInputs(
        string memory profile,
        address signer,
        uint256 rawRpId,
        uint256 action,
        uint256 rawMaxCredentialTtl
    ) public pure returns (uint64 rpId, uint64 maxCredentialTtl) {
        if (keccak256(bytes(profile)) != keccak256("production")) revert InvalidProductionProfile();
        if (signer == address(0)) revert InvalidSigner();
        if (rawRpId == 0 || rawRpId > type(uint64).max) revert InvalidRpId();
        if (action == 0) revert InvalidAction();
        if (rawMaxCredentialTtl == 0 || rawMaxCredentialTtl > MAX_BACKEND_CREDENTIAL_TTL) {
            revert InvalidCredentialTtl();
        }
        rpId = uint64(rawRpId);
        maxCredentialTtl = uint64(rawMaxCredentialTtl);
    }

    function _validateKnownDeployment() internal view {
        if (block.chainid != BASE_CHAIN_ID) revert InvalidChain(block.chainid);
        if (RATER_REGISTRY.code.length == 0 || RATER_REGISTRY_PROXY_ADMIN.code.length == 0 || TIMELOCK.code.length == 0)
        {
            revert InvalidKnownDeployment();
        }
        if (ProxyAdmin(RATER_REGISTRY_PROXY_ADMIN).owner() != TIMELOCK) revert InvalidKnownDeployment();
    }

    function _deploy(
        address registry,
        address governance,
        address signer,
        uint64 rpId,
        uint256 action,
        uint64 maxCredentialTtl
    ) internal returns (RaterRegistry implementation, WorldIdV4BackendIssuer issuer) {
        implementation = new RaterRegistry(governance, governance, address(0), 0, 0, 0, 0, 0, 0, 0);
        issuer = new WorldIdV4BackendIssuer(registry, governance, signer, rpId, action, maxCredentialTtl, 0);
    }
}
