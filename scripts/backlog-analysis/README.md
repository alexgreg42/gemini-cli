# Backlog Analysis Toolkit

This directory contains a suite of AI-powered tools for analyzing GitHub issues
and determining implementation effort levels for the Gemini CLI project.

## 📁 Directory Structure

- `data/`: Contains the issue data in JSON and CSV formats.
  - `bugs.json`: The primary source of truth for bug analysis.
- `utils/`: Auxiliary scripts for manual overrides, debugging, and post-analysis
  validation (e.g., `validate_effort.py`, `inject_manual_fixes.py`).
- `*.py`: Core analysis and export scripts (e.g., `bug_analyzer_final.py`,
  `generate_bugs_csv.py`).
- `loop_analyzer.sh`: A shell script for running iterative analysis until all
  issues are processed.

## 🚀 Workflows

### 1. Initial Triage (Static)

Use this for a quick, first-pass estimation.

```bash
python3 analyze_bugs.py
```

### 2. Deep Agentic Analysis

Uses Gemini as an agent with access to the codebase.

```bash
python3 bug_analyzer_final.py
```

### 3. Iterative Analysis

Runs the single-turn analyzer in a loop until all issues have a valid analysis.

```bash
./loop_analyzer.sh
```

### 4. Validation & Export

Run validation from the utils folder to ensure consistency, then generate a
readable report.

```bash
python3 utils/validate_effort.py
python3 generate_bugs_csv.py
```

### 5. Generic Issue Processing

For any other backlog task (e.g., categorizing features, updating labels, or
custom analysis), use the `generic_processor.py`. This script allows you to
provide a custom system prompt and a project root for codebase context.

```bash
python3 generic_processor.py \
  --api-key "YOUR_KEY" \
  --input data/features.json \
  --output data/features_analyzed.json \
  --project ../../packages \
  --prompt "Analyze these features and suggest which package they belong in. Output JSON: {\"package\": \"name\"}"
```

## 🧠 Effort Level Criteria

Ratings are based on technical complexity and reproduction difficulty:

- **Small (1 day):** Trivial logic changes, localized fixes (1-2 files), easy to
  reproduce.
- **Medium (2-3 days):** Requires tracing across multiple components, UI state
  management (React/Ink), or harder reproduction.
- **Large (3+ days):** Architectural issues, platform-specific (Windows, PTY,
  Signals), performance bottlenecks, or core protocol changes.

_Note: Any bug that is difficult to reproduce or platform-specific must not be
rated as Small._

## 🛠 Usage Notes

- **API Key:** Ensure you have a valid Gemini API key set in the scripts.
- **Paths:** Scripts are configured to look for data in the `data/` subdirectory
  and the codebase in `../../packages`.
- **Requirements:** Requires Python 3 and `jq` (for the shell script).
