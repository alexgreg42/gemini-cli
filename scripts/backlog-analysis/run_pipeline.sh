#!/bin/bash
# run_pipeline.sh
# Purpose: Orchestrates the full effort analysis pipeline end-to-end.

if [ -z "$GEMINI_API_KEY" ]; then
  echo "Error: GEMINI_API_KEY environment variable is required."
  echo "Usage: GEMINI_API_KEY=your_key ./run_pipeline.sh [INPUT_FILE] [PROJECT_DIR]"
  exit 1
fi

INPUT_FILE=${1:-"data/bugs.json"}
PROJECT_DIR=${2:-"../../packages"}
OUTPUT_CSV="${INPUT_FILE%.json}.csv"

echo "=========================================="
echo "Step 1: Initial Triage (Static Pass)"
echo "=========================================="
python3 analyze_bugs.py --api-key "$GEMINI_API_KEY" --input "$INPUT_FILE" --project "$PROJECT_DIR"

echo ""
echo "=========================================="
echo "Step 2: Deep Agentic Analysis"
echo "=========================================="
python3 bug_analyzer_final.py --api-key "$GEMINI_API_KEY" --input "$INPUT_FILE" --project "$PROJECT_DIR"

echo ""
echo "=========================================="
echo "Step 3: Iterative Recovery Analysis"
echo "=========================================="
while true; do
  count=$(jq '[.[] | select(.analysis == "Failed to analyze autonomously" or .analysis == null or .analysis == "" or (.analysis | length) < 30)] | length' "$INPUT_FILE")
  if [ -z "$count" ] || [ "$count" -eq 0 ]; then
    echo "All issues successfully processed!"
    break
  fi
  echo "Remaining unanalyzed issues: $count"
  python3 single_turn_bug_analyzer.py --api-key "$GEMINI_API_KEY" --input "$INPUT_FILE" --project "$PROJECT_DIR"
done

echo ""
echo "=========================================="
echo "Step 4: Heuristic Validation"
echo "=========================================="
python3 utils/validate_effort.py --input "$INPUT_FILE" --project "$PROJECT_DIR"

echo ""
echo "=========================================="
echo "Step 5: Exporting to CSV"
echo "=========================================="
python3 generate_bugs_csv.py --input "$INPUT_FILE" --output "$OUTPUT_CSV"

echo ""
echo "✅ Pipeline Complete! Results saved to $OUTPUT_CSV"
