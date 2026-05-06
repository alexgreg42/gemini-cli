"""
Purpose: Runs heuristic post-analysis validation on the AI's effort estimations.
Checks for keywords (like 'Windows', 'WSL', 'PTY') in the issue body to ensure the AI didn't underestimate platform-specific or architecturally complex bugs as 'small'.
"""
import json
import re
import os

ISSUES_FILE = 'backlog-analysis/issues.json'
REPO_ROOT = '/Users/cocosheng/gemini-cli'

with open(ISSUES_FILE, 'r') as f:
    issues = json.load(f)

# Stricter criteria keywords
LARGE_KEYWORDS = [
    'windows', 'win32', 'wsl', 'wsl2', 'pty', 'pseudo-terminal', 'child_process', 'spawn', 'sigint', 'sigterm',
    'memory leak', 'performance', 'boot time', 'infinite loop', 'hangs', 'freezes', 'crashes', 'race condition',
    'intermittent', 'sometimes', 'flickering', 'a2a', 'mcp protocol', 'scheduler', 'event loop', 'websocket',
    'stream', 'throughput', 'concurrency', 'deadlock', 'file descriptor', 'architecture', 'refactor'
]

MEDIUM_KEYWORDS = [
    'react', 'hook', 'useeffect', 'usestate', 'usememo', 'ink', 'tui', 'ui state', 'parser', 'markdown',
    'regex', 'regular expression', 'ansi', 'escape sequence', 'toml', 'schema', 'validation', 'zod',
    'promise', 'async', 'await', 'unhandled', 'rejection', 'config', 'settings', 'env', 'environment',
    'path resolution', 'symlink', 'git', 'telemetry', 'logging', 'format', 'display', 'rendering',
    'clipboard', 'copy', 'paste', 'bracketed', 'interactive', 'dialog', 'modal', 'focus'
]

SMALL_KEYWORDS = [
    'typo', 'spelling', 'rename', 'string', 'constant', 'css', 'color', 'theme.status', 'padding', 'margin',
    'error message', 'econnreset', 'enotdir', 'etimedout', 'documentation', 'jsdoc', 'readme', 'help text',
    'flag', 'version string', 'static value'
]

def find_files_in_text(text):
    # match patterns like packages/cli/src/ui/components/Footer.tsx or Footer.tsx
    # We will look for anything ending in .ts, .tsx, .js, .json
    matches = re.findall(r'([\w\.\/\-]+\.(?:ts|tsx|js|json|md))', text)
    # filter out URLs or common false positives
    return set([m for m in matches if not m.startswith('http')])

def resolve_file(filename):
    if os.path.exists(os.path.join(REPO_ROOT, filename)):
        return os.path.join(REPO_ROOT, filename)
    
    # Try searching the repo for the basename
    basename = os.path.basename(filename)
    for root, dirs, files in os.walk(REPO_ROOT):
        if '.git' in root or 'node_modules' in root:
            continue
        if basename in files:
            return os.path.join(root, basename)
    return None

def analyze_issue(issue):
    title = issue.get('title', '').lower()
    body = issue.get('body', '').lower()
    analysis = issue.get('analysis', '').lower()
    reasoning = issue.get('reasoning', '').lower()
    
    combined_text = f"{title} {body} {analysis} {reasoning}"
    
    potential_files = find_files_in_text(combined_text)
    actual_files = []
    total_lines = 0
    
    for f in potential_files:
        resolved = resolve_file(f)
        if resolved and resolved not in [a[0] for a in actual_files]:
            try:
                with open(resolved, 'r', encoding='utf-8') as file_obj:
                    lines = sum(1 for line in file_obj)
                    actual_files.append((resolved, lines))
                    total_lines += lines
            except Exception:
                pass
                
    num_files = len(actual_files)
    
    effort = "small"
    validation_msg = ""
    
    # Keyword analysis
    keyword_effort = "small"
    for kw in LARGE_KEYWORDS:
        if re.search(r'\b' + re.escape(kw) + r'\b', combined_text):
            keyword_effort = "large"
            break
            
    if keyword_effort != "large":
        for kw in MEDIUM_KEYWORDS:
            if re.search(r'\b' + re.escape(kw) + r'\b', combined_text):
                keyword_effort = "medium"
                break

    # Codebase heuristic
    if num_files == 0:
        # If no files found, rely strictly on keywords, but default to medium to be safe
        effort = keyword_effort if keyword_effort in ['medium', 'large'] else 'medium'
        validation_msg = f"No specific files identified in codebase. Keyword heuristic: {keyword_effort}."
    else:
        file_details = ", ".join([f"{os.path.basename(f[0])} ({f[1]} lines)" for f in actual_files])
        if num_files > 3 or total_lines > 1500 or keyword_effort == "large":
            effort = "large"
            validation_msg = f"Codebase validation: {num_files} files ({file_details}), {total_lines} total lines. Keyword hint: {keyword_effort}."
        elif num_files >= 2 or total_lines > 500 or keyword_effort == "medium":
            effort = "medium"
            validation_msg = f"Codebase validation: {num_files} files ({file_details}), {total_lines} total lines. Keyword hint: {keyword_effort}."
        else:
            effort = "small"
            validation_msg = f"Codebase validation: {num_files} files ({file_details}), {total_lines} total lines. Appears highly localized."

    return effort, validation_msg

updated_count = 0
for issue in issues:
    old_effort = issue.get('effort_level')
    new_effort, validation_reason = analyze_issue(issue)
    
    issue['effort_level'] = new_effort
    
    # Store the validation reason in the reasoning field
    existing_reasoning = issue.get('reasoning', '')
    # Strip any previous validation messages
    existing_reasoning = existing_reasoning.split(' | Codebase validation:')[0]
    existing_reasoning = existing_reasoning.split(' | No specific files identified')[0]
    
    issue['reasoning'] = f"{existing_reasoning} | {validation_reason}".strip(' |')
    
    if old_effort != new_effort:
        updated_count += 1

with open(ISSUES_FILE, 'w') as f:
    json.dump(issues, f, indent=2)

print(f"Successfully re-evaluated and updated {updated_count} issues. Codebase validated.")
