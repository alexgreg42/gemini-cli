#!/bin/bash
# Run from the project root or the scripts/backlog-analysis directory
# This script assumes it's running in the same directory as the python scripts

while true; do
  count=$(jq '[.[] | select(.analysis == "Failed to analyze autonomously" or .analysis == null or .analysis == "" or (.analysis | length) < 30)] | length' data/bugs.json)
  if [ "$count" -eq 0 ]; then
    echo "All bugs processed!"
    break
  fi
  echo "Remaining bugs: $count"
  python3 single_turn_bug_analyzer.py
done
python3 generate_bugs_csv.py
