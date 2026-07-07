# RateLoop World ID and Agent Growth Strategy

Date: 2026-07-07

This document complements `docs/launch-plan-2026-07.md`. The launch plan covers channels and sequencing; this note focuses on how to persuade two high-leverage audiences:

- World ID users who can become verified human raters.
- People and teams that run AI agents and need external judgment.

## Executive take

The strongest growth wedge is not "get more people to use a crypto app." It is:

> Agents need judgment they cannot generate themselves. World ID users have a scarce proof-of-human credential that makes their judgment more valuable. RateLoop should pay the second group to serve the first.

That gives RateLoop a clean two-sided story:

1. Agent operators fund bounded questions because their agents need a verified, auditable outside signal before acting.
2. World ID users sign up because their verified humanity turns into paid rating work, not because they are chasing a token.
3. Settled results become public proof that attracts more agent operators.
4. More agent-funded bounties make the rater side more attractive.

The product copy should lead with "paid judgment for agents" and "verified humans earn for useful ratings." Keep LREP and mechanism detail secondary until the user asks why the system is credible.

## Research signals

### World is explicitly moving toward the agent trust problem

World's June 24, 2026 AgentKit post says AI agents can now act on behalf of people and positions World ID as the layer that proves the agent is delegated by a real human. The same post names MCP clients like Codex, Cursor, VS Code, Claude Code, Hermes, and OpenClaw as supported agent clients. That is directly adjacent to RateLoop's agent-facing MCP and browser handoff surface.

Implication: pitch RateLoop as the next step after "human-backed agents": not only can an agent prove it represents a human, it can also pay verified humans for judgment when it should not decide alone.

### World App is a real distribution channel, but trust framing matters

World's Mini Apps docs describe Mini Apps as web apps inside World App that give small and medium developers access to a distribution channel of millions of users, with World ID and wallet UX built in. The World ID page emphasizes proof of unique humanity without revealing personal information, one-person-one-account guarantees, and use cases such as verified polls, shopping, dating, gaming, and social communities.

Implication: a RateLoop companion Mini App should be a lightweight rater acquisition and verification funnel, not a full clone of the Base web app. Use it to let a verified user understand the work, verify, rate a first seeded question, and deep link back to the main app for wallet/bounty flows where needed.

### The World Mini Apps growth playbook maps cleanly to RateLoop

World's own growth docs recommend four levers: invites and viral loops, gamification, retention notifications, and lean analytics. The recommended metrics are signup to first value, D1/D7 retention, invite acceptance, and push open rate. The docs also warn to keep events lean and to optimize only the bottleneck.

Implication: RateLoop should avoid broad "community growth" and instrument the rater funnel like a marketplace:

- `signup`
- `world_id_verified`
- `first_rating_submitted`
- `first_reward_claimable`
- `invite_sent`
- `invite_accepted`
- `notification_open`
- `agent_ask_created`

### Agent operators have demand, but controls and quality are the blocker

LangChain's State of AI Agents report surveyed over 1,300 professionals and reported that 51% already had agents in production, 78% planned production agents soon, and the top agent use cases included research/summarization and personal productivity. The same report says teams care heavily about tracing, guardrails, offline evaluation, human checking, and human approval for significant actions.

Implication: do not sell RateLoop as "yet another eval tool." Sell it as an external judgment gate for moments where self-evaluation is not enough: publish, merge, buy, send, claim, recommend, rank, or accept work.

### x402 makes agent-paid judgment easier to explain

x402 positions itself as an open standard for internet-native payments and explicitly frames the old signup/API-key/payment workflow as a bad fit for agents. Its current homepage reports recent transaction volume, buyers, and sellers, and describes agentic payments as a primary use case.

Implication: RateLoop should list and demonstrate its paid ask endpoints anywhere x402 builders discover services. The message is: "An agent can pay RateLoop for a bounded human judgment round the same way it pays any other x402 service."

## How to convince World ID users

### 1. Lead with useful paid work, not crypto upside

Bad pitch:

> Earn LREP by joining RateLoop.

Better pitch:

> Your verified humanity lets agents and builders pay you for judgment only real people can provide.

The first sounds like an airdrop or farming campaign. The second makes the user the scarce supplier.

Recommended landing copy:

> RateLoop pays verified humans to rate bounded questions from builders and AI agents. Verify once, rate when a bounty matches you, and earn for useful judgment.

### 2. Make the first session one concrete job

World ID users should not land in a protocol explainer. They should see one job card:

> Rate this in 90 seconds: "Would this AI agent's answer be good enough to send to a customer?"

First-session flow:

1. Open World App Mini App or mobile web entry.
2. Show one live, low-stakes, readable question.
3. Explain reward eligibility in one sentence.
4. Verify with World ID if needed.
5. Submit rating and prediction.
6. Ask for optional written feedback only when a feedback bonus exists.
7. Show "what happens next" with settlement timing and claim path.

The first value event is not account creation. It is `first_rating_submitted`.

### 3. Create verified-only agent bounties

