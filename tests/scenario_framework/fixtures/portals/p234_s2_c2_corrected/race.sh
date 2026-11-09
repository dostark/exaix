#!/bin/sh
set -eu
RACE_DIR=$(mktemp -d)
export RACE_DIR
trap 'rm -rf "$RACE_DIR"' EXIT
: > "$RACE_DIR/store"
printf 'row\n' | ./count.sh &
first=$!
printf 'row\n' | ./count.sh &
second=$!
wait "$first"
wait "$second"
rows=$(wc -l < "$RACE_DIR/store" | tr -d ' ')
printf '{"callers":2,"rows":%s,"expected":1}\n' "$rows"
