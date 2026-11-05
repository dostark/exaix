#!/bin/sh
set -eu
store="$(mktemp)"
trap 'rm -f "$store"' EXIT
printf 'row\n' | ./count.sh >> "$store" &
printf 'row\n' | ./count.sh >> "$store" &
wait
rows=$(wc -l < "$store" | tr -d ' ')
printf '{"callers":2,"rows":%s}\n' "$rows"
