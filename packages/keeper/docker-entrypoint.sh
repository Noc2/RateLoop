#!/bin/sh
set -eu

snapshots_enabled=$(
  printf '%s' "${KEEPER_CORRELATION_SNAPSHOTS_ENABLED:-false}" |
    tr '[:upper:]' '[:lower:]' |
    sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
)

case "$snapshots_enabled" in
1 | true | yes | on) snapshots_enabled=true ;;
*) snapshots_enabled=false ;;
esac

if [ "$snapshots_enabled" = "true" ] && [ "${KEEPER_CORRELATION_ARTIFACT_STORAGE:-file}" = "file" ]; then
  artifact_dir="${KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR:-correlation-artifacts}"
  case "$artifact_dir" in
    /*) ;;
    *) artifact_dir="/app/packages/keeper/$artifact_dir" ;;
  esac

  mkdir -p "$artifact_dir"
  chown -R node:node "$artifact_dir"
fi

exec su-exec node yarn start:built-dist
