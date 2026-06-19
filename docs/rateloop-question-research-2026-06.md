# RateLoop Question Research and Seed Ideas - June 2026

This note proposes good first questions to ask on the production RateLoop deployment about RateLoop itself. The goal is twofold:

1. Seed the public feed with real examples that people can vote on.
2. Collect product feedback about positioning, onboarding, trust, buyer use cases, and rater motivation.

The strongest pattern is a short public ask with one binary judgment, a specific artifact to inspect, and a description that explains the voting criteria and, when useful, invites optional additional feedback.

## Research Signals

- RateLoop is designed for moments where AI agents or builders need outside judgment on local context, taste, evidence quality, or social judgment rather than another private poll. The core loop is ask, fund, vote and predict, reveal and settle, then use the public result. See `README.md` and `docs/use-cases-2026-06.md`.
- RateLoop's current best-fit use cases are confidential concept and creative pretesting, two-tier AI to human judgment gates, agent-purchased evidence verification, LLM-judge calibration, classic market research, and agent-to-agent work acceptance. The first seed questions should deliberately probe these claims, not only ask whether the UI is nice. See `docs/use-cases-2026-06.md`.
- Survey question quality matters. Nielsen Norman Group's survey guidance recommends keeping surveys short, using neutral and clear language, avoiding future-behavior speculation, avoiding double-barreled questions, and using mostly closed-ended prompts with optional free text for color: <https://www.nngroup.com/articles/survey-best-practices/>.
- Feedback is higher quality after a user completes or inspects a real task. NN/g's feedback guidance says "task, then ask," keep the request short, and pair closed-ended input with an optional comment field: <https://www.nngroup.com/articles/user-feedback/>.
- Prediction and forecasting communities emphasize unambiguous question terms. Metaculus' guidance says good questions should be clearly specified so readers can agree what is included and excluded; binary questions work when the event or judgment can resolve as yes/no: <https://www.metaculus.com/faq/>.
- Product metrics should connect to specific product goals. Google's HEART framework maps product goals to user-centered metrics such as happiness, engagement, adoption, retention, and task success: <https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/>.
- PMF-style questioning can be useful after people have actually used the product. The Superhuman PMF process asks recent users how disappointed they would be if they could no longer use the product, then asks who benefits, what main benefit they get, and how to improve it: <https://review.firstround.com/how-superhuman-built-an-engine-to-find-product-market-fit/>.

## Question Design Rubric

Use this shape for the first RateLoop-about-RateLoop asks:

- **One judgment per question.** Avoid "clear and trustworthy" unless it is split into two asks.
- **Anchor each vote to a concrete artifact.** Use the homepage, `/ask`, `/docs/ai`, a screenshot, a short scenario, or a specific result page.
- **Prefer observable present/past behavior over future promises.** "Have you had this problem in the last 30 days?" is better than "Would you use this someday?"
- **Make UP and DOWN obvious.** A voter should know what an upvote means without reading your mind.
- **Use the description for feedback guidance.** RateLoop does not have a separate feedback-prompt field today. The description should define UP/DOWN and can add one short sentence inviting optional notes about what was confusing, missing, or compelling.
- **Keep early asks public and non-sensitive.** These are examples for the public feed, so avoid confidential strategy, undisclosed metrics, private roadmaps, or security-sensitive operational details.
- **Use a small, consistent launch tier.** For initial seed activity, use 3 to 5 required voters, a low USDC bounty, and an optional feedback bonus on the questions where the "why" matters.

Bad seed ask:

> Is RateLoop useful and trustworthy?

Better split:

- After reading the homepage, is RateLoop's core value clear enough to explain in one sentence?
- After reading the trust-model section, would you trust a settled RateLoop result as advisory input for a low-stakes product decision?

## Category Defaults

The seeded category order in `packages/foundry/script/Deploy.s.sol` is:

| Id | Category | Good for these RateLoop seed asks |
| --- | --- | --- |
| 1 | Products | Broad product value, pricing, use-case interest |
| 3 | Software | App UX, wallet flow, developer tools, smart contracts, onboarding |
| 5 | Design | Homepage, visual hierarchy, product screenshots, brand clarity |
| 6 | AI Answers | Agent answer quality, source support, LLM-judge replacement, AI-rater use |
| 7 | Text | Docs, copy, explanation, examples, whitepaper clarity |
| 8 | General | Broad taste/usefulness questions when no category fits |

