import json
import re

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

# Stricter criteria keywords
LARGE_KEYWORDS = [
    'windows', 'win32', 'wsl', 'wsl2', 'pty', 'pseudo-terminal', 'child_process', 'spawn', 'sigint', 'sigterm',
    'memory leak', 'performance', 'boot time', 'infinite loop', 'hangs', 'freezes', 'crashes', 'race condition',
    'intermittent', 'sometimes', 'flickering', 'a2a', 'mcp protocol', 'scheduler', 'event loop', 'websocket',
    'stream', 'throughput', 'concurrency', 'deadlock', 'file descriptor'
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
    'flag', 'version string'
]

def reevaluate_effort(bug):
    title = bug.get('title', '').lower()
    body = bug.get('body', '').lower()
    analysis = bug.get('analysis', '').lower()
    reasoning = bug.get('reasoning', '').lower()
    
    combined_text = f"{title} {body} {analysis} {reasoning}"
    
    # 1. Check for Large criteria first
    for kw in LARGE_KEYWORDS:
        if re.search(r'\b' + re.escape(kw) + r'\b', combined_text):
            return "large", f"Re-classified to LARGE due to presence of complex architectural/platform keyword: '{kw}'"
            
    # 2. Check for Medium criteria
    for kw in MEDIUM_KEYWORDS:
        if re.search(r'\b' + re.escape(kw) + r'\b', combined_text):
            return "medium", f"Re-classified to MEDIUM due to presence of logic/state keyword: '{kw}'"
            
    # 3. Check for Small criteria
    for kw in SMALL_KEYWORDS:
        if re.search(r'\b' + re.escape(kw) + r'\b', combined_text):
            return "small", f"Verified as SMALL due to presence of trivial/localized keyword: '{kw}'"
            
    # Default to medium if it doesn't match small criteria explicitly
    return "medium", "Defaulted to MEDIUM as it requires logic tracing and testing, not just a trivial string/constant update."

updated_count = 0
for bug in bugs:
    old_effort = bug.get('effort_level')
    new_effort, classification_reason = reevaluate_effort(bug)
    
    if old_effort != new_effort:
        bug['effort_level'] = new_effort
        # Append the re-classification reason to the existing reasoning
        existing_reasoning = bug.get('reasoning', '')
        bug['reasoning'] = f"{existing_reasoning} | {classification_reason}".strip(' |')
        updated_count += 1
        
        # If it's no longer small, we should probably remove the recommended implementation
        # as it was likely overly simplistic or incorrect.
        if new_effort != 'small' and 'recommended_implementation' in bug:
            del bug['recommended_implementation']

with open(BUGS_FILE, 'w') as f:
    json.dump(bugs, f, indent=2)

print(f"Successfully re-evaluated and updated {updated_count} bugs based on stricter criteria.")
