import json
import urllib.request
import os
import subprocess
import re
import concurrent.futures

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"
ISSUES_FILE = 'data/issues.json'

with open(ISSUES_FILE, 'r') as f:
    issues = json.load(f)

def extract_files(text):
    # Try to find file paths mentioned in the text
    matches = re.findall(r'([\w\.\/\-]+\.(?:ts|tsx|js|json|md))', text)
    return set([m for m in matches if not m.startswith('http')])

def get_file_content(filepath):
    try:
        filename = os.path.basename(filepath)
        cmd = f'find /Users/cocosheng/gemini-cli -type d -name "node_modules" -prune -o -type f -name "{filename}" -print | head -n 1'
        actual_path = subprocess.check_output(cmd, shell=True, text=True).strip()
        if actual_path and os.path.exists(actual_path):
            with open(actual_path, 'r') as f:
                content = f.read()
                # Return first 200 lines to avoid massive contexts
                return f"\n--- {filepath} ---\n" + "\n".join(content.splitlines()[:200]) + "\n"
    except:
        pass
    return ""

def process_issue(issue):
    title = issue.get('title', '')
    body = issue.get('body', '')[:1000]
    analysis = issue.get('analysis', '')
    reasoning = issue.get('reasoning', '')
    
    combined_text = f"{title} {body} {analysis} {reasoning}"
    
    files = extract_files(combined_text)
    code_context = ""
    for f in list(files)[:3]: # limit to 3 files to save tokens
        code_context += get_file_content(f)

    prompt = f"""You are a senior software engineer validating the estimated effort for an issue in the gemini-cli codebase. 
Based on the issue description, previous analysis, and the provided codebase context, validate and output the correct effort level. 

Detailed Rating Effort Level Criteria:
🟢 Small (Estimated Effort: <= 1 Day)
These are highly localized fixes with a clear root cause, easily reproducible, and typically constrained to 1-2 files.
- UI/Aesthetic Adjustments: Minor tweaks to padding, margins, color themes, or structural layouts in Ink components.
- String/Content Updates: Fixing typos, updating documentation, adjusting help text, or tweaking static logging and error messages.
- Trivial Logic/Config: Changing default values in settings schemas, adding straightforward CLI flags, or casting/formatting simple data types.
- Static Refactoring: Extracting inline magic strings or repeated static calls to module-level constants.

🟡 Medium (Estimated Effort: 1 - 3 Days)
These involve logic tracing, state synchronization, or integration across a few components. They require robust testing and careful validation.
- React/Ink State Management: Fixing bugs involving useState, useEffect, useMemo, or UI state synchronization (e.g., input buffers, focus issues, dialog/modal states).
- Parsers and Validation: Adjusting Markdown parsing logic, ANSI escape sequence handling, or modifying complex Zod schema validations.
- Service Integration: Modifying how specific tools execute, fixing specific prompt construction logic, or handling intermediate API response processing.
- Asynchronous Flow: Resolving unhandled promise rejections, basic async control flow, or standard filesystem/path resolution bugs.

🔴 Large (Estimated Effort: 3+ Days)
These tasks involve deep architectural complexity, core protocol changes, cross-platform inconsistencies, or extensive feature implementations.
- Architectural & Protocol Changes: Modifications to the Model Context Protocol (MCP) integrations, experimental Agent-to-Agent (A2A) server, routing logic, or the task Scheduler.
- Concurrency & Performance: Fixing complex race conditions, deadlocks, WebSocket streaming throughput, memory leaks, or significant boot-time/CPU bottlenecks.
- Platform-Specific Complexities: Deep terminal/PTY issues, child process (spawn/exec) management, or POSIX signal handling specifically related to Windows/WSL or esoteric shell environments.
- Major Subsystems: Implementing or debugging heavy, stateful pipelines (like the Voice transcription infrastructure).

Issue Title: {title}
Issue Body: {body}
Previous Analysis: {analysis}
Previous Reasoning: {reasoning}

Codebase Context:
{code_context[:8000]}

Output ONLY a JSON object (no markdown formatting, no codeblocks):
{{
  "effort_level": "small|medium|large",
  "reasoning": "brief explanation for the effort level based on the codebase validation using the new criteria"
}}
"""
    data = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.0, "response_mime_type": "application/json"}
    }
    
    try:
        req = urllib.request.Request(URL, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as response:
            res = json.loads(response.read().decode('utf-8'))
            txt = res['candidates'][0]['content']['parts'][0]['text']
            parsed = json.loads(txt)
            
            issue['effort_level'] = parsed.get('effort_level', issue.get('effort_level'))
            issue['reasoning'] = parsed.get('reasoning', issue.get('reasoning'))
            issue['validated'] = True
            print(f"Validated #{issue['number']} -> {issue['effort_level']}", flush=True)
    except Exception as e:
        print(f"Failed #{issue['number']}: {e}", flush=True)
        issue['validated'] = False
        
    return issue

def main():
    print(f"Starting LLM validation for {len(issues)} issues...", flush=True)
    
    # We can process all issues using ThreadPoolExecutor
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(process_issue, issues))
    
    with open(ISSUES_FILE, 'w') as f:
        json.dump(results, f, indent=2)
        
    print("Done validating all issues.", flush=True)

if __name__ == '__main__':
    main()