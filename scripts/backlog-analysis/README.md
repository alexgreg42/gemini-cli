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

## 🚀 The Ideal Workflow

### Step 1: Categorize via GitHub CLI & Export to JSON

If you have a raw list of uncategorized issues, the first step is to apply the
correct types (`bug` or `feature`) directly on GitHub, and then fetch the data
into a local JSON file for analysis.

**A) Auto-Categorize on GitHub:** Use the Gemini CLI directly in your terminal
to classify and label the issues on GitHub.

```bash
gemini "I have a list of issues (e.g. 123, 124). For each issue, determine if it is a bug or a feature request. Use the gh CLI tool to act on the GitHub issue: (a) Add the 'type/bug' or 'type/feature' label, and (b) Edit the issue body or title to explicitly denote the type."
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

Run the full effort analysis pipeline. This will run a fast static pass, a deep
agentic codebase search, iterative recovery for complex cases, and heuristic
validation.

```bash
GEMINI_API_KEY="YOUR_KEY" ./run_pipeline.sh data/bugs.json ../../packages
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
