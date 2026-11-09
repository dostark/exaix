#!/bin/sh
set -eu
IFS= read -r line
if [ -z "${RACE_DIR:-}" ]; then
  printf '%s\n' "$line"
  exit 0
fi

# Both callers observe the missing commit before either writes it.
if [ -e "$RACE_DIR/committed" ]; then exit 0; fi
: > "$RACE_DIR/checked.$$"
attempt=0
while :; do
  set -- "$RACE_DIR"/checked.*
  [ "$#" -ge 2 ] && break
  attempt=$((attempt + 1))
  [ "$attempt" -le 200 ] || exit 2
  sleep 0.01
done
printf '%s\n' "$line" >> "$RACE_DIR/store"
: > "$RACE_DIR/committed"
