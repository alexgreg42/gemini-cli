# Backlog Analysis Toolkit

This directory contains a suite of AI-powered tools for analyzing GitHub issues
and determining implementation effort levels for the Gemini CLI project.

## 📁 Directory Structure

- `data/`: Contains the issue data in JSON and CSV formats.
  - `bugs.json`: The primary source of truth for bug analysis.
- `utils/`: Auxiliary scripts for manual overrides, debugging, and post-analysis
  validation (e.g., `inject_manual_fixes.py`).
- `analyze_pipeline.py`: A unified Python script that orchestrates the entire
  effort analysis pipeline end-to-end, combining agentic analysis, single-turn
  fallbacks, heuristic validation, and CSV export.
- `generic_processor.py`: A highly configurable agent for custom backlog tasks.

## 🚀 The Ideal Workflow

### Step 1: Categorize via GitHub CLI & Export to JSON

If you have a raw list of uncategorized issues, the first step is to apply the
correct types (`bug` or `feature`) directly on GitHub, and then fetch the data
into a local JSON file for analysis.

**A) Auto-Categorize on GitHub:** We provide a dedicated Python script that will
automatically fetch uncategorized issues matching your search URL, classify them
using the Gemini API, and apply the correct labels and title prefixes (`[Bug]`
or `[Feature]`) directly on GitHub.

```bash
python3 categorize_issues.py "https://github.com/google-gemini/gemini-cli/issues/?q=-label:type/bug+-label:type/feature+is:open" --api-key "YOUR_KEY" --limit 50
```

**B) Export to JSON:** Once the issues are correctly labeled on GitHub, fetch
them into a local JSON file. You can simply copy a GitHub search URL from your
browser:

```bash
# Fetch bugs
python3 fetch_from_url.py "https://github.com/google-gemini/gemini-cli/issues/?q=type%3ABug+is%3Aopen" --output data/bugs.json

# Fetch features
python3 fetch_from_url.py "https://github.com/google-gemini/gemini-cli/issues/?q=type%3AFeature+is%3Aopen" --output data/issues.json
```

### Step 2: Analyze Effort Level

Run the unified effort analysis pipeline. This single Python script efficiently
runs a fast, context-aware single-turn analysis for each issue (pre-fetching
codebase context via grep), dynamically validates the effort level against
architectural rules using an AI reviewer persona, and immediately exports the
results to a CSV.

```bash
python3 analyze_pipeline.py --api-key "YOUR_KEY" --input data/bugs.json --project ../../packages
```

### Step 3: Review and Update JSON

The pipeline automatically updates your JSON file in place with the technical
`analysis`, `effort_level`, and `reasoning`, and exports a `.csv` file.

If you need to perform additional bulk updates or custom processing on the
resulting JSON (like grouping by package or identifying related PRs), use the
Generic Processor:

```bash
python3 generic_processor.py \
  --api-key "YOUR_KEY" \
  --input data/bugs.json \
  --output data/bugs_updated.json \
  --project ../../packages \
  --prompt "Analyze these issues and add a 'target_package' field to each JSON object based on the codebase analysis."
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