Seed questions should visibly come from real agent workflows:

- "Should this agent send the proposed email?"
- "Which generated landing-page hero is more credible?"
- "Does this source support the agent's claim?"
- "Would you trust this agent to book the cheaper itinerary?"
- "Is this support reply good enough to send?"

World ID users then understand why their humanity matters. They are not rating generic content; they are helping agents make better decisions.

### 4. Use capped referral rewards after real participation

A good referral loop:

> Invite another verified human. You both receive a small launch recognition only after the invited person submits a valid first rating and the round settles.

Rules:

- Cap lifetime referral rewards.
- Require World ID verification.
- Require a genuine first rating, not only signup.
- Delay reward until settlement.
- Do not frame it as an airdrop.

This matches the World Mini Apps playbook's two-sided rewards while reducing farming.

### 5. Add light rater progression

Use progression to make the work feel legible:

- "First useful rating" badge.
- "3 settled ratings" badge.
- "Verified agent-feedback rater" badge.
- Weekly streak for rating at least one eligible ask.
- Accuracy/truthfulness-oriented stats where the mechanism supports them.

Avoid heavy leaderboards at launch unless they are scoped to fair one-person-one-account cohorts. Public top earners can attract farmers before the system has enough volume and fraud controls.

### 6. Use notifications only for high-intent moments

World's notification guidance is strict: trigger-based beats broadcast, start at no more than one push per day, and maintain strong open rates.

Good notification triggers:

- "A verified-only agent question has a $X bounty."
- "Your rating round settled. Reward is claimable."
- "Your streak expires today."
- "Someone you invited completed their first settled rating."

Avoid generic "come back to RateLoop" pushes.

### 7. Address privacy up front

World users may be sensitive to biometric and crypto concerns. RateLoop copy should say:

- RateLoop asks for a proof, not biometric data.
- RateLoop does not need a user's name, phone number, or social profile for a basic verified-human rating.
- World ID proof is used to enforce one-human participation and prevent sybil farming.
- Payment/reward availability can depend on geography, chain support, and bounty terms.

## How to convince people who run AI agents

### 1. Sell a decision gate, not a community

Agent operators do not wake up wanting a "rating community." They want fewer bad autonomous actions.

Recommended pitch:

> Before your agent publishes, spends, merges, recommends, or accepts work, ask RateLoop for a bounded external judgment round.

Three productized asks:

- **Human eval API:** pay verified humans to score an output or compare two outputs.
- **Agent action gate:** pause before a risky action and continue only if the settled result passes a threshold.
- **Agent-to-agent acceptance oracle:** buyer and seller agents use a third-party RateLoop round before accepting paid work.

### 2. Create copy-paste starter packs

Build and publish one-page examples that agent operators can try in under 10 minutes:

- Codex: "Ask verified humans to review this PR description before publishing."
- Cursor/Claude Code: "Create a RateLoop handoff for a UX screenshot."
- Browserbase/Exa style agents: "Ask whether a found source supports the claim."
- CI: "Block release if the RateLoop result says the answer is not customer-ready."
- x402: "Call a paid RateLoop ask endpoint from an agent wallet."

Each starter pack should include:

- The exact bounded question.
- A minimal JSON ask payload.
- `yarn agents:sandbox`.
- `yarn agents:quote`.
- Browser handoff for human wallet approval.
- How to poll `rateloop_get_result`.

### 3. Make the first agent use case painfully specific

The broad category "human feedback for AI" is too vague. Pick one wedge:

> Agent output acceptance before a public/customer-visible action.

This wedge is urgent, easy to understand, and fits the control concerns in the agent market. Later, expand into eval datasets, source-support checks, and agent-commerce acceptance.

### 4. Put RateLoop where agent builders already discover tools

Priority listings and partnerships:

- x402 ecosystem and Bazaar-style directories.
- MCP registries.
- Agent framework communities.
- World AgentKit and ToolRouter adjacent content.
- Base builder channels.
- Example repos and templates, not only announcement posts.

Outreach should lead with an integration or example, not "please try our app."

### 5. Show public proof of value

For each successful agent ask, preserve a short case study:

- What the agent was about to do.
- What question it asked.
- How many raters participated.
- What the settled result said.
- What the agent did afterward.
- Public result URL.

Target headline:

> "A coding agent paid $5 for 10 verified-human judgments before merging a user-facing docs change."

This is more persuasive than mechanism explanations.

## Outreach agent plan

An outreach agent can help, but it should be a research and drafting copilot, not an autonomous spammer.

### What the outreach agent should do

1. Build a lead list from public sources:
   - x402 builders and sellers.
   - MCP servers and registry publishers.
   - AI agent framework plugin authors.
   - Open-source agent repos with active maintainers.
   - World Mini App builders.
   - Base builders shipping AI or agent tools.
2. Score each lead:
   - Does this team run agents or sell to agent users?
   - Is there a visible workflow where external judgment helps?
   - Is there a public integration path?
   - Is there a non-spam contact route?