Use tags such as `rateloop`, `dogfood`, `homepage`, `onboarding`, `trust`, `agent`, `use-case`, `pricing`, `docs`, `wallet`, `rater-feedback`.

## Recommended First Batch

These are the best first public asks because they produce example content and product learning at the same time.

| Priority | Question title | Context | Category/tags | What this learns | Description note |
| --- | --- | --- | --- | --- | --- |
| 1 | After reading the homepage, is RateLoop's core value clear enough to explain in one sentence? | `https://www.rateloop.ai/` | Design or Text; `rateloop,homepage,positioning` | Whether the first impression explains the product | Define UP as "clear enough to explain back." Invite optional notes on the phrase or missing example that affected the vote. |
| 2 | Does the homepage make it obvious who should ask the first RateLoop question? | Homepage | Products; `rateloop,homepage,audience` | Whether the buyer persona is legible | Define UP as "a first-time visitor can identify the intended asker." Invite optional notes on which user type the page seems built for. |
| 3 | After reading `/docs/ai`, would an AI-agent builder know when to ask RateLoop instead of running another LLM judge? | `https://www.rateloop.ai/docs/ai` | AI Answers; `rateloop,agent,docs,llm-judge` | Whether the agent positioning lands | Define UP as "the doc gives a concrete escalation moment." Invite optional notes on the missing example that would make it clearer. |
| 4 | Is the RateLoop voting mechanism explanation clear enough to understand why voters predict the crowd share? | `/docs/how-it-works` or whitepaper excerpt | Text; `rateloop,voting,trust,docs` | Whether prediction-plus-vote is understandable | Define UP as "the prediction step makes sense after reading." Invite optional notes on the mechanism detail that remains unclear. |
| 5 | Would you trust a settled RateLoop result as advisory input for a low-stakes product decision? | Short scenario: choose between two landing-page variants or accept/reject generated copy | Products; `rateloop,trust,decision-support` | Whether the trust promise is credible for low-risk decisions | Define UP as "credible enough for advisory use, not final settlement." Invite optional notes on what would increase trust. |
| 6 | Does the `/ask` flow look clear enough to fund a first 1 USDC test question? | `https://www.rateloop.ai/ask` or screenshot | Software; `rateloop,ask-flow,wallet,onboarding` | Whether the first paid ask is approachable | Define UP as "you can see the next action before funding." Invite optional notes on the step that would cause hesitation. |
| 7 | Is "ask humans when an agent should not guess" a compelling product promise? | Homepage or `/docs/ai` | Products; `rateloop,agent,positioning` | Whether the core tagline is strong | Define UP as "the promise makes you want an example." Invite optional notes on the first use case that comes to mind. |
| 8 | Have you personally had a situation in the last 30 days where outside judgment on AI output would have helped? | Scenario examples: source check, safety review, design choice, send/no-send | AI Answers; `rateloop,agent,use-case` | Concrete user pain, not hypothetical usage | Define UP as "yes, a real recent situation." Invite optional notes with a one-sentence description if the voter is comfortable sharing. |
| 9 | Would a 3 to 5 rater RateLoop round be enough signal to choose between two low-stakes landing-page variants? | Simple A/B scenario | Design; `rateloop,creative-testing,landing-page` | Whether small rounds feel sufficient for creative pretesting | Define UP as "enough for low-stakes iteration." Invite optional notes on what decision would require more raters. |
| 10 | Is a feedback bonus for useful written notes easy to understand from the current UI/docs? | `/ask` or relevant docs | Software; `rateloop,feedback-bonus,rater` | Whether the feedback bonus concept is legible | Define UP as "you understand why and how useful notes can be rewarded." Invite optional notes on what would make writing feedback feel worthwhile. |
| 11 | Would Base wallet setup be acceptable friction for a first product-feedback ask? | `/ask` payment/wallet step or short screenshot | Software; `rateloop,base,wallet,activation` | Whether chain UX is a blocker | Define UP as "the wallet step would not stop a first test." Invite optional notes on the funding or signing step that feels riskiest. |
| 12 | After viewing a settled result page, is the output actionable enough for an asker to decide what to do next? | Use the first settled RateLoop result URL once available | Software; `rateloop,result-page,actionability` | Whether the result page is useful, not only interesting | Define UP as "the result suggests a next action." Invite optional notes on the summary or evidence that would make it more actionable. |

## Product Feedback Question Bank

### Positioning and First Impression

1. After reading the homepage, is RateLoop's core value clear enough to explain in one sentence?
2. Does the homepage make RateLoop feel more like a product-feedback tool than a generic poll?
3. Does the phrase "open rating protocol" help you understand RateLoop?
4. Is "ask humans when an agent should not guess" more compelling than "prediction-scored rating protocol"?
5. Does the homepage give enough concrete examples of what to ask first?
6. After reading the homepage, would you know whether RateLoop is for agents, founders, voters, or all three?
7. Does RateLoop's first screen make the product feel alive enough to vote on something?

### Onboarding and Asking

1. Does the `/ask` page make the next step obvious before connecting a wallet?
2. Does the ask form make it clear what voters will judge?
3. Would the current ask flow give you enough confidence to fund a first 1 USDC test question?
4. Is the distinction between bounty and feedback bonus understandable?
5. Does the ask page make it clear which parts of the question will be public?
6. Is the current Base wallet/funding flow acceptable for a first test ask?
7. Would a "starter question template" make you more likely to submit your first ask?
8. Would you rather start from an example question than a blank ask form?
9. Does the UI make it clear when a question should include a screenshot or URL?

### Voting and Rater Motivation

1. Does the voting screen make it clear what UP means for this question?
2. Is the crowd-share prediction input understandable after one read?
3. Does the commit-reveal explanation make voting feel more trustworthy?
4. Would you leave written feedback if a small feedback bonus were available?
5. Does the rater flow explain why honest independent judgment is rewarded?
6. Is zero-LREP advisory voting understandable enough for first-time raters?
7. Would seeing more example questions make you more comfortable casting a first vote?
8. Does the result page make it clear how the crowd decided?

### Trust and Mechanism

1. Is RateLoop's vote-plus-prediction mechanism meaningfully more trustworthy than a normal thumbs-up/down poll for product feedback?
2. Would you trust a settled RateLoop result as advisory input for a low-stakes product decision?
3. Does the current documentation explain the difference between advisory signal and financial settlement well enough?
4. Does the public result page provide enough evidence to audit the outcome at a high level?
5. Does the mechanism feel too complex for the value it provides?
6. Is the "public, auditable feedback round" story more compelling than a private survey link?
7. Does the use of Base mainnet increase, decrease, or not affect your trust in RateLoop?

### Agent Use Cases

1. After reading `/docs/ai`, would an AI-agent builder know when to ask RateLoop instead of running another LLM judge?
2. Have you personally had a situation in the last 30 days where outside judgment on AI output would have helped?
3. Would you use a RateLoop round to check whether a generated answer is good enough to send?
4. Would you use a RateLoop round to check whether cited sources support an AI-generated answer?
5. Would a RateLoop result be useful as a pause-before-send gate for agent outreach?
6. Would an agent-to-human feedback loop be more credible if the result included written rater notes?
7. Would you trust a small independent panel more than one self-run LLM judge for subjective content quality?
8. Would you pay a small amount for outside judgment before an agent takes an irreversible action?

### Use-Case Discovery

1. Would a 3 to 5 rater RateLoop round be enough signal to choose between two low-stakes landing-page variants?
2. Would RateLoop be useful for deciding whether a generated product mockup is worth iterating?
3. Would RateLoop be useful for early concept testing before building a feature?
4. Would RateLoop be useful for checking whether developer docs are clear enough?
5. Would RateLoop be useful for deciding whether a proposal is ready to share with a community?
6. Would RateLoop be useful for verifying whether a source supports a claim?
7. Would RateLoop be useful for choosing between names, taglines, or positioning statements?
8. Would RateLoop be useful for testing whether a product page builds enough trust?
9. Would RateLoop be useful for reviewing an agent execution trace before accepting the work?
10. Would RateLoop be useful for rating AI-written community notes or fact checks?

### Pricing and Friction

1. Would a 1 USDC starter bounty feel reasonable for a first public product-feedback question?
2. Would you expect better feedback from 3 raters with a bonus for notes or 8 raters with no bonus?
3. Would wallet setup stop you from asking your first question?
4. Would a sponsored first ask make you more likely to try RateLoop?
5. Would you rather pay for faster results or more voters on a first product-feedback ask?
6. Is it clear what the asker gets back after paying for a RateLoop round?
7. Does paying in USDC make RateLoop feel more credible or more intimidating?

### Docs and Copy

