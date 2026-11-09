#!/bin/sh
set -eu
result=$(./race.sh)
rows=$(printf '%s\n' "$result" | sed -n 's/.*"rows":\([0-9][0-9]*\).*/\1/p')
if [ "$rows" != 1 ]; then
  printf 'FAIL: expected 1 row, got %s\n' "$rows" >&2
  exit 1
fi
echo PASS
