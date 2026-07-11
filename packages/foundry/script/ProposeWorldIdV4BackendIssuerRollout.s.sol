// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Script } from "forge-std/Script.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { ProxyAdmin } from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { RateLoopGovernor } from "../contracts/governance/RateLoopGovernor.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { WorldIdV4BackendIssuer } from "../contracts/WorldIdV4BackendIssuer.sol";

/// @notice Submits the three-action atomic Governor proposal that activates the backend issuer rollout.
contract ProposeWorldIdV4BackendIssuerRolloutScript is Script {
    uint256 public constant BASE_CHAIN_ID = 8453;
    address public constant RATER_REGISTRY = 0x0Cc33Cef83e2D83C7Ac572a047164a1f43a4CC8e;
    address public constant GOVERNOR = 0x62d19915041d93595EB149B4c8711D6a4c6ce087;
    address public constant RATER_REGISTRY_PROXY_ADMIN = 0x77a93e251DeA0E5839717D247e7eE76Cd5439a52;
    address public constant TIMELOCK = 0xE40055A0056425b4Ae6fd990474F070d9c3414a5;
    bytes32 public constant SEEDER_ROLE = keccak256("SEEDER_ROLE");
    uint64 public constant MAX_BACKEND_CREDENTIAL_TTL = 7 days;
    uint256 public constant MAX_ACTIVATION_CAP = 10_000;

    error InvalidProductionProfile();
    error InvalidChain(uint256 chainId);
    error InvalidKnownDeployment();
    error InvalidImplementation();
    error InvalidIssuer();
    error InvalidSigner();
    error InvalidProposer();
    error InvalidRpId();
    error InvalidAction();
    error InvalidCredentialTtl();
    error InvalidActivationCap();
    error InvalidDescription();
    error RolloutAlreadyStarted();

    struct ProposalConfig {
        address implementation;
        address issuer;
        address signer;
        address proposer;
        uint64 rpId;
        uint256 action;
        uint64 maxCredentialTtl;
        uint256 activationCap;
        string description;
    }

    function run() external returns (uint256 proposalId) {
        ProposalConfig memory config = _loadConfig();
        validateInputs(config);
        _validateKnownDeployment(config);
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) =
            buildProposal(config);

        vm.startBroadcast(config.proposer);
        proposalId = RateLoopGovernor(payable(GOVERNOR)).propose(targets, values, calldatas, description);
        vm.stopBroadcast();
    }

    function validateInputs(ProposalConfig memory config) public pure {
        if (config.implementation == address(0)) revert InvalidImplementation();
        if (config.issuer == address(0)) revert InvalidIssuer();
        if (config.signer == address(0)) revert InvalidSigner();
        if (config.proposer == address(0)) revert InvalidProposer();
        if (config.rpId == 0) revert InvalidRpId();
        if (config.action == 0) revert InvalidAction();
        if (config.maxCredentialTtl == 0 || config.maxCredentialTtl > MAX_BACKEND_CREDENTIAL_TTL) {
            revert InvalidCredentialTtl();
        }
        if (config.activationCap == 0 || config.activationCap > MAX_ACTIVATION_CAP) revert InvalidActivationCap();
        if (bytes(config.description).length == 0) revert InvalidDescription();
    }

    function buildProposal(ProposalConfig memory config)
        public
        pure
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description)
    {
        validateInputs(config);
        targets = new address[](3);
        values = new uint256[](3);
        calldatas = new bytes[](3);

        targets[0] = RATER_REGISTRY_PROXY_ADMIN;
        calldatas[0] = abi.encodeCall(
            ProxyAdmin.upgradeAndCall,
            (ITransparentUpgradeableProxy(payable(RATER_REGISTRY)), config.implementation, bytes(""))
        );
        targets[1] = RATER_REGISTRY;
        calldatas[1] = abi.encodeCall(IAccessControl.grantRole, (SEEDER_ROLE, config.issuer));
        targets[2] = config.issuer;
        calldatas[2] = abi.encodeCall(WorldIdV4BackendIssuer.setIssuanceCap, (config.activationCap));
        description = string.concat(config.description, "#proposer=", Strings.toHexString(uint160(config.proposer), 20));
    }

    function _loadConfig() internal view returns (ProposalConfig memory config) {
        string memory profile = vm.envString("RATELOOP_DEPLOYMENT_PROFILE");
        if (keccak256(bytes(profile)) != keccak256("production")) revert InvalidProductionProfile();

        uint256 rawRpId = vm.envUint("WORLD_ID_V4_RP_ID");
        if (rawRpId == 0 || rawRpId > type(uint64).max) revert InvalidRpId();
        uint256 rawMaxCredentialTtl = vm.envUint("WORLD_ID_V4_MAX_CREDENTIAL_TTL");
        if (rawMaxCredentialTtl == 0 || rawMaxCredentialTtl > type(uint64).max) revert InvalidCredentialTtl();

        config = ProposalConfig({
            implementation: vm.envAddress("WORLD_ID_V4_RATER_REGISTRY_IMPLEMENTATION"),
            issuer: vm.envAddress("WORLD_ID_V4_BACKEND_ISSUER"),
            signer: vm.envAddress("WORLD_ID_V4_BACKEND_SIGNER"),
            proposer: vm.envAddress("WORLD_ID_V4_PROPOSER"),
            rpId: uint64(rawRpId),
            action: vm.envUint("WORLD_ID_V4_ACTION"),
            maxCredentialTtl: uint64(rawMaxCredentialTtl),
            activationCap: vm.envUint("WORLD_ID_V4_ACTIVATION_CAP"),
            description: vm.envString("WORLD_ID_V4_PROPOSAL_DESCRIPTION")
        });
    }

    function _validateKnownDeployment(ProposalConfig memory config) internal view {
        if (block.chainid != BASE_CHAIN_ID) revert InvalidChain(block.chainid);
        if (
            RATER_REGISTRY.code.length == 0 || GOVERNOR.code.length == 0 || RATER_REGISTRY_PROXY_ADMIN.code.length == 0
                || TIMELOCK.code.length == 0
        ) revert InvalidKnownDeployment();
        if (config.implementation.code.length == 0) revert InvalidImplementation();
        if (config.issuer.code.length == 0) revert InvalidIssuer();
        if (ProxyAdmin(RATER_REGISTRY_PROXY_ADMIN).owner() != TIMELOCK) revert InvalidKnownDeployment();

        RaterRegistry implementation = RaterRegistry(config.implementation);
        if (
            address(implementation.worldIdV4Verifier()) != address(0) || implementation.worldIdV4RpId() != 0
                || implementation.worldIdV4Action() != 0 || implementation.worldIdV4CredentialTtl() != 0
                || implementation.maxSeededCredentialTtl() != 0
        ) revert InvalidImplementation();

        WorldIdV4BackendIssuer issuer = WorldIdV4BackendIssuer(config.issuer);
        if (
            address(issuer.registry()) != RATER_REGISTRY || issuer.rpId() != config.rpId
                || issuer.action() != config.action || issuer.maxCredentialTtl() != config.maxCredentialTtl
                || issuer.issuanceCap() != 0 || issuer.issuedCount() != 0
        ) revert InvalidIssuer();
        if (!issuer.hasRole(issuer.SIGNER_ROLE(), config.signer)) revert InvalidSigner();
        if (
            !issuer.hasRole(issuer.DEFAULT_ADMIN_ROLE(), TIMELOCK)
                || !issuer.hasRole(issuer.GOVERNANCE_ROLE(), TIMELOCK)
        ) revert InvalidKnownDeployment();

        RaterRegistry registry = RaterRegistry(RATER_REGISTRY);
        uint64 registryTtlCap = registry.maxSeededCredentialTtl();
        if (registryTtlCap != 0 && config.maxCredentialTtl > registryTtlCap) revert InvalidCredentialTtl();
        if (registry.hasRole(registry.SEEDER_ROLE(), config.issuer)) revert RolloutAlreadyStarted();
    }
}
