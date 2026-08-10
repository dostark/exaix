#!/bin/bash
TOTAL=$(awk '{s+=$1} END {print s}' /app/data/numbers.txt)
echo "$TOTAL" > /app/total.txt
