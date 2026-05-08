// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {RaterDeclarationRegistry} from "../contracts/RaterDeclarationRegistry.sol";

contract RaterDeclarationRegistryTest is Test {
    RaterDeclarationRegistry internal registry;
    MockERC20 internal mrep;

    uint256 internal operatorPk = 0xA11CE;
    address internal operator;
    address internal admin = address(0xB0B);
    address internal governance = address(0xCAFE);
    address internal treasury = address(0x7777);
    address internal rater = address(0x1234);
    address internal challenger = address(0x8888);

    uint256 internal constant MIN_BOND = 100e6;
    uint256 internal constant CHALLENGE_BOND = 25e6;
    bytes32 internal constant MODEL_ID = keccak256("anthropic/claude-4.7");
    bytes32 internal constant PROVIDER = keccak256("anthropic");
    bytes32 internal constant ENDPOINT_HINT = keccak256("https://operator.example/hidden");
    bytes32 internal constant PROMPT_HASH = keccak256("prompt-v1");
    bytes32 internal constant RETRIEVAL_HASH = keccak256("retrieval-v1");
    bytes32 internal constant TOOLING_HASH = keccak256("agent-client-v1");
    bytes32 internal constant PROBE_LIBRARY_HASH = keccak256("probe-library-v1");
    bytes32 internal constant PROBE_RESULT_HASH = keccak256("probe-result");
    bytes32 internal constant EVIDENCE_HASH = keccak256("challenge-evidence");
    bytes32 internal constant RESOLUTION_HASH = keccak256("challenge-resolution");

    function setUp() public {
        operator = vm.addr(operatorPk);
        mrep = new MockERC20("Mesh Reputation", "MREP", 6);
        registry = new RaterDeclarationRegistry(admin, governance, mrep, treasury, MIN_BOND, CHALLENGE_BOND);

        mrep.mint(rater, 1_000e6);
        mrep.mint(challenger, 1_000e6);

        vm.prank(rater);
        mrep.approve(address(registry), type(uint256).max);
        vm.prank(challenger);
        mrep.approve(address(registry), type(uint256).max);
    }

    function test_ConstructorStoresParametersAndRoles() public view {
        assertEq(address(registry.mrepToken()), address(mrep));
        assertEq(registry.minDeclarationBondMrep(), MIN_BOND);
        assertEq(registry.challengeBondMrep(), CHALLENGE_BOND);
        assertEq(registry.challengerRewardBps(), 5_000);
        assertEq(registry.treasury(), treasury);

        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), governance));
        assertTrue(registry.hasRole(registry.CONFIG_ROLE(), governance));
        assertTrue(registry.hasRole(registry.PROBE_ROLE(), governance));
        assertTrue(registry.hasRole(registry.CHALLENGE_RESOLVER_ROLE(), governance));

        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(registry.hasRole(registry.CONFIG_ROLE(), admin));
        assertTrue(registry.hasRole(registry.PROBE_ROLE(), admin));
        assertTrue(registry.hasRole(registry.CHALLENGE_RESOLVER_ROLE(), admin));
    }

    function test_ConstructorRejectsBondsBelowHardFloors() public {
        uint256 minDeclarationBondFloor = registry.MIN_DECLARATION_BOND_MREP_FLOOR();
        uint256 challengeBondFloor = registry.MIN_CHALLENGE_BOND_MREP_FLOOR();

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        new RaterDeclarationRegistry(admin, governance, mrep, treasury, minDeclarationBondFloor - 1, challengeBondFloor);

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        new RaterDeclarationRegistry(admin, governance, mrep, treasury, minDeclarationBondFloor, challengeBondFloor - 1);
    }

    function test_SetDeclarationParametersRejectsBondsBelowHardFloors() public {
        uint256 minDeclarationBondFloor = registry.MIN_DECLARATION_BOND_MREP_FLOOR();
        uint256 challengeBondFloor = registry.MIN_CHALLENGE_BOND_MREP_FLOOR();

        vm.startPrank(admin);

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        registry.setDeclarationParameters(minDeclarationBondFloor - 1, challengeBondFloor, 5_000, treasury);

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        registry.setDeclarationParameters(minDeclarationBondFloor, challengeBondFloor - 1, 5_000, treasury);

        vm.stopPrank();
    }

    function test_SetDeclarationParametersAllowsValuesAtOrAboveHardFloors() public {
        uint256 nextMinBond = registry.MIN_DECLARATION_BOND_MREP_FLOOR() + 50e6;
        uint256 nextChallengeBond = registry.MIN_CHALLENGE_BOND_MREP_FLOOR() + 10e6;

        vm.prank(admin);
        registry.setDeclarationParameters(nextMinBond, nextChallengeBond, 4_000, treasury);

        assertEq(registry.minDeclarationBondMrep(), nextMinBond);
        assertEq(registry.challengeBondMrep(), nextChallengeBond);
        assertEq(registry.challengerRewardBps(), 4_000);
    }

    function test_SubmitDeclarationLocksBondAndStartsProbeWindow() public {
        RaterDeclarationRegistry.RaterDeclaration memory declaration = _declaration(1, 0, PROMPT_HASH);
        bytes memory signature = _signature(declaration);

        vm.prank(rater);
        bytes32 declarationHash = registry.submitDeclaration(declaration, signature, MIN_BOND, true);

        RaterDeclarationRegistry.StoredDeclaration memory stored = registry.getDeclaration(rater);
        assertEq(stored.declaration.rater, rater);
        assertEq(stored.declaration.operator, operator);
        assertEq(stored.declaration.version, 1);
        assertEq(stored.declarationHash, declarationHash);
        assertEq(uint256(stored.tier), uint256(RaterDeclarationRegistry.RaterTier.A1Unverified));
        assertTrue(stored.probePending);
        assertEq(registry.operatorBond(operator), MIN_BOND);
        assertEq(registry.activeOperatorDeclarations(operator), 1);
        assertEq(registry.nonces(rater), 1);
        assertEq(registry.tierMultiplierBps(rater), 10_500);
    }

    function test_SubmitDeclarationRejectsInvalidOperatorSignature() public {
        RaterDeclarationRegistry.RaterDeclaration memory declaration = _declaration(1, 0, PROMPT_HASH);
        bytes memory wrongSignature = _signatureWithKey(declaration, 0xBAD);

        vm.prank(rater);
        vm.expectRevert(RaterDeclarationRegistry.InvalidSignature.selector);
        registry.submitDeclaration(declaration, wrongSignature, MIN_BOND, true);
    }

    function test_SubmitDeclarationRequiresMinimumOperatorBond() public {
        RaterDeclarationRegistry.RaterDeclaration memory declaration = _declaration(1, 0, PROMPT_HASH);
        bytes memory signature = _signature(declaration);

        vm.prank(rater);
        vm.expectRevert(RaterDeclarationRegistry.InsufficientBond.selector);
        registry.submitDeclaration(declaration, signature, MIN_BOND - 1, false);
    }

    function test_RecordProbeResultPromotesVerifiedTier() public {
        _submitDefaultDeclaration(true);

        vm.prank(admin);
        registry.recordProbeResult(rater, 1, PROBE_LIBRARY_HASH, 8_500, true, PROBE_RESULT_HASH);

        RaterDeclarationRegistry.StoredDeclaration memory stored = registry.getDeclaration(rater);
        assertEq(uint256(stored.tier), uint256(RaterDeclarationRegistry.RaterTier.A1Verified));
        assertFalse(stored.probePending);
        assertEq(stored.lastProbeResultHash, PROBE_RESULT_HASH);
        assertEq(registry.tierMultiplierBps(rater), registry.MAX_TIER_MULTIPLIER_BPS());

        RaterDeclarationRegistry.ProbeResult memory result = registry.getLatestProbeResult(rater);
        assertEq(result.probeLibraryHash, PROBE_LIBRARY_HASH);
        assertEq(result.resultHash, PROBE_RESULT_HASH);
        assertEq(result.confidenceBps, 8_500);
        assertTrue(result.passed);
    }

    function test_FlagBehavioralDriftDemotesVerifiedRater() public {
        _submitDefaultDeclaration(true);

        vm.startPrank(admin);
        registry.recordProbeResult(rater, 1, PROBE_LIBRARY_HASH, 8_500, true, PROBE_RESULT_HASH);
        registry.flagBehavioralDrift(rater, 1, 7_000, keccak256("drift"));
        vm.stopPrank();

        RaterDeclarationRegistry.StoredDeclaration memory stored = registry.getDeclaration(rater);
        assertEq(uint256(stored.tier), uint256(RaterDeclarationRegistry.RaterTier.A1Unverified));
        assertEq(registry.tierMultiplierBps(rater), 10_500);
    }

    function test_RedeclarationOnlyRequestsProbeForBehaviorChanges() public {
        _submitDefaultDeclaration(true);

        RaterDeclarationRegistry.RaterDeclaration memory endpointOnly = _declaration(2, 1, PROMPT_HASH);
        endpointOnly.endpointHint = keccak256("rotated-endpoint");
        bytes memory endpointOnlySignature = _signature(endpointOnly);

        vm.prank(rater);
        registry.submitDeclaration(endpointOnly, endpointOnlySignature, 0, true);

        RaterDeclarationRegistry.StoredDeclaration memory stored = registry.getDeclaration(rater);
        assertFalse(stored.probePending);
        assertEq(registry.activeOperatorDeclarations(operator), 1);

        RaterDeclarationRegistry.RaterDeclaration memory promptChange = _declaration(3, 2, keccak256("prompt-v2"));
        bytes memory promptChangeSignature = _signature(promptChange);

        vm.prank(rater);
        registry.submitDeclaration(promptChange, promptChangeSignature, 0, true);

        stored = registry.getDeclaration(rater);
        assertTrue(stored.probePending);
        assertEq(stored.declaration.promptTemplateHash, keccak256("prompt-v2"));
        assertEq(registry.activeOperatorDeclarations(operator), 1);
    }

    function test_RetireDeclarationAllowsOperatorBondWithdrawal() public {
        _submitDefaultDeclaration(false);

        vm.prank(rater);
        registry.retireDeclaration();

        assertEq(registry.activeOperatorDeclarations(operator), 0);
        RaterDeclarationRegistry.StoredDeclaration memory stored = registry.getDeclaration(rater);
        assertEq(uint256(stored.tier), uint256(RaterDeclarationRegistry.RaterTier.A0));

        uint256 operatorBalanceBefore = mrep.balanceOf(operator);
        vm.prank(operator);
        registry.withdrawRetiredOperatorBond(MIN_BOND);

        assertEq(registry.operatorBond(operator), 0);
        assertEq(mrep.balanceOf(operator), operatorBalanceBefore + MIN_BOND);
    }

    function test_SustainedChallengeSlashesOperatorBondAndDemotesDeclaration() public {
        _submitDefaultDeclaration(false);

        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);

        uint256 challengerBefore = mrep.balanceOf(challenger);
        uint256 treasuryBefore = mrep.balanceOf(treasury);

        vm.prank(admin);
        registry.resolveChallenge(challengeId, true, 5_000, RESOLUTION_HASH);

        RaterDeclarationRegistry.Challenge memory challenge = registry.getChallenge(challengeId);
        assertEq(uint256(challenge.status), uint256(RaterDeclarationRegistry.ChallengeStatus.Sustained));
        assertEq(registry.operatorBond(operator), MIN_BOND / 2);
        assertEq(mrep.balanceOf(challenger), challengerBefore + CHALLENGE_BOND + 25e6);
        assertEq(mrep.balanceOf(treasury), treasuryBefore + 25e6);
        assertEq(registry.activeOperatorDeclarations(operator), 0);

        RaterDeclarationRegistry.StoredDeclaration memory stored = registry.getDeclaration(rater);
        assertEq(uint256(stored.tier), uint256(RaterDeclarationRegistry.RaterTier.A0));
    }

    function test_RejectedChallengeSendsChallengeBondToTreasury() public {
        _submitDefaultDeclaration(false);

        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);

        uint256 treasuryBefore = mrep.balanceOf(treasury);

        vm.prank(admin);
        registry.resolveChallenge(challengeId, false, 0, RESOLUTION_HASH);

        RaterDeclarationRegistry.Challenge memory challenge = registry.getChallenge(challengeId);
        assertEq(uint256(challenge.status), uint256(RaterDeclarationRegistry.ChallengeStatus.Rejected));
        assertEq(registry.operatorBond(operator), MIN_BOND);
        assertEq(mrep.balanceOf(treasury), treasuryBefore + CHALLENGE_BOND);
    }

    function _submitDefaultDeclaration(bool requestProbe) internal {
        RaterDeclarationRegistry.RaterDeclaration memory declaration = _declaration(1, 0, PROMPT_HASH);
        bytes memory signature = _signature(declaration);

        vm.prank(rater);
        registry.submitDeclaration(declaration, signature, MIN_BOND, requestProbe);
    }

    function _declaration(uint32 version, uint96 nonce, bytes32 promptHash)
        internal
        view
        returns (RaterDeclarationRegistry.RaterDeclaration memory)
    {
        return RaterDeclarationRegistry.RaterDeclaration({
            rater: rater,
            operator: operator,
            modelClass: 0,
            modelId: MODEL_ID,
            provider: PROVIDER,
            endpointHint: ENDPOINT_HINT,
            promptTemplateHash: promptHash,
            retrievalConfigHash: RETRIEVAL_HASH,
            toolingHash: TOOLING_HASH,
            version: version,
            effectiveEpoch: 1,
            expiresAtEpoch: 0,
            disclosure: 1,
            nonce: nonce
        });
    }

    function _signature(RaterDeclarationRegistry.RaterDeclaration memory declaration)
        internal
        view
        returns (bytes memory)
    {
        return _signatureWithKey(declaration, operatorPk);
    }

    function _signatureWithKey(RaterDeclarationRegistry.RaterDeclaration memory declaration, uint256 privateKey)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = registry.hashTypedDeclaration(declaration);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
