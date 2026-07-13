# How RateLoop works

1. A funder chooses a binary or A/B question, audience tier, and budget.
2. The quote itemizes the rater bounty, platform fee, and maximum accepted-work reserve.
3. Eligible raters submit a sealed answer and one prediction bucket without staking funds.
4. Settlement freezes the reveal set, processes weights restart-safely, and finalizes before claims.
5. Zero-commit rounds refund fully. Under-quorum or beacon-failure rounds refund bounty and fee while the reserve compensates accepted work.

There is no funder cancellation after the first accepted paid commit. A normal claim links the one-time vote key to its payout address.
