# RateLoop Public Announcement & Early-Tester Plan (July 2026)

Goal: publicly announce RateLoop and recruit an initial cohort of testers who give real feedback — with special weight on **World ID-verified humans**, since verified-human bounty eligibility, launch anchors, and one-time verification bonuses need them to function.

This plan is based on channel research done 2026-07-06. All URLs and rules were verified against current sources where possible; items flagged "verify" should be re-checked immediately before use.

---

## 1. Positioning per audience

One product, three framings. Never lead with the token.

| Audience | Lead with | Avoid |
| --- | --- | --- |
| World ID / proof-of-personhood users | "Your verified humanity earns you rating work: bounties only real humans can claim" | Token-price talk; airdrop framing |
| Base / crypto builders | "Open rating protocol on Base: commit-reveal + crowd-forecast (RBTS) scoring, USDC/x402 native" | Vague "web3 community" language |
| AI-agent builders | "Agents pay verified humans for judgment: MCP tools + x402 endpoints to ask rating questions" | Protocol internals up front |
| General tech (HN etc.) | Mechanism design: private vote + population prediction, scored against revealed peers | Token first; hype words |

Required one-liners to have ready before any post:

- **Why on-chain?** A defensible, honest answer (portable reputation, open rater set, credible commit-reveal, permissionless agent payments). This single answer decides whether the HN thread goes well.
- **Token disclosure:** LREP = capped reputation/governance token, no sale, no airdrop-farming; USDC = bounty lane. State it plainly in the first comment of every launch post.

## 2. Readiness checklist (Phase 0 — before any announcement)

- [ ] **No-wallet path**: read-only explorer of live questions/results, reachable in <2 min. HN disallows waitlist/signup-gated Show HN posts; crypto audiences bounce off wallet gates too.
- [ ] Landing page answers "what is this / why on-chain / how do I try it" above the fold; og-image, demo GIF.
- [ ] Public GitHub README polished (already good) + `CONTRIBUTING.md` friction check.
- [ ] **One feedback channel** chosen and linked everywhere (recommend Telegram for the crypto/World crowd, or Discord if we also want agent devs; pick one primary, bridge the other). Every launch post funnels there.
- [ ] First-cohort "job card": *"Post one question with a small bounty, rate three things, tell us where it broke."* Concrete tasks convert visitors into testers.
- [ ] Seed content: ~10 live, genuinely interesting rating questions so the app isn't empty on arrival (the World Cup ask is a good pattern).
- [ ] Confirm **World ID 4.0 on-chain verification support on Base** — the World ID contracts v3 docs are marked legacy; verify migration status before promising verified-human flows publicly.
- [ ] Decide tester incentive: launch LREP credits for genuine beta feedback framed as *recognition*, not an airdrop.

## 3. World ID users — the priority track

World App: ~40M users, ~18–20M Orb-verified; Mini Apps get ~3.8M opens/day. This dwarfs every community channel combined.

### 3.1 World App Mini App (highest leverage)

