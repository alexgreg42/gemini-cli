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
- `run_pipeline.sh`: A shell script that orchestrates the entire effort analysis
  pipeline end-to-end.

## 📥 Prerequisites: Data Generation

Before running the analyzers, you must fetch the issue data from GitHub. The
scripts expect the data in JSON format.

The easiest way to generate this is to simply copy the URL from your browser
when looking at a filtered list of issues on GitHub, and pass it to our fetcher
script.

_(Note: You must have the [GitHub CLI (`gh`)](https://cli.github.com/) installed
and authenticated)._

```bash
# Fetch any filtered list of issues directly from a GitHub URL
python3 fetch_from_url.py "https://github.com/google-gemini/gemini-cli/issues/?q=type%3ABug+is%3Aopen" --output data/bugs.json

# Fetch features to a different file
python3 fetch_from_url.py "https://github.com/google-gemini/gemini-cli/issues/?q=type%3AFeature+is%3Aopen" --output data/issues.json
```

## 🚀 Workflows

### 1. Auto-Categorizing Issues with Gemini CLI

If you have a list of uncategorized issues fetched from GitHub, your first step
should be to classify them. You can use the Gemini CLI directly in your terminal
to label them on GitHub.

**Example command:**

```bash
gemini "Read data/uncategorized.json. For each issue, determine if it is a bug or a feature request. Then, use the gh CLI tool to add either the 'type/bug' or 'type/feature' label directly to the issue on GitHub."
```

_Note: Make sure your `gemini-cli` has permission to execute shell commands if
you want it to apply the labels automatically via `gh`._

### 2. Full Effort Analysis Pipeline

Instead of running individual steps manually, you can run the entire analysis
pipeline (Initial Triage -> Deep Agentic Analysis -> Iterative Recovery ->
Validation -> CSV Export) with a single command.

```bash
GEMINI_API_KEY="YOUR_KEY" ./run_pipeline.sh data/bugs.json ../../packages
```

### 3. Generic Issue Processing

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
