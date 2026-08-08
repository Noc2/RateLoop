# Operational monitoring — what exists, and the two steps that are yours

The DPA's Annex 1 claims RateLoop monitors operational failures. Until now nothing
did. Failures were *recorded* — the hash-chained security audit is real and
verifiable — but no one was notified, and Vercel's log buffer rolls, so a failure
at 02:00 on a Sunday left nothing behind by Monday.

This document covers the half that is code, which is done, and the half that is a
dashboard, which is not.

## What the application now emits

Every operator-actionable failure prints one JSON line to stderr with a stable
`event` field. That field is the thing an alert rule matches on. Before this,
eleven such sites used three different prefix conventions — `[stripe-webhook]`,
`[tokenless-notifications]`, and bare snake_case — so an alert meant a regex per
message that broke whenever somebody edited the wording. A test now fails the
build if a bare `console.error("…")` appears in a failure path.

Two shapes, both from `packages/nextjs/lib/security/redactedErrorLog.ts`:

```jsonc
// logRedactedError — something threw
{ "event": "stripe_webhook_processing_failed", "errorCode": "TypeError",
  "errorDigest": "sha256:…", "eventId": "evt_1", "eventType": "invoice.paid" }

// logOperatorAttention — nothing threw, but a human is needed
{ "event": "stripe_webhook_needs_operator_attention", "operatorAttention": true,
  "eventId": "evt_1", "attention": "…" }
```

**The error payload is never logged.** A `pg` unique violation carries the
conflicting value in `detail`, and mail transport errors carry the recipient
address, so only the constructor name and a digest of `name:message` survive.
The digest is stable, which is what lets you count occurrences of one failure
without retaining what it was about.

### The events worth waking someone for

| `event` | Meaning |
| --- | --- |
| `security_audit_append_failure` | The hash-chained audit could not be written. Treat as urgent: it is the record everything else is verified against. |
| `stripe_webhook_needs_operator_attention` | A billing event processed but needs a human decision. |
| `stripe_webhook_processing_failed` | A billing event did not process. Stripe retries, so repeats matter more than one. |
| `stripe_webhook_signature_verification_failed` | Either a misconfigured secret or someone probing the endpoint. |
| `settlement_notices_deferred` | Reviewers were not told about a settlement. |
| `private_review_evidence_inline_projection_failed` | The evidence a finished review holds did not project. The queue retries; sustained failures mean the retry path is also failing. |
| `private_review_rationale_aggregate_unavailable` | Usually a rotated vault key. Reviews still finalise; rationales are withheld. |
| `csp_violation` | Either an injection attempt or, more often, a policy too tight for shipped code. |

## The two steps that are yours

Neither is code, and I cannot do either: one needs an account, the other a
dashboard.

**1. Point a log drain at a hosted sink.** Vercel → project → Settings → Log
Drains. Better Stack and Axiom both have free tiers that comfortably hold this
volume. Choose the `rateloop-tokenless` project only.

**2. Create one alert rule**, then a second if you want billing separated:

```
event = "security_audit_append_failure"  OR  operatorAttention = true
```

Deliver it somewhere you actually read. An alert nobody sees is the same as no
alert, and it is worse in an audit because you will have claimed it works.

## Why this makes the DPA claim true

"Monitored operational failures" is demonstrable once a drain and a rule exist:
you can show a DPO the rule, its history, and a test alert. That is the standard
a German DPO applies — they ask to see the last one that fired, not the
architecture. Until step 2 is done the claim in Annex 1 remains unevidenced, and
[`german-outreach-readiness-2026-08.md`](german-outreach-readiness-2026-08.md)
should keep saying so.

## What this deliberately is not

Not error tracking. There are no stack traces, no release correlation, no
grouping beyond the digest. `@sentry/nextjs` is roughly half a day and would give
all three. This was chosen first because it makes the contractual claim true for
about two hours of work and no code, and because a drain is useful whatever you
add later.
