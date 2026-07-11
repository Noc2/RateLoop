// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { ProxyAdmin } from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { DeployWorldIdV4BackendIssuerScript } from "../script/DeployWorldIdV4BackendIssuer.s.sol";
import { ProposeWorldIdV4BackendIssuerRolloutScript } from "../script/ProposeWorldIdV4BackendIssuerRollout.s.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { WorldIdV4BackendIssuer } from "../contracts/WorldIdV4BackendIssuer.sol";

contract DeployWorldIdV4BackendIssuerHarness is DeployWorldIdV4BackendIssuerScript {
    function deployForTest(
        address registry,
        address governance,
        address signer,
        uint64 rpId,
        uint256 action,
        uint64 maxCredentialTtl
    ) external returns (RaterRegistry implementation, WorldIdV4BackendIssuer issuer) {
        return _deploy(registry, governance, signer, rpId, action, maxCredentialTtl);
    }
}

contract WorldIdV4BackendIssuerRolloutTest is Test {
    uint64 internal constant RP_ID = 42;
    uint256 internal constant ACTION = uint256(keccak256("rateloop-human-credential-v4"));
    uint64 internal constant CREDENTIAL_TTL = 7 days;
    address internal constant GOVERNANCE = address(0xA11CE);
    address internal constant SIGNER = address(0xB0B);
    address internal constant PROPOSER = address(0xCAFE);

    DeployWorldIdV4BackendIssuerHarness internal deployScript;
    ProposeWorldIdV4BackendIssuerRolloutScript internal proposalScript;

    function setUp() public {
        vm.chainId(8453);
        deployScript = new DeployWorldIdV4BackendIssuerHarness();
        proposalScript = new ProposeWorldIdV4BackendIssuerRolloutScript();
    }

    function test_DeploysZeroConfiguredImplementationAndDisabledIssuer() public {
        RaterRegistry registry = new RaterRegistry(GOVERNANCE, GOVERNANCE, address(0), 0, 0, 0, 0, 0, 0, 0);

        (RaterRegistry implementation, WorldIdV4BackendIssuer issuer) =
            deployScript.deployForTest(address(registry), GOVERNANCE, SIGNER, RP_ID, ACTION, CREDENTIAL_TTL);

        assertEq(address(implementation.worldIdV4Verifier()), address(0));
        assertEq(implementation.worldIdV4RpId(), 0);
        assertEq(implementation.worldIdV4Action(), 0);
        assertEq(implementation.worldIdV4CredentialTtl(), 0);
        assertEq(implementation.maxSeededCredentialTtl(), 0);
        assertEq(address(issuer.registry()), address(registry));
        assertEq(issuer.rpId(), RP_ID);
        assertEq(issuer.action(), ACTION);
        assertEq(issuer.maxCredentialTtl(), CREDENTIAL_TTL);
        assertEq(issuer.issuanceCap(), 0);
        assertEq(issuer.issuedCount(), 0);
        assertTrue(issuer.hasRole(issuer.SIGNER_ROLE(), SIGNER));
        assertTrue(issuer.hasRole(issuer.GOVERNANCE_ROLE(), GOVERNANCE));
    }

    function test_DeploymentValidationRejectsUnsafeInputs() public {
        vm.expectRevert(DeployWorldIdV4BackendIssuerScript.InvalidProductionProfile.selector);
        deployScript.validateInputs("staging", SIGNER, RP_ID, ACTION, CREDENTIAL_TTL);

        vm.expectRevert(DeployWorldIdV4BackendIssuerScript.InvalidSigner.selector);
        deployScript.validateInputs("production", address(0), RP_ID, ACTION, CREDENTIAL_TTL);

        vm.expectRevert(DeployWorldIdV4BackendIssuerScript.InvalidRpId.selector);
        deployScript.validateInputs("production", SIGNER, uint256(type(uint64).max) + 1, ACTION, CREDENTIAL_TTL);

        vm.expectRevert(DeployWorldIdV4BackendIssuerScript.InvalidCredentialTtl.selector);
        deployScript.validateInputs("production", SIGNER, RP_ID, ACTION, CREDENTIAL_TTL + 1);
    }

    function test_BuildsOrderedAtomicProposalWithMandatoryProposerSuffix() public view {
        ProposeWorldIdV4BackendIssuerRolloutScript.ProposalConfig memory config = _proposalConfig();
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) =
            proposalScript.buildProposal(config);

        assertEq(targets.length, 3);
        assertEq(targets[0], proposalScript.RATER_REGISTRY_PROXY_ADMIN());
        assertEq(targets[1], proposalScript.RATER_REGISTRY());
        assertEq(targets[2], config.issuer);
        assertEq(values, new uint256[](3));
        assertEq(
            calldatas[0],
            abi.encodeCall(
                ProxyAdmin.upgradeAndCall,
                (
                    ITransparentUpgradeableProxy(payable(proposalScript.RATER_REGISTRY())),
                    config.implementation,
                    bytes("")
                )
            )
        );
        assertEq(calldatas[1], abi.encodeCall(IAccessControl.grantRole, (proposalScript.SEEDER_ROLE(), config.issuer)));
        assertEq(calldatas[2], abi.encodeCall(WorldIdV4BackendIssuer.setIssuanceCap, (config.activationCap)));
        assertEq(description, "Activate World ID v4 backend issuer#proposer=0x000000000000000000000000000000000000cafe");
    }

    function test_ProposalValidationEnforcesConservativeActivationCap() public {
        ProposeWorldIdV4BackendIssuerRolloutScript.ProposalConfig memory config = _proposalConfig();
        config.activationCap = proposalScript.MAX_ACTIVATION_CAP() + 1;

        vm.expectRevert(ProposeWorldIdV4BackendIssuerRolloutScript.InvalidActivationCap.selector);
        proposalScript.validateInputs(config);
    }

    function test_ProposalValidationRejectsZeroSignerAndEmptyDescription() public {
        ProposeWorldIdV4BackendIssuerRolloutScript.ProposalConfig memory config = _proposalConfig();
        config.signer = address(0);
        vm.expectRevert(ProposeWorldIdV4BackendIssuerRolloutScript.InvalidSigner.selector);
        proposalScript.validateInputs(config);

        config = _proposalConfig();
        config.description = "";
        vm.expectRevert(ProposeWorldIdV4BackendIssuerRolloutScript.InvalidDescription.selector);
        proposalScript.validateInputs(config);
    }

    function _proposalConfig()
        internal
        pure
        returns (ProposeWorldIdV4BackendIssuerRolloutScript.ProposalConfig memory config)
    {
        config = ProposeWorldIdV4BackendIssuerRolloutScript.ProposalConfig({
            implementation: address(0x1111),
            issuer: address(0x2222),
            signer: SIGNER,
            proposer: PROPOSER,
            rpId: RP_ID,
            action: ACTION,
            maxCredentialTtl: CREDENTIAL_TTL,
            activationCap: 100,
            description: "Activate World ID v4 backend issuer"
        });
    }
}
