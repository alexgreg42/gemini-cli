import json
import urllib.request
import urllib.error
import os
import subprocess
import sys

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

tools = [
    {
        "functionDeclarations": [
            {
                "name": "search_codebase",
                "description": "Search the gemini-cli packages directory for a string using grep.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {"pattern": {"type": "STRING"}},
                    "required": ["pattern"]
                }
            },
            {
                "name": "read_file",
                "description": "Read a specific file.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {"filepath": {"type": "STRING"}},
                    "required": ["filepath"]
                }
            }
        ]
    }
]

def call_gemini(messages):
    data = {"contents": messages, "tools": tools, "generationConfig": {"temperature": 0.1}}
    req = urllib.request.Request(URL, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode('utf-8'))

def execute_tool(call):
    name = call['name']
    args = call.get('args', {})
    if name == 'search_codebase':
        p = args.get('pattern', '').replace('"', '\\"')
        cmd = f'grep -rn "{p}" ../../packages | grep -vE "node_modules|dist|build|\\.test\\." | head -n 30'
        try:
            return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT) or "No results."
        except: return "No results."
    elif name == 'read_file':
        f = args.get('filepath', '')
        if not f.startswith('/'): f = os.path.join('../../packages', f)
        if not os.path.exists(f):
            basename = os.path.basename(f)
            find_cmd = f'find ../../packages -name "{basename}" | head -n 1'
            try:
                f = subprocess.check_output(find_cmd, shell=True, text=True).strip()
            except: return "File not found."
        if not f or not os.path.exists(f): return "File not found."
        try:
            return subprocess.check_output(f'head -n 300 "{f}"', shell=True, text=True)
        except: return "Error reading file."
    return "Unknown tool"

def analyze_issue(issue):
    system_instruction = """You are a senior software engineer analyzing bug reports for the gemini-cli codebase. 
You MUST use the provided tools to investigate the codebase and pinpoint exactly which files and logic are responsible for the bug. 
DO NOT GUESS.

Rating Effort Level:
- small (1 day): Bug is easy to reproduce, localized fix (1-2 files).
- medium (2-3 days): Harder to reproduce, touches multiple components, or requires tracing.
- large (>3 days): Architectural issues, core protocol changes, or complex multi-package bugs.

REPRODUCTION RULE:
If a bug is hard to reproduce (specific OS, complex setup, intermittent/flickering), it MUST NOT be rated as small.

Output format (ONLY valid JSON, NO markdown):
{
  "analysis": "technical analysis of root cause and fix",
  "effort_level": "small|medium|large",
  "reasoning": "justification with specific files/lines found using tools"
}
"""
    prompt = f"{system_instruction}\n\nBug Title: {issue.get('title')}\nBug Body: {issue.get('body', '')[:1200]}"
    messages = [{"role": "user", "parts": [{"text": prompt}]}]
    
    for _ in range(25):
        try:
            res = call_gemini(messages)
            candidate = res['candidates'][0]['content']
            if 'role' not in candidate: candidate['role'] = 'model'
            messages.append(candidate)
            fcalls = [p['functionCall'] for p in candidate.get('parts', []) if 'functionCall' in p]
            if fcalls:
                responses = []
                for fc in fcalls:
                    out = execute_tool(fc)
                    responses.append({"functionResponse": {"name": fc['name'], "response": {"result": out}}})
                messages.append({"role": "user", "parts": responses})
            else:
                txt = candidate['parts'][0].get('text', '').replace('```json', '').replace('```', '').strip()
                return json.loads(txt)
        except Exception: break
    return None

print(f"Starting sequential re-analysis for {len(bugs)} bugs...")
for i, bug in enumerate(bugs):
    # Only re-analyze if it's missing a real analysis
    analysis = bug.get('analysis', '')
    if analysis and analysis != "Failed to analyze autonomously" and len(analysis) > 50:
        continue
        
    print(f"[{i+1}/{len(bugs)}] Analyzing #{bug['number']}...")
    result = analyze_issue(bug)
    if result:
        bug['analysis'] = result.get('analysis', 'Failed to analyze')
        bug['effort_level'] = result.get('effort_level', 'medium')
        bug['reasoning'] = result.get('reasoning', 'Could not determine')
        print(f"  > Success: {bug['effort_level']}")
    else:
        print(f"  > FAILED")
        
    # Save after each bug to ensure no loss
    with open(BUGS_FILE, 'w') as f:
        json.dump(bugs, f, indent=2)

print("Done.")
