// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../contracts/mocks/MockERC20.sol";
import {RaterDeclarationRegistry} from "../contracts/RaterDeclarationRegistry.sol";

contract RaterDeclarationRegistryTest is Test {
    RaterDeclarationRegistry internal registry;
    MockERC20 internal lrep;

    uint256 internal operatorPk = 0xA11CE;
    address internal operator;
    address internal admin = address(0xB0B);
    address internal governance = address(0xCAFE);
    address internal treasury = address(0x7777);
    address internal rater = address(0x1234);
    address internal rater2 = address(0x5678);
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
        lrep = new MockERC20("Loop Reputation", "LREP", 6);
        registry = new RaterDeclarationRegistry(admin, governance, lrep, treasury, MIN_BOND, CHALLENGE_BOND);

        lrep.mint(rater, 1_000e6);
        lrep.mint(rater2, 1_000e6);
        lrep.mint(challenger, 1_000e6);

        vm.prank(rater);
        lrep.approve(address(registry), type(uint256).max);
        vm.prank(rater2);
        lrep.approve(address(registry), type(uint256).max);
        vm.prank(challenger);
        lrep.approve(address(registry), type(uint256).max);
    }

    function test_ConstructorStoresParametersAndRoles() public view {
        assertEq(address(registry.lrepToken()), address(lrep));
        assertEq(registry.minDeclarationBondLrep(), MIN_BOND);
        assertEq(registry.challengeBondLrep(), CHALLENGE_BOND);
        assertEq(registry.challengerRewardBps(), 5_000);
        assertEq(registry.challengeResolutionWindow(), registry.DEFAULT_CHALLENGE_RESOLUTION_WINDOW());
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
        uint256 minDeclarationBondFloor = registry.MIN_DECLARATION_BOND_LREP_FLOOR();
        uint256 challengeBondFloor = registry.MIN_CHALLENGE_BOND_LREP_FLOOR();

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        new RaterDeclarationRegistry(admin, governance, lrep, treasury, minDeclarationBondFloor - 1, challengeBondFloor);

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        new RaterDeclarationRegistry(admin, governance, lrep, treasury, minDeclarationBondFloor, challengeBondFloor - 1);
    }

    function test_SetDeclarationParametersRejectsBondsBelowHardFloors() public {
        uint256 minDeclarationBondFloor = registry.MIN_DECLARATION_BOND_LREP_FLOOR();
        uint256 challengeBondFloor = registry.MIN_CHALLENGE_BOND_LREP_FLOOR();

        vm.startPrank(admin);

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        registry.setDeclarationParameters(minDeclarationBondFloor - 1, challengeBondFloor, 5_000, treasury);

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        registry.setDeclarationParameters(minDeclarationBondFloor, challengeBondFloor - 1, 5_000, treasury);

        vm.stopPrank();
    }

    function test_SetDeclarationParametersAllowsValuesAtOrAboveHardFloors() public {
        uint256 nextMinBond = registry.MIN_DECLARATION_BOND_LREP_FLOOR() + 50e6;
        uint256 nextChallengeBond = registry.MIN_CHALLENGE_BOND_LREP_FLOOR() + 10e6;

        vm.prank(admin);
        registry.setDeclarationParameters(nextMinBond, nextChallengeBond, 4_000, treasury);

        assertEq(registry.minDeclarationBondLrep(), nextMinBond);
        assertEq(registry.challengeBondLrep(), nextChallengeBond);
        assertEq(registry.challengerRewardBps(), 4_000);
    }

    function test_SetChallengeResolutionWindowEnforcesBounds() public {
        uint64 minWindow = registry.MIN_CHALLENGE_RESOLUTION_WINDOW();
        uint64 maxWindow = registry.MAX_CHALLENGE_RESOLUTION_WINDOW();

        vm.startPrank(admin);

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        registry.setChallengeResolutionWindow(minWindow - 1);

        vm.expectRevert(RaterDeclarationRegistry.InvalidConfig.selector);
        registry.setChallengeResolutionWindow(maxWindow + 1);

        registry.setChallengeResolutionWindow(3 days);
        vm.stopPrank();

        assertEq(registry.challengeResolutionWindow(), 3 days);
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
        assertEq(registry.operatorBondReserved(operator), MIN_BOND);
        assertEq(registry.declarationBondOperator(rater), operator);
        assertEq(registry.declarationBondAmount(rater), MIN_BOND);
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

    function test_TierMultiplierRequiresEffectiveDeclarationWindow() public {
        RaterDeclarationRegistry.RaterDeclaration memory declaration = _declaration(1, 0, PROMPT_HASH);
        declaration.effectiveEpoch = uint64(block.timestamp + 1 days);
        bytes memory signature = _signature(declaration);

        vm.prank(rater);
        registry.submitDeclaration(declaration, signature, MIN_BOND, false);

        assertEq(registry.tierMultiplierBps(rater), 10_000);
        assertFalse(registry.hasActiveAiDeclaration(rater));

        vm.warp(declaration.effectiveEpoch);

        assertEq(registry.tierMultiplierBps(rater), 10_500);
        assertTrue(registry.hasActiveAiDeclaration(rater));
    }

    function test_TierMultiplierExpiresDeclarationWindow() public {
        RaterDeclarationRegistry.RaterDeclaration memory declaration = _declaration(1, 0, PROMPT_HASH);
        declaration.effectiveEpoch = uint64(block.timestamp);
        declaration.expiresAtEpoch = uint64(block.timestamp + 1 days);
        bytes memory signature = _signature(declaration);

        vm.prank(rater);
        registry.submitDeclaration(declaration, signature, MIN_BOND, true);

        vm.prank(admin);
        registry.recordProbeResult(rater, 1, PROBE_LIBRARY_HASH, 8_500, true, PROBE_RESULT_HASH);

        assertEq(registry.tierMultiplierBps(rater), registry.MAX_TIER_MULTIPLIER_BPS());

        vm.warp(declaration.expiresAtEpoch);

        assertEq(registry.tierMultiplierBps(rater), 10_000);
        assertFalse(registry.hasActiveAiDeclaration(rater));
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
        assertEq(registry.operatorBondReserved(operator), MIN_BOND);

        RaterDeclarationRegistry.RaterDeclaration memory promptChange = _declaration(3, 2, keccak256("prompt-v2"));
        bytes memory promptChangeSignature = _signature(promptChange);

        vm.prank(rater);
        registry.submitDeclaration(promptChange, promptChangeSignature, 0, true);

        stored = registry.getDeclaration(rater);
        assertTrue(stored.probePending);
        assertEq(stored.declaration.promptTemplateHash, keccak256("prompt-v2"));
        assertEq(registry.activeOperatorDeclarations(operator), 1);
        assertEq(registry.operatorBondReserved(operator), MIN_BOND);
    }

    function test_SubmitDeclarationRequiresBondPerActiveRater() public {
        _submitDefaultDeclaration(false);

        RaterDeclarationRegistry.RaterDeclaration memory secondDeclaration =
            _declarationFor(rater2, 1, 0, keccak256("prompt-rater-2"));
        bytes memory secondSignature = _signature(secondDeclaration);

        vm.prank(rater2);
        vm.expectRevert(RaterDeclarationRegistry.InsufficientBond.selector);
        registry.submitDeclaration(secondDeclaration, secondSignature, 0, false);

        vm.prank(rater2);
        registry.submitDeclaration(secondDeclaration, secondSignature, MIN_BOND, false);

        assertEq(registry.operatorBond(operator), MIN_BOND * 2);
        assertEq(registry.operatorBondReserved(operator), MIN_BOND * 2);
        assertEq(registry.activeOperatorDeclarations(operator), 2);
    }

    function test_RetireDeclarationRequiresExitDelayBeforeBondRelease() public {
        _submitDefaultDeclaration(false);

        vm.prank(rater);
        registry.retireDeclaration();

        assertEq(registry.activeOperatorDeclarations(operator), 1);
        assertEq(registry.operatorBondReserved(operator), MIN_BOND);
        assertEq(registry.retiredDeclarationBondReleaseAt(rater), block.timestamp + registry.RETIRED_DECLARATION_BOND_LOCK());
        RaterDeclarationRegistry.StoredDeclaration memory stored = registry.getDeclaration(rater);
        assertEq(uint256(stored.tier), uint256(RaterDeclarationRegistry.RaterTier.A0));

        vm.prank(operator);
        vm.expectRevert(RaterDeclarationRegistry.ActiveDeclarations.selector);
        registry.withdrawRetiredOperatorBond(MIN_BOND);

        vm.expectRevert(RaterDeclarationRegistry.BondReleasePending.selector);
        registry.releaseRetiredDeclarationBond(rater);

        vm.warp(block.timestamp + registry.RETIRED_DECLARATION_BOND_LOCK());
        registry.releaseRetiredDeclarationBond(rater);

        assertEq(registry.activeOperatorDeclarations(operator), 0);
        assertEq(registry.operatorBondReserved(operator), 0);
        assertEq(registry.declarationBondOperator(rater), address(0));
        assertEq(registry.declarationBondAmount(rater), 0);

        uint256 operatorBalanceBefore = lrep.balanceOf(operator);
        vm.prank(operator);
        registry.withdrawRetiredOperatorBond(MIN_BOND);

        assertEq(registry.operatorBond(operator), 0);
        assertEq(lrep.balanceOf(operator), operatorBalanceBefore + MIN_BOND);
    }

    function test_ExpiredDeclarationBondCanBeReleasedAfterGracePeriod() public {
        RaterDeclarationRegistry.RaterDeclaration memory declaration = _declaration(1, 0, PROMPT_HASH);
        declaration.expiresAtEpoch = uint64(block.timestamp + 1 days);
        bytes memory signature = _signature(declaration);

        vm.prank(rater);
        registry.submitDeclaration(declaration, signature, MIN_BOND, true);

        vm.warp(uint256(declaration.expiresAtEpoch) + registry.RETIRED_DECLARATION_BOND_LOCK());
        registry.releaseExpiredDeclarationBond(rater);

        assertEq(registry.activeOperatorDeclarations(operator), 0);
        assertEq(registry.operatorBondReserved(operator), 0);
        assertEq(registry.declarationBondOperator(rater), address(0));
        assertEq(registry.declarationBondAmount(rater), 0);
        assertEq(uint256(registry.getDeclaration(rater).tier), uint256(RaterDeclarationRegistry.RaterTier.A0));
        assertFalse(registry.hasActiveAiDeclaration(rater));

        uint256 operatorBalanceBefore = lrep.balanceOf(operator);
        vm.prank(operator);
        registry.withdrawRetiredOperatorBond(MIN_BOND);
        assertEq(lrep.balanceOf(operator), operatorBalanceBefore + MIN_BOND);
    }

    function test_ExpiredDeclarationBondReleaseBeforeGracePeriodReverts() public {
        RaterDeclarationRegistry.RaterDeclaration memory declaration = _declaration(1, 0, PROMPT_HASH);
        declaration.expiresAtEpoch = uint64(block.timestamp + 1 days);
        bytes memory signature = _signature(declaration);

        vm.prank(rater);
        registry.submitDeclaration(declaration, signature, MIN_BOND, true);

        vm.warp(declaration.expiresAtEpoch);
        vm.expectRevert(RaterDeclarationRegistry.BondReleasePending.selector);
        registry.releaseExpiredDeclarationBond(rater);
    }

    function test_ExpiredDeclarationBondReleaseBlockedByOpenChallenge() public {
        RaterDeclarationRegistry.RaterDeclaration memory declaration = _declaration(1, 0, PROMPT_HASH);
        declaration.expiresAtEpoch = uint64(block.timestamp + 1 days);
        bytes memory signature = _signature(declaration);

        vm.prank(rater);
        registry.submitDeclaration(declaration, signature, MIN_BOND, false);

        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);

        vm.warp(uint256(declaration.expiresAtEpoch) + registry.RETIRED_DECLARATION_BOND_LOCK());
        vm.expectRevert(RaterDeclarationRegistry.OpenChallenges.selector);
        registry.releaseExpiredDeclarationBond(rater);

        registry.expireChallenge(challengeId);
        registry.releaseExpiredDeclarationBond(rater);

        assertEq(registry.activeOperatorDeclarations(operator), 0);
        assertEq(registry.operatorBondReserved(operator), 0);
    }

    function test_SustainedChallengeSlashesOperatorBondAndDemotesDeclaration() public {
        _submitDefaultDeclaration(false);

        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);

        uint256 challengerBefore = lrep.balanceOf(challenger);
        uint256 treasuryBefore = lrep.balanceOf(treasury);

        vm.prank(admin);
        registry.resolveChallenge(challengeId, true, 5_000, RESOLUTION_HASH);

        RaterDeclarationRegistry.Challenge memory challenge = registry.getChallenge(challengeId);
        assertEq(uint256(challenge.status), uint256(RaterDeclarationRegistry.ChallengeStatus.Sustained));
        assertEq(registry.operatorBond(operator), MIN_BOND / 2);
        assertEq(registry.operatorBondReserved(operator), 0);
        assertEq(lrep.balanceOf(challenger), challengerBefore + CHALLENGE_BOND + 25e6);
        assertEq(lrep.balanceOf(treasury), treasuryBefore + 25e6);
        assertEq(registry.activeOperatorDeclarations(operator), 0);

        RaterDeclarationRegistry.StoredDeclaration memory stored = registry.getDeclaration(rater);
        assertEq(uint256(stored.tier), uint256(RaterDeclarationRegistry.RaterTier.A0));
    }

    function test_RejectedChallengeSendsChallengeBondToTreasury() public {
        _submitDefaultDeclaration(false);

        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);

        uint256 treasuryBefore = lrep.balanceOf(treasury);

        vm.prank(admin);
        registry.resolveChallenge(challengeId, false, 0, RESOLUTION_HASH);

        RaterDeclarationRegistry.Challenge memory challenge = registry.getChallenge(challengeId);
        assertEq(uint256(challenge.status), uint256(RaterDeclarationRegistry.ChallengeStatus.Rejected));
        assertEq(registry.operatorBond(operator), MIN_BOND);
        assertEq(lrep.balanceOf(treasury), treasuryBefore + CHALLENGE_BOND);
        assertEq(registry.tierMultiplierBps(rater), 10_500);
        assertEq(registry.openOperatorChallenges(operator), 0);
        assertEq(registry.openDeclarationChallenges(_declarationKey(rater, 1)), 0);
    }

    function test_OpenChallengeFreezesBenefitsAndBlocksRedeclareOrRetire() public {
        _submitDefaultDeclaration(false);

        vm.prank(challenger);
        registry.openChallenge(rater, EVIDENCE_HASH);

        assertEq(registry.tierMultiplierBps(rater), 10_000);
        assertTrue(registry.hasActiveAiDeclaration(rater));

        RaterDeclarationRegistry.RaterDeclaration memory nextDeclaration = _declaration(2, 1, PROMPT_HASH);
        bytes memory nextSignature = _signature(nextDeclaration);

        vm.prank(rater);
        vm.expectRevert(RaterDeclarationRegistry.OpenChallenges.selector);
        registry.submitDeclaration(nextDeclaration, nextSignature, 0, false);

        vm.prank(rater);
        vm.expectRevert(RaterDeclarationRegistry.OpenChallenges.selector);
        registry.retireDeclaration();
    }

    function test_OpenChallengeRejectsDuplicateChallengeForSameDeclaration() public {
        _submitDefaultDeclaration(false);

        vm.prank(challenger);
        registry.openChallenge(rater, EVIDENCE_HASH);

        vm.prank(challenger);
        vm.expectRevert(RaterDeclarationRegistry.OpenChallenges.selector);
        registry.openChallenge(rater, keccak256("second-evidence"));
    }

    function test_OpenChallengeRequiresActiveDeclarationWindow() public {
        RaterDeclarationRegistry.RaterDeclaration memory futureDeclaration = _declaration(1, 0, PROMPT_HASH);
        futureDeclaration.effectiveEpoch = uint64(block.timestamp + 1 days);
        bytes memory futureSignature = _signature(futureDeclaration);

        vm.prank(rater);
        registry.submitDeclaration(futureDeclaration, futureSignature, MIN_BOND, false);

        vm.prank(challenger);
        vm.expectRevert(RaterDeclarationRegistry.InvalidChallenge.selector);
        registry.openChallenge(rater, EVIDENCE_HASH);

        vm.warp(futureDeclaration.effectiveEpoch);
        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);
        assertEq(registry.getChallenge(challengeId).expiresAt, block.timestamp + registry.challengeResolutionWindow());
    }

    function test_ExpireChallengeAfterWindowClosesLocks() public {
        _submitDefaultDeclaration(false);

        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);
        uint256 treasuryBefore = lrep.balanceOf(treasury);

        vm.warp(registry.getChallenge(challengeId).expiresAt);
        registry.expireChallenge(challengeId);

        RaterDeclarationRegistry.Challenge memory challenge = registry.getChallenge(challengeId);
        assertEq(uint256(challenge.status), uint256(RaterDeclarationRegistry.ChallengeStatus.Expired));
        assertEq(lrep.balanceOf(treasury), treasuryBefore + CHALLENGE_BOND);
        assertEq(registry.openOperatorChallenges(operator), 0);
        assertEq(registry.openDeclarationChallenges(_declarationKey(rater, 1)), 0);
        assertEq(registry.tierMultiplierBps(rater), 10_500);

        RaterDeclarationRegistry.RaterDeclaration memory nextDeclaration = _declaration(2, 1, PROMPT_HASH);
        bytes memory nextSignature = _signature(nextDeclaration);
        vm.prank(rater);
        registry.submitDeclaration(nextDeclaration, nextSignature, 0, false);
        assertEq(registry.getDeclaration(rater).declaration.version, 2);
    }

    function test_ExpireChallengeBeforeWindowReverts() public {
        _submitDefaultDeclaration(false);

        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);

        vm.expectRevert(RaterDeclarationRegistry.ChallengeResolutionPending.selector);
        registry.expireChallenge(challengeId);
    }

    function test_ExpiredChallengeCannotBeResolvedAgain() public {
        _submitDefaultDeclaration(false);

        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);

        vm.warp(registry.getChallenge(challengeId).expiresAt);

        vm.prank(admin);
        vm.expectRevert(RaterDeclarationRegistry.ChallengeResolutionExpired.selector);
        registry.resolveChallenge(challengeId, false, 0, RESOLUTION_HASH);

        registry.expireChallenge(challengeId);

        vm.prank(admin);
        vm.expectRevert(RaterDeclarationRegistry.InvalidChallenge.selector);
        registry.resolveChallenge(challengeId, false, 0, RESOLUTION_HASH);
    }

    function test_HasActiveAiDeclarationClearsAfterRetirement() public {
        _submitDefaultDeclaration(false);
        assertTrue(registry.hasActiveAiDeclaration(rater));

        vm.prank(rater);
        registry.retireDeclaration();

        assertEq(registry.tierMultiplierBps(rater), 10_000);
        assertFalse(registry.hasActiveAiDeclaration(rater));
    }

    function test_SustainedChallengeSlashesOnlyChallengedDeclarationBond() public {
        _submitDefaultDeclaration(false);

        RaterDeclarationRegistry.RaterDeclaration memory secondDeclaration =
            _declarationFor(rater2, 1, 0, keccak256("prompt-rater-2"));
        bytes memory secondSignature = _signature(secondDeclaration);

        vm.prank(rater2);
        registry.submitDeclaration(secondDeclaration, secondSignature, MIN_BOND, false);

        vm.prank(challenger);
        uint256 challengeId = registry.openChallenge(rater, EVIDENCE_HASH);

        vm.prank(admin);
        registry.resolveChallenge(challengeId, true, 10_000, RESOLUTION_HASH);

        assertEq(registry.operatorBond(operator), MIN_BOND);
        assertEq(registry.operatorBondReserved(operator), MIN_BOND);
        assertEq(registry.activeOperatorDeclarations(operator), 1);
        assertEq(uint256(registry.getDeclaration(rater).tier), uint256(RaterDeclarationRegistry.RaterTier.A0));
        assertEq(uint256(registry.getDeclaration(rater2).tier), uint256(RaterDeclarationRegistry.RaterTier.A1Unverified));
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
        return _declarationFor(rater, version, nonce, promptHash);
    }

    function _declarationFor(address declarationRater, uint32 version, uint96 nonce, bytes32 promptHash)
        internal
        view
        returns (RaterDeclarationRegistry.RaterDeclaration memory)
    {
        return RaterDeclarationRegistry.RaterDeclaration({
            rater: declarationRater,
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

    function _declarationKey(address declarationRater, uint32 version) internal pure returns (bytes32) {
        return keccak256(abi.encode(declarationRater, version));
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