3. Draft a custom "give first" message:
   - Mention the exact repo/product.
   - Propose one concrete RateLoop ask for their workflow.
   - Offer to build the starter payload or PR.
   - Keep it short.
4. Queue human approval:
   - Human reviews every message.
   - Human sends from an appropriate personal or project account.
   - Respect venue rules and opt-outs.
5. Track replies and outcomes:
   - contacted
   - replied
   - intro call
   - sample ask created
   - integration started
   - closed/lost reason

### What it should not do

- Scrape private emails or DM people at scale.
- Auto-post in Discord, Telegram, Reddit, X, or GitHub issues.
- Pretend to be a human founder.
- Create fake engagement.
- Promise rewards, token value, grants, or World affiliation.
- Ignore community self-promotion rules.

### Suggested MVP implementation

Start with a simple repo-local process:

- `docs/outreach/lead-schema.md` defining the fields.
- `docs/outreach/leads.csv` or a private CRM export, not committed if it contains personal data.
- `docs/outreach/message-templates.md` with approved templates.
- A Codex prompt that researches 20 leads at a time and outputs JSON.
- A manual review step before anything is sent.

Later, make it a small internal app with authenticated connectors for GitHub, email/CRM, and calendar. Do not build sending automation until the manual process proves conversion and compliance.

## How Codex can help immediately

Codex is useful for repeatable research, docs, integration, and review loops:

- Turn this strategy into concrete website copy for World ID users and agent operators.
- Generate and lint RateLoop ask payloads for seeded questions.
- Create starter packs for Codex, Cursor, Claude Code, and other MCP clients.
- Build the outreach lead schema and draft queue.
- Research target projects and write personalized, human-reviewable outreach drafts.
- Create GitHub issues or PRs for example integrations when a project explicitly welcomes contributions.
- Prepare World grant, Mini App review, x402 listing, and MCP registry submissions.
- Run local verification, browser handoffs, screenshots, and docs checks before publishing.

Use `AGENTS.md` for durable repo rules, MCP for live external tools and private workspaces, skills for repeated workflows, and the Codex SDK or GitHub Action only after the manual workflow is stable enough to automate.

## 30-day action plan

### Week 1: sharpen the two-sided funnel

- Add a "For Verified Humans" page or section: paid rating work for World ID users.
- Add one "For Agents" above-the-fold CTA: ask before your agent acts.
- Seed 10 agent-shaped questions with small USDC bounties.
- Make one no-payment agent sandbox demo and one human-wallet browser handoff demo.
- Define the lean analytics events listed above.

### Week 2: create the first proof loops

- Launch the first verified-human rater job card in World/crypto-adjacent channels.
- Publish one Codex or Cursor starter pack.
- Contact 20 hand-picked agent builders with custom "give first" messages.
- Collect the first 5 public case studies from settled asks.

### Week 3: World App and listings

- Start the companion World Mini App review path if not already underway.
- Submit or refresh x402 and MCP directory listings.
- Apply to relevant World programs only with the verified-human usage story, not token framing.
- Add referral flow specs with caps and post-settlement reward timing.

### Week 4: anchor content

- Publish a technical post: "How an AI agent can ask verified humans before acting."
- Publish a founder/user post: "Verified humans are the missing eval layer for agents."
- Stagger Show HN, Farcaster/Base, and World ecosystem posts only after the first-session funnel works.

## Messaging tests

Test these against small audiences before broad launch:

1. **World ID user headline A:** "Earn for judgment only verified humans can provide."
2. **World ID user headline B:** "AI agents need real human feedback. Your World ID lets you help."
3. **Agent headline A:** "Ask verified humans before your agent acts."
4. **Agent headline B:** "A paid judgment gate for AI agents."
5. **Mechanism headline:** "Public rating rounds where raters predict the crowd, not the asker."

Success metric: signup to first value for World ID users, and sandbox to first funded ask for agent operators.

## Source notes

- World, "How to create verified AI agents with AgentKit", 2026-06-24: https://world.org/blog/product/how-to-create-verified-ai-agents-agentkit
- World ID overview and FAQ: https://world.org/world-id
- World Mini Apps docs: https://docs.world.org/mini-apps
- World AgentKit integration docs: https://docs.world.org/agents/agent-kit/integrate
- World Mini Apps growth playbook: https://docs.world.org/mini-apps/growth/index.md
- World Mini Apps invites and viral loops: https://docs.world.org/mini-apps/growth/invites-viral.md
- World Mini Apps gamification: https://docs.world.org/mini-apps/growth/gamification.md
- World Mini Apps notifications: https://docs.world.org/mini-apps/growth/notifications.md
- World Mini Apps analytics: https://docs.world.org/mini-apps/growth/analytics.md
- LangChain, "State of AI Agents", 2026-06-12: https://www.langchain.com/stateofaiagents
- x402 homepage and ecosystem stats: https://x402.org/
- Official Codex manual fetched 2026-07-07 for Codex surface guidance: https://developers.openai.com/codex/codex-manual.md
