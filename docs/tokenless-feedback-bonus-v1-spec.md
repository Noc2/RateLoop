# Tokenless Feedback Bonus v1

Status: design of record for the optional, human-awarded Feedback Bonus. This pool is separate from the guaranteed review bounty, the protocol-controlled response-quality allocation, and any surprisingly-popular incentive.

## Product contract

A requester may add a Feedback Bonus when written feedback would make a review more useful. The control is optional and off by default. It is available whether the guaranteed review bounty is on or off:

| Guaranteed bounty | Feedback Bonus | Result |
| --- | --- | --- |
| Off | Off | Invited unpaid review. |
| On | Off | Guaranteed USDC review compensation only. |
| Off | On | Review is unpaid unless the human awarder later selects the feedback for the prefunded bonus. |
| On | On | Guaranteed compensation and a separate possible human-awarded bonus. |

The two controls never imply, replace, or fund one another. The automatic RBTS response-quality allocation remains part of guaranteed paid-review economics and is never labelled Feedback Bonus.

## Setup

Enabling the bonus freezes these terms before delivery:

- USDC pool amount;
- feedback close and award deadlines;
- the review and content commitments;
- the admission-policy commitment;
- the refund recipient; and
- the human awarder.

The requester is the default funder, refund recipient, and awarder. Purpose-bound prepaid funding may use a distinct payer, and the requester may designate another authenticated human as awarder. An agent may prepare these exact terms within its grant, but it may never designate itself, select winning feedback, or execute an award.

The maximum bonus pool is included in owner consent and delegation spend caps. Funding completes before the review is delivered. If either the guaranteed bounty or Feedback Bonus can pay a reviewer, paid-task eligibility—including payout setup and required legal checks—must complete before assignment or issuance of a pool-specific voucher.

## Eligible feedback

Each assigned human may register at most one timely response commitment for the pool. A credential-issuer voucher binds the one-time vote key, review, content, pool, admission policy, nullifier, issuer epoch, and expiry. The vote key separately signs the response commitment and payout commitment. Private feedback uses a tenant-bound commitment; plaintext and private artifact locations never enter public chain state.

Registration proves only eligibility and timing. It does not promise an award. It cannot reduce or revoke guaranteed compensation for accepted review work.

## Human award flow

After the feedback window closes, the configured human awarder sees the eligible written responses and may use the restored RateLoop action, **Award this feedback**. The old interaction is preserved: the awarder chooses selected useful feedback and the USDC amount for each selection, up to the remaining pool. A response and independent reviewer can each be awarded at most once from a pool.

Awards are never selected by an agent, an automatic quality score, moderation, a majority result, or the platform operator. The immutable payout commitment prevents the awarder or operator from redirecting the selected reviewer’s funds.

After the disclosed award deadline, anyone may finalize the unawarded remainder as pull credit for the immutable refund recipient. Finalization performs no token transfer, so a paused, blacklisted, or reverting recipient cannot block the pool's terminal transition. The credited funder later selects a withdrawal destination. There is no operator sweep, treasury forfeiture, pause, upgrade, or administrative redirection path.

## Custody and failure behavior

The Feedback Bonus uses a dedicated immutable escrow and separate accounting from the panel fund core. Bonus funds cannot satisfy guaranteed bounty, fee, reserve, or accepted-work liabilities, and panel funds cannot satisfy bonus awards. Exact-transfer checks reject fee-on-transfer behavior.

Service and indexer operations are idempotent and reconcile every pool creation, response registration, award, and refund against chain events. A failed relay never becomes success without the exact receipt. A fully funded pool remains awardable or refundable even if RateLoop application infrastructure is unavailable.

## Owner-facing language

Use these exact distinctions throughout setup, agent summaries, receipts, rater tasks, and award screens:

- **Guaranteed bounty** — compensation promised for eligible accepted review work.
- **Response quality reward** — deterministic protocol-controlled portion of paid-review economics.
- **Feedback Bonus** — optional, separately prefunded amount that a human may award afterward to selected written feedback.