- MiniKit's **Verify command is chain-agnostic**: a thin companion mini app can run World ID verification inside World App and relay the proof to RateLoop on Base (World ID Router is deployed on Base mainnet). Pay/Send commands are World Chain-only, so keep payments in the main web app.
- Submit via the [Developer Portal](https://developer.worldcoin.org/login); approved apps appear in the in-app store. Docs: [Mini App Store](https://docs.world.org/mini-apps/quick-start/app-store), [App Guidelines](https://docs.world.org/mini-apps/guidelines/app-guidelines).
- Guideline landmines: mobile-first UI required; no chance-based reward mechanics; no "official"/World branding; no token pre-sales. Frame one-time verification bonuses as participation rewards, not prizes.

### 3.2 World grants & programs (money + amplification)

- [World Foundation Grants](https://world.org/grants) — continuous applications; "Digital Identity" category fits a World ID integration on Base.
- **Developer Rewards Pilot** — WLD rewards for mini apps scored on *verified human usage* (RateLoop's literal metric); apply via [Community Perks](https://docs.world.org/mini-apps/more/community-tools-perks).
- [Mini App Retro Funding](https://world.org/retro) — verify current round status.
- [World Build](https://worldbuildlabs.com/) — virtual build program runs May–Aug 2026 (now); check the "already building on World" fast track.
- Get listed on [world.org/ecosystem](https://world.org/ecosystem) (via Developer Portal) and tag [@worldnetwork](https://x.com/worldnetwork) on launch — they amplify integrations.

### 3.3 World community channels

| Channel | Size | How to share |
| --- | --- | --- |
| [World Discord](https://discord.com/invite/worldnetwork) | ~84k | Builder-style post in dev/ecosystem channels: "I built a World ID integration, looking for verified-human testers." No shilling in general. |
| [r/worldid](https://www.reddit.com/r/worldid) | modest | Same builder framing; follow self-promo norms (be a participant first). |
| r/worldcoin | unverified | Skews price talk; check activity + sidebar rules first (verify). |
| [World Developers Telegram](https://t.me/worlddevelopersupport) | ~860 | Technical support only — integration questions yes, tester recruitment no. |

### 3.4 Paid/quest option (later, optional)

World ID-gated quests on [Galxe](https://app.galxe.com/) or [Layer3](https://app.layer3.xyz/) ("verify + rate something on RateLoop"). Confirm native World ID credential support with their teams first (unverified). Avoid generic airdrop-hunter Telegram groups — mercenary and scam-adjacent.

## 4. Base & crypto ecosystem

- **Base ecosystem listing**: the old PR flow is dead (base/web archived 2026-03); submit via the Google Form linked in the [base/web README](https://github.com/base/web) → free listing on base.org/ecosystem. Do this first — it's a form.
- **[Base Builder Grants](https://gitcoin.co/apps/base-builder-grants)** (1–5 ETH, retroactive, for shipped projects — exactly our situation) via [docs.base.org/get-started/get-funded](https://docs.base.org/get-started/get-funded). A grant doubles as amplification from Base's grants account.
- **[Base Discord](https://discord.com/invite/buildonbase)** (~590k): share in #developer-chat as "shipped this, want feedback."
- **Farcaster**: demo casts in [/base](https://farcaster.xyz/~/channel/base), /base-builds, [/builder](https://farcaster.xyz/~/channel/builder). Norm: show, don't shill — working demo + reply to every comment. Note: since 2026-04-09 the Base App treats mini apps as standard web apps, so ship the rating widget as a web app that also carries a Farcaster manifest. A one-tap "rate this" cast is our strongest organic crypto channel.
- Tag @base on X/Farcaster; Base explicitly amplifies builder projects.
- **Base Batches 2026**: current cohort passed (demo day May); watch for next batch.

## 5. AI-agent ecosystem

- **x402**: the CDP Facilitator **auto-catalogs endpoints in the [x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar) on first settled payment** — ensure our x402 routes declare discovery metadata/schemas. Also: [Agentic.Market](https://www.coinbase.com/developer-platform/discover/launches/agentic-market) directory, PR to [awesome-x402](https://github.com/xpaysh/awesome-x402), and the [CDP Discord](https://discord.com/invite/cdp) (~25k). x402 **V2** shipped recently — mention V2-readiness.
- **MCP registries** (list the RateLoop MCP tools everywhere, same week): [official registry](https://registry.modelcontextprotocol.io) (CLI publish; also surfaces on GitHub's MCP registry), [Smithery](https://smithery.ai), [mcp.so](https://mcp.so), [Glama](https://glama.ai/mcp), PulseMCP, [MCP.Directory](https://mcp.directory/submit). Plus the [MCP community Discord](https://discord.com/invite/model-context-protocol-1312302100125843476) (~13k).
- **Agent frameworks**: [elizaOS](https://elizaos.ai) and [Virtuals Protocol](https://www.virtuals.io) (Base-native) Discords — pitch "agents paying humans for judgment" as a plugin/integration, not an announcement.

## 6. Mechanism-design & forecasting audiences (credibility + sharpest feedback)

- **[ethresear.ch](https://ethresear.ch)**: research writeup — commit-reveal + RBTS + correlation-capped settlement, with honest failure-mode analysis (we already document the collusion residual risk; that candor is the post). Announcements get flagged; mechanisms get engagement.
- **[LessWrong](https://www.lesswrong.com)**: essay framing — "What we learned implementing Bayesian Truth Serum on-chain." High bar: new-user karma limits and an explicit anti-LLM-prose policy; write it by hand. Cross-post to EA Forum.
- **[Metaculus Discord](https://discord.com/invite/7GEKtpnVdJ)** (~1k, exactly the crowd that knows RBTS/Prelec): discuss the mechanism, invite critique.
- Engage peer-prediction academics on X rather than crypto-Twitter.
- Events: **ETHGlobal Lisbon 2026-07-24/26** (demo or bounty — the in-person moment this month); Devcon 8 Mumbai Nov 3–6.

## 7. General launch platforms

### Show HN (anchor launch — after soft-launch fixes)

- Rules: must be tryable without signup ([guidelines](https://news.ycombinator.com/showhn.html)). Post from a personal account with history; title `Show HN: RateLoop – open rating protocol where raters predict the crowd`-style, factual, no superlatives; immediate first comment with backstory + honest token disclosure; **no booster comments**; avoid LLM-sounding copy.
- HN is crypto-hostile by default — lead with mechanism + open source; the "why on-chain?" answer decides the thread.
- Timing: Tue–Thu 14:00–17:00 UTC, or a lower-competition weekend slot for niche topics. One repost allowed weeks later after meaningful changes.

### Product Hunt (separate, later event)

- Crypto is fine there ([Web3 category](https://www.producthunt.com/categories/web3)); engagement now outweighs raw upvotes; self-hunting OK. Prep ~14 days: active maker profile, 8–12 visuals + demo GIF, "Coming Soon" teaser, 12:01am PT launch, reply to every comment; never solicit upvotes.

### Reddit (technical framing only, after 6–8 weeks of genuine participation)

- **r/alphaandbetausers** — explicitly for tester recruitment; small but targeted. Use in soft launch.
- **r/SideProject** — story framing; friendliest general sub.
- **r/ethdev** — technical writeup angle (commit-reveal, Foundry, RBTS).
- **r/opensource** — only with the code/license as the subject.
- **Skip r/CryptoCurrency and r/ethereum announcements** — anti-promotion regimes make them net-negative. Re-check every sidebar before posting (rules were partly verified via secondary sources).

### Dev/indie platforms

- Technical post on **dev.to/Hashnode** ("How we built commit-reveal crowd-forecast rating on Base") published 1–2 days before Show HN so it's indexed during the spike.
- **[Peerlist Launchpad](https://peerlist.io/launchpad)** (week-long voting, dev audience), **Dev Hunt** (dev-tool fit), Uneed/Microlaunch/Fazier as low-effort listings; **BetaList** only if we ever run a waitlist; **AlternativeTo/openalternative.co** as evergreen SEO ("open-source alternative to <category>").

### X/Twitter

- Launch thread: hook with a specific mechanism claim, 5–12 posts, link in reply not the main tweet (2026 algorithm: replies ≫ likes, external links penalized). Build-in-public cadence beforehand; never automate engagement.

## 8. Sequencing

**Week 1 (now): free listings + soft launch**

1. Base ecosystem form; MCP registries; x402 Bazaar metadata check; awesome-x402 PR; world.org/ecosystem listing via Developer Portal.
2. World Foundation grant + Developer Rewards Pilot applications; check World Build fast track.
3. Soft launch for 20–50 testers: Farcaster /base + /base-builds casts, Base Discord #developer-chat, World Discord builder post, r/alphaandbetausers. Funnel into the feedback channel; run the job card; fix onboarding.

**Weeks 2–3: content + agent ecosystem**

4. dev.to/Hashnode technical post; ethresear.ch mechanism writeup; Metaculus Discord thread.
5. MCP/CDP/elizaOS/Virtuals Discord engagement (give before asking).
6. Start the World App mini app companion (Verify-command → Base proof relay) and submit for review.
7. ETHGlobal Lisbon (Jul 24–26) if feasible — demo or sponsor a small bounty.

**Week 4+: anchor launches (staggered, never all in one day)**

8. Show HN (with first-comment backstory), r/SideProject ~30 min later, Peerlist same week.
9. X launch thread + tag @base/@worldnetwork; LessWrong essay when hand-written and ready.
10. Product Hunt as its own event once testimonials/polish exist; then directory drip (AlternativeTo etc.).

Each phase feeds the next: soft-launch feedback fixes onboarding before HN traffic; HN/PH traction strengthens grant and listing applications.

## 9. Success metrics (30-day window)

- ≥100 testers who completed the job card; ≥25 of them World ID-verified.
- ≥50 settled rating rounds with real bounties; ≥10 questions posted by non-team users or agents.
- Qualitative: a ranked list of the top-10 onboarding failures from the feedback channel.
- Listings live: Base ecosystem, world.org/ecosystem, ≥4 MCP registries, x402 Bazaar auto-catalog confirmed.

## 10. Risks & open items

- **World ID 4.0 migration**: confirm on-chain Base verification path before public claims (v3 contracts marked legacy).
- **Mini app chain gap**: Pay/Send are World Chain-only; the companion app must be Verify-only with clear UX handoff to the Base web app.
- **Crypto hostility on HN/general Reddit**: mitigated by mechanism-first framing, no-wallet demo, honest token disclosure — but expect it.
- **Anti-shill rules**: several subreddit/Discord rules were verified only via secondary sources; re-read every venue's rules immediately before posting.
- **Incentive optics**: any LREP credit for testers must read as recognition for genuine feedback, not an airdrop, to avoid both farming and platform-policy problems.
- **Galxe/Layer3 World ID credential support**: unconfirmed; ask their support before budgeting a quest.
