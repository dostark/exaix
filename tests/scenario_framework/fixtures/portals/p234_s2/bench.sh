#!/bin/sh
set -eu
iterations=1
if [ "${1:-}" = "--iterations" ]; then
  iterations="$2"
fi
start=$(date +%s%N)
index=0
while [ "$index" -lt "$iterations" ]; do
  index=$((index + 1))
done
end=$(date +%s%N)
printf '{"iterations":%s,"elapsed_ns":%s}\n' "$iterations" "$((end - start))"
