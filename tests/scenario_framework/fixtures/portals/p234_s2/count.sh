#!/bin/sh
# Prints each input row twice.
while IFS= read -r line; do
  printf '%s\n%s\n' "$line" "$line"
done
