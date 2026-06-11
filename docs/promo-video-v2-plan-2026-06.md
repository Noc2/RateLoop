# Promo Video v2 Plan — June 2026

Plan for a second iteration of `packages/promo-video`. Planning only; no implementation yet.

## What v1 got wrong (and right)

v1 (30s, 4 scenes, silent) reuses the website's design tokens correctly (`theme.ts` lifts
`globals.css` verbatim, Space Grotesk/Inter via `fonts.ts`) but recites landing-page copy:
`HowItWorks.tsx` and `WhyItWorks.tsx` are animated versions of the website's text sections.
Verdict: keep the design system, drop the content mirroring.

v2 direction:

1. **One concrete story, not feature cards** — follow a single ask from "user prompts their
   agent" to "agent delivers a report", using lightweight UI facsimiles styled like the real
   product (chat panel, question card, handoff link, vote card, result card).
2. **Voiceover + background music**, mixed with ducking.
3. **Sound-off first**: most social autoplay is muted, so every beat must read from visuals +
   short on-screen captions alone; VO and music are enhancement, not carriers.
4. **Slightly longer**: ~66s (1980 frames @ 30fps) vs v1's 30s. Cut points marked so a ~45s
   social edit is a config change, not a re-edit.

## The story (7 beats)

A founder asks their coding agent to validate a business idea before building it.

| # | Time | Beat | Visual (all in website dark theme) | On-screen caption |
|---|---|---|---|---|
| 1 | 0–6s | Hook | Chat panel: user types "I have an idea for an AI meeting-notes app. Is the landing page convincing? Validate it before I build more." Orb pulses in the corner. | "Your agent can build anything. Should it?" |
| 2 | 6–14s | Agent prepares the ask | Agent reply streams; MCP tool chips tick by (`quote_question` → `create_ask_handoff_link`); a question card assembles itself: title, mockup thumbnail, 25 USDC bounty, 25 raters, category, target audience. | "Your agent turns it into one focused question" |
| 3 | 14–21s | Handoff & funding | Handoff-link card slides in; browser frame with wallet approval; USDC amount confirms; "Question live" state with spectrum-gradient ring. | "You review and fund in one click" |
| 4 | 21–34s | Raters rate (longest beat) | Vote card: blind 👍/👎 choice + crowd-prediction slider; World ID "Verified Human" badge; a second rater types a feedback note; grid of rater avatars committing (commit-reveal lock icons); USDC chips fly to raters. | "Verified humans rate it blind — and earn USDC" / "Honest votes pay. Copying doesn't." |
| 5 | 34–42s | Settlement | Reveal animation: locks open, votes flip; result dial sweeps to 78% up; crowd prediction vs outcome ticks; "Settled on-chain" check with block hash sliver. | "Settles on-chain. Auditable forever." |
| 6 | 42–54s | The report | Back in chat: agent delivers a compact report card — rating 78% up, confidence, top objection ("pricing unclear"), best feedback quote, recommendation + public result URL. User reply: "Shipping it." | "Your agent comes back with judgment, not guesses" |
| 7 | 54–66s | Outro | Orb animation + `LogoLoop`, "Level Up Your Agent", rateloop.ai, agent logos strip (reuse `SupportedAgentsSection` logo set). Music swell, fade. | "RateLoop — rateloop.ai" |

45s cut: trim beat 2 to 5s, beat 4 to 9s, beat 6 to 8s, outro to 5s; beats 1/3/5 unchanged.

## Voiceover script (~140 words, fits 66s with breathing room)

> Your agent can build anything. But should it?
>
> Ask it. Your agent turns the idea into one focused question on RateLoop — with real money
> attached.
>
> You get a link. One click to review, one click to fund. Done.
>
> Now verified humans — real people, proven by World ID — rate it blind. No herding, no
> copying. They predict the crowd, stake reputation, and write the feedback that matters.
> Honest judgment earns USDC.
>
> The round settles on-chain. Public. Auditable. Yours to cite.
>
> And your agent? It comes back with a report: the score, the confidence, the objection you
> hadn't thought of — and what to do next.
>
> Stop guessing. Level up your agent. RateLoop.

Tone: calm, confident, low-key — match the site's restraint. No hype-voice.

## Audio plan

**Voiceover production** (pick one):

- ElevenLabs (recommended): natural delivery, commercial license on paid tiers; generate per-beat
  clips so timing stays editable, name them `vo-01-hook.mp3` … `vo-07-outro.mp3`.
- OpenAI TTS: cheaper, slightly flatter; fine for a draft pass to validate timing before paying
  for the final voice.
- Human VO later if the video earns a paid distribution push.

**Music**: one 70s instrumental, minimal electronic, ~90–100 BPM, low-energy start → subtle lift
at beat 5 (settlement) → swell into outro. Sources in order of preference: licensed library
(Artlist/Epidemic, clean commercial terms), AI-generated on a commercial plan (Suno/Udio), or
CC0 fallback. Store as `music.mp3`; keep the license note next to the asset.

**Mix**: music at full level only in beats 1 and 7; duck ~8 dB under VO via Remotion `volume`
callbacks (frame-based ramps, 300ms attack/release). Target loudness ~-16 LUFS for social.

**Captions**: burned-in short lines (the table above), not full VO transcription — they're the
sound-off narrative. Style: body font, warmWhite at 90%, bottom-left, max ~8 words.

## Implementation sketch (for when we build it)

- Assets in `packages/promo-video/public/`, loaded with `staticFile()`; `<Audio>` per VO clip
  inside each beat's `<Sequence>`, one global `<Audio>` for music with a volume envelope.
- New scene components: `ChatPanel`, `QuestionCard`, `HandoffCard`, `VoteCard`, `ResultDial`,
  `ReportCard` — built from `theme.ts` tokens + `primitives.tsx` entrances; no screenshots, no
  HTML imports. Keep `Intro`/`Outro` orb work, retire `HowItWorks`/`WhyItWorks` (note: the
  retired `WhyItWorks` still says "Trustless and Transparent"; the site now says "Confidential
  and Transparent" — v2 drops the card recital anyway).
- `Root.tsx`: bump `PROMO_DURATION_IN_FRAMES` to 1980; add a second `Composition`
  (`RateLoopPromoSquare` 1080×1080 or vertical 1080×1920) only if we decide we need it — the
  beats are composed full-frame, so reframing is mostly layout props.
- Mock content must obey product truth: bounty in atomic-unit-correct display (25 USDC), blind
  phase before reveal, World ID badge only on human raters, result is a rating + feedback (not
  a survey), report cites the public result URL.

## Open decisions

1. Final length: lock 66s, or build the 45s cut as the primary?
2. VO voice: ElevenLabs voice pick (need 2–3 candidates rendered against beat 1 for taste).
3. Music source: licensed library vs AI-generated (cost vs. cleanliness of rights).
4. Whether beat 4 shows AI raters alongside humans (true to product) or keeps the focus purely
   on verified humans (cleaner story). Suggestion: one AI-rater chip in the grid, no VO mention.
5. Vertical/square variants now or after the 16:9 master is approved.

## Out of scope for v2

Screen recordings of the live site, multi-language VO, per-use-case video variants
(confidential pretesting deserves its own 30s spot later — see `use-cases-2026-06.md` #1).
