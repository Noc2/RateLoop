#!/bin/sh
set -eu

exec su-exec node yarn start:built-dist
