#!/bin/sh
set -eu

if [ "${KEEPER_CORRELATION_SNAPSHOTS_ENABLED:-false}" = "true" ] &&
  [ "${KEEPER_CORRELATION_ARTIFACT_STORAGE:-file}" = "file" ]; then
  artifact_dir="${KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR:-correlation-artifacts}"
  case "$artifact_dir" in
    /*) ;;
    *) artifact_dir="/app/packages/keeper/$artifact_dir" ;;
  esac

  mkdir -p "$artifact_dir"
  chown -R node:node "$artifact_dir"
fi

exec su-exec node yarn start:built-dist
