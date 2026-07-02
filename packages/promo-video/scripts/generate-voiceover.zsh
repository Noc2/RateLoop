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

while IFS=$'\t' read -r name text; do
  [[ -z "$name" ]] && continue
  render_clip "$name" "$text"
done < <(node "$ROOT_DIR/scripts/voiceover-clips.mjs" --tsv)

echo "Generated voiceover clips in $AUDIO_DIR using $VOICE at $RATE words per minute."
