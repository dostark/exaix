#!/bin/sh
set -eu
expected=1
actual=$(printf 'row\n' | ./count.sh | wc -l | tr -d ' ')
if [ "$actual" -ne "$expected" ]; then
  echo "FAIL: expected $expected row, got $actual" >&2
  exit 1
fi
echo "PASS"
