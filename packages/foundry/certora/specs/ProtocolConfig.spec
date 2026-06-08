/*
 * ProtocolConfig.spec — Phase 10 (Track E).
 *
 * Verification target: contracts/ProtocolConfig.sol (verified directly).
 * Run with:           certoraRun certora/confs/protocol-config.conf
 *
 * ProtocolConfig is the governance-controlled address book + parameter store for the
 * protocol. Its security rests on every mutation being role-gated. This proves that the
 * address-book setters cannot be called without the required role:
 *   - the address-book / parameter setters require CONFIG_ROLE,
 *   - treasury rotation requires TREASURY_ROLE,
 *   - replacing a revoked reward distributor requires DEFAULT_ADMIN_ROLE (higher bar).
 *
 * Each `onlyRole` modifier runs before any body logic / external validation call, so the
 * "succeeded => caller holds the role" implication is a pure access-control gate that
 * needs no modeling of the validated dependencies.
 */

methods {
    function hasRole(bytes32, address) external returns (bool) envfree;
    function CONFIG_ROLE() external returns (bytes32) envfree;
    function TREASURY_ROLE() external returns (bytes32) envfree;
    function DEFAULT_ADMIN_ROLE() external returns (bytes32) envfree;

    // Dependency-validation calls in the setters are irrelevant to the access gate.
    function _.votingEngine() external => NONDET;
    function _.registry() external => NONDET;
    function _.lrepToken() external => NONDET;
    function _.claimAccountingStarted() external => NONDET;
    function _.authorizedCallers(address) external => NONDET;
    function _.isCategory(uint256) external => NONDET;
    function _.STAKE_AMOUNT() external => NONDET;
    function _.protocolConfig() external => NONDET;
}

// Reward-distributor registration requires CONFIG_ROLE.
rule setRewardDistributorRequiresConfigRole(env e, address value) {
    setRewardDistributor@withrevert(e, value);
    assert !lastReverted => hasRole(CONFIG_ROLE(), e.msg.sender);
}

// Revoking a reward distributor requires CONFIG_ROLE.
rule revokeRewardDistributorRequiresConfigRole(env e, address value) {
    revokeRewardDistributor@withrevert(e, value);
    assert !lastReverted => hasRole(CONFIG_ROLE(), e.msg.sender);
}

// Replacing a revoked reward distributor is a higher-privilege action: DEFAULT_ADMIN_ROLE.
rule replaceRevokedRewardDistributorRequiresAdminRole(env e, address oldValue, address newValue) {
    replaceRevokedRewardDistributor@withrevert(e, oldValue, newValue);
    assert !lastReverted => hasRole(DEFAULT_ADMIN_ROLE(), e.msg.sender);
}

// Treasury rotation requires TREASURY_ROLE.
rule setTreasuryRequiresTreasuryRole(env e, address value) {
    setTreasury@withrevert(e, value);
    assert !lastReverted => hasRole(TREASURY_ROLE(), e.msg.sender);
}

// The rater-registry pointer is CONFIG_ROLE-gated (representative of the address book).
rule setRaterRegistryRequiresConfigRole(env e, address value) {
    setRaterRegistry@withrevert(e, value);
    assert !lastReverted => hasRole(CONFIG_ROLE(), e.msg.sender);
}

// The frontend-registry pointer is CONFIG_ROLE-gated.
rule setFrontendRegistryRequiresConfigRole(env e, address value) {
    setFrontendRegistry@withrevert(e, value);
    assert !lastReverted => hasRole(CONFIG_ROLE(), e.msg.sender);
}