1. Does `/docs/how-it-works` explain the RateLoop loop without assuming protocol knowledge?
2. Does `/docs/ai` contain enough information for an agent developer to build a first integration?
3. Does the whitepaper make RateLoop feel more credible, or is it too much for first-time users?
4. Is the smart-contract docs page useful to a technical evaluator deciding whether to trust the deployment?
5. Are there enough concrete examples in the docs?
6. Does the docs navigation make it clear where to start?
7. Does the term "Feedback Bonus" explain itself?
8. Does the term "LREP" need a shorter first-time explanation near voting and asking flows?

### Private Context and Confidentiality

These are useful after public dogfooding starts, but only if the context does not reveal anything sensitive.

1. Would private context make you more likely to ask about an unreleased product idea?
2. Is the difference between public and gated context clear from the current docs?
3. Would watermarked, access-logged private context feel sufficient for low-stakes concept testing?
4. Would you ask a public RateLoop question about a product idea if the brand and sensitive details were removed?
5. Does confidentiality make RateLoop feel more useful for startup/product teams?

## Best Questions to Actually Post First

If you want a tight first wave, post these eight:

1. After reading the homepage, is RateLoop's core value clear enough to explain in one sentence?
2. Does the homepage make it obvious who should ask the first RateLoop question?
3. After reading `/docs/ai`, would an AI-agent builder know when to ask RateLoop instead of running another LLM judge?
4. Is RateLoop's vote-plus-prediction mechanism meaningfully more trustworthy than a normal thumbs-up/down poll for product feedback?
5. Does the `/ask` page make the next step obvious before connecting a wallet?
6. Would a 3 to 5 rater RateLoop round be enough signal to choose between two low-stakes landing-page variants?
7. Have you personally had a situation in the last 30 days where outside judgment on AI output would have helped?
8. Would a 1 USDC starter bounty feel reasonable for a first public product-feedback question?

This first wave covers positioning, audience, agent use, trust, onboarding, use-case demand, pain evidence, and pricing. It also gives new voters a variety of question types without requiring private context.

## Suggested Ask Template

Use this structure when submitting the first questions:

```json
{
  "chainId": 8453,
  "templateId": "generic_rating",
  "bounty": {
    "asset": "USDC",
    "amount": "1000000",
    "requiredVoters": "3",
    "requiredSettledRounds": "1",
    "bountyWindowSeconds": "1200",
    "feedbackWindowSeconds": "86400"
  },
  "feedbackBonus": {
    "asset": "USDC",
    "amount": "1000000",
    "feedbackClosesAt": "<at least 24h after expected settlement>"
  },
  "question": {
    "templateId": "generic_rating",
    "title": "After reading the homepage, is RateLoop's core value clear enough to explain in one sentence?",
    "description": "Review the linked RateLoop homepage. Vote UP only if a first-time visitor would understand what RateLoop is for and could explain the core value in one sentence. Vote DOWN if the page is interesting but still unclear, too abstract, or missing a concrete first action. If you leave optional feedback, mention the phrase or missing example that most affected your vote.",
    "contextUrl": "https://www.rateloop.ai/",
    "categoryId": "7",
    "tags": ["rateloop", "dogfood", "homepage", "positioning"]
  }
}
```

Adjust the category per question. Use `Text` for docs/copy, `Software` for flow and wallet questions, `Design` for layout/visual feedback, `AI Answers` for agent and source-check questions, and `Products` for pricing/use-case/value questions.

## Description Notes to Reuse

There is no separate feedback-prompt field today. Fold one short note into the existing question description when additional feedback would be useful:

- If you leave optional feedback, mention the single change that would most improve this page.
- If you leave optional feedback, mention the phrase, concept, or step that was most confusing.
- If you leave optional feedback, mention the first use case that came to mind.
- If you leave optional feedback, mention what would make you trust the result more.
- If you leave optional feedback, mention what would make you more likely to ask your first question.
- If you leave optional feedback, mention what would make you more likely to vote and leave a note.
- If this seems useful, optional feedback can name the exact decision you would use it for.

## Interpretation Notes

- Treat early 3-rater rounds as directional dogfood, not statistically final research.
- Look for disagreement. A 55/45 split with good notes may be more useful than a unanimous answer with no rationale.
- Do not overreact to broad negative feedback from people outside the likely buyer/rater segment. Segment notes by self-reported role when possible.
- Re-ask important questions after changing the page or flow. RateLoop is especially good at showing whether the next version moves the crowd.
- Prefer a public result URL for every learning you share. The dogfood value is not just the answer; it is showing how a RateLoop answer looks in the wild.
