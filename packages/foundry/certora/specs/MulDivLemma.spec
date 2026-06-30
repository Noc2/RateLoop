/*
 * MulDivLemma.spec — reusable nonlinear multiply-then-divide bound.
 *
 * Proves the floor-division primitive `(a * b) / c <= a` for `b <= c`, `c != 0`
 * (and the exact corollary `(a * c) / c == a`). This is the single arithmetic
 * fact that every "a proportional share never exceeds its pool/cap" conservation
 * property in the protocol reduces to:
 *
 *   - RewardMath.calculateVoterReward = (voterPool * stake) / totalStake
 *         <= voterPool           when stake <= totalStake   (RoundRewardDistributor)
 *   - LaunchDistributionPool cap  = (fullCap * bps) / 10000
 *         <= fullCap             when bps  <= 10000          (Track B)
 *
 * The default *linear* SMT backend cannot discharge this nonlinear
 * multiply-then-divide directly, so the conf enables nonlinear arithmetic via
 * prover_args.
 *
 * The rule calls no contract function: it is pure CVL integer arithmetic over the
 * mathematical integers (to_mathint avoids any 256-bit wraparound, so the bound is
 * the true mathematical one, which equals the EVM result on the non-overflowing
 * inputs these formulas are fed). MathHarness is named only because `verify` needs
 * a contract to attach to.
 */

methods {
    // No contract methods are exercised; the lemma is self-contained arithmetic.
}

// Floor of (a*b)/c is at most a whenever b <= c (c != 0). The workhorse lemma.
rule mulDivAtMost(uint256 a, uint256 b, uint256 c) {
    require c != 0;
    require b <= c;
    mathint product = to_mathint(a) * to_mathint(b);
    assert product / to_mathint(c) <= to_mathint(a);
}

// Exact corollary: a full-fraction allocation (b == c) returns a unchanged. This
// is the boundary the cap/pool clamps lean on (full cap, 100% bps, last claimant).
rule mulDivExactWhenFull(uint256 a, uint256 c) {
    require c != 0;
    mathint product = to_mathint(a) * to_mathint(c);
    assert product / to_mathint(c) == to_mathint(a);
}

// Monotonicity in the numerator factor: a larger share weight never yields a
// smaller payout. Underpins "a claimant's reward tracks its weight" reasoning.
rule mulDivMonotoneInB(uint256 a, uint256 b1, uint256 b2, uint256 c) {
    require c != 0;
    require b1 <= b2;
    mathint p1 = to_mathint(a) * to_mathint(b1);
    mathint p2 = to_mathint(a) * to_mathint(b2);
    assert p1 / to_mathint(c) <= p2 / to_mathint(c);
}
