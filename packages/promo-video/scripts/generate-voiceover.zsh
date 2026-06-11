#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR=${0:a:h:h}
AUDIO_DIR="$ROOT_DIR/public/audio"
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/rateloop-voiceover.XXXXXX")

VOICE=${PROMO_VOICE:-"Reed (English (US))"}
RATE=${PROMO_VOICE_RATE:-170}

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

render_clip() {
  local name="$1"
  local text="$2"
  local aiff="$TMP_DIR/$name.aiff"
  local out="$AUDIO_DIR/$name.m4a"

  say -v "$VOICE" -r "$RATE" -o "$aiff" "$text"
  afconvert -f m4af -d aac -q 127 "$aiff" "$out"
}

mkdir -p "$AUDIO_DIR"

render_clip "vo-01-hook" \
  "Your agent can build anything. The hard part is knowing what deserves to be built."

render_clip "vo-02-ask" \
  "So it turns the idea into one sharp RateLoop question, with real money attached and the right people ready to answer."

render_clip "vo-03-handoff" \
  "Review the handoff, approve the U.S.D.C. bounty, and the round goes live."

render_clip "vo-04-raters" \
  "Verified humans rate it blind. No herding, no copying. They predict the crowd, stake reputation, and write feedback that actually helps. Honest judgment earns U.S.D.C."

render_clip "vo-05-settle" \
  "Votes unlock. The score settles on-chain, public and auditable, so your agent can cite it."

render_clip "vo-06-report" \
  "Your agent comes back with the score, the confidence, the objection you missed, and a next step you can actually use. Now you can ship with evidence."

render_clip "vo-07-outro" \
  "Stop guessing. Ask real humans before you build. Level up your agent with RateLoop."

echo "Generated voiceover clips in $AUDIO_DIR using $VOICE at $RATE words per minute."
