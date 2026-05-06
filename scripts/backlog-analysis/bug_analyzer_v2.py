import json
import urllib.request
import urllib.error
import os
import concurrent.futures
import subprocess
import sys
import threading

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

BUGS_FILE = 'data/bugs.json'
file_lock = threading.Lock()

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

tools = [
    {
        "functionDeclarations": [
            {
                "name": "search_codebase",
                "description": "Search the gemini-cli packages directory for a string using grep. Returns matching lines and file paths.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "pattern": {"type": "STRING", "description": "The text pattern to search for"}
                    },
                    "required": ["pattern"]
                }
            },
            {
                "name": "read_file",
                "description": "Read a specific file to understand its context.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "filepath": {"type": "STRING", "description": "The path to the file"}
                    },
                    "required": ["filepath"]
                }
            }
        ]
    }
]

def call_gemini(messages):
    data = {
        "contents": messages,
        "tools": tools,
        "generationConfig": {"temperature": 0.1}
    }
    req = urllib.request.Request(URL, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode('utf-8'))

def execute_tool(call):
    name = call['name']
    args = call.get('args', {})
    
    if name == 'search_codebase':
        pattern = args.get('pattern', '')
        pattern = pattern.replace('"', '\\"')
        try:
            # Search in packages only, exclude dist/node_modules
            cmd = f'grep -rn "{pattern}" ../../packages | grep -vE "node_modules|dist|build|\\.test\\." | head -n 30'
            res = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
            return res if res else "No matches found."
        except subprocess.CalledProcessError as e:
            return e.output if e.output else "No matches found."
    elif name == 'read_file':
        filepath = args.get('filepath', '')
        if not filepath.startswith('/'):
            # try to find it in packages
            filepath = os.path.join('../../packages', filepath)
        
        # basic path sanitization
        if '..' in filepath: return "Invalid path."

        try:
            if not os.path.exists(filepath):
                # try searching for it if it's just a filename
                basename = os.path.basename(filepath)
                find_cmd = f'find ../../packages -name "{basename}" | head -n 1'
                found_path = subprocess.check_output(find_cmd, shell=True, text=True).strip()
                if found_path:
                    filepath = found_path
                else:
                    return f"File {filepath} not found."
            
            cmd = f'head -n 300 "{filepath}"'
            res = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
            return res
        except Exception as e:
            return str(e)
    return "Unknown tool"

def analyze_issue(issue):
    system_instruction = """You are a senior software engineer analyzing bug reports for the gemini-cli codebase. 
You MUST use the provided tools to investigate the codebase and pinpoint exactly which files and logic are responsible for the bug. 
DO NOT GUESS.

Packages structure:
- packages/cli: React/Ink UI, interactive loop, TUI components.
- packages/core: Backend logic, Gemini API orchestration, tools (shell, edit, etc.), scheduler.
- packages/sdk: Programmatic SDK for embedding the agent.

Rating Effort Level:
- small (1 day): Bug is easy to reproduce, localized fix (1-2 files).
- medium (2-3 days): Harder to reproduce, touches multiple components, or requires significant tracing.
- large (>3 days): Architectural issues, core protocol changes, or very complex multi-package bugs.

CRITICAL REPRODUCTION RULE:
If a bug is hard to reproduce (e.g. needs specific OS like Windows/WSL2, complex external service setup, or is described as intermittent/rare/flickering), it MUST NOT be rated as small.

Output format (ONLY valid JSON, NO markdown):
{
  "analysis": "technical analysis of root cause and fix",
  "effort_level": "small|medium|large",
  "reasoning": "justification with specific files/lines/logic you found using the tools",
  "recommended_implementation": "code snippets or specific logic changes (only if small)"
}
"""
    
    prompt = f"{system_instruction}\n\nBug Title: {issue.get('title')}\nBug Body: {issue.get('body', '')[:1200]}"
    
    messages = [{"role": "user", "parts": [{"text": prompt}]}]
    
    for turn in range(15): # Deeper investigation
        try:
            res = call_gemini(messages)
            candidate = res['candidates'][0]['content']
            parts = candidate.get('parts', [])
            
            if 'role' not in candidate:
                candidate['role'] = 'model'
            messages.append(candidate)
            
            function_calls = [p for p in parts if 'functionCall' in p]
            
            if function_calls:
                tool_responses = []
                for fcall in function_calls:
                    call_data = fcall['functionCall']
                    result = execute_tool(call_data)
                    tool_responses.append({
                        "functionResponse": {
                            "name": call_data['name'],
                            "response": {"result": result[:5000]}
                        }
                    })
                messages.append({"role": "user", "parts": tool_responses})
            else:
                text = parts[0].get('text', '')
                if not text: continue
                # clean up JSON
                text = text.replace('```json', '').replace('```', '').strip()
                return json.loads(text)
        except Exception as e:
            break
            
    return {"analysis": "Failed to analyze autonomously", "effort_level": "medium", "reasoning": "Agent loop exceeded turn limit or errored."}

def process_issue(issue):
    # Only re-analyze if failed or empty
    if 'analysis' in issue and issue['analysis'] and issue['analysis'] != "Failed to analyze autonomously":
        return issue
        
    print(f"Analyzing Bug #{issue['number']}...", flush=True)
    result = analyze_issue(issue)
    
    issue['analysis'] = result.get('analysis', 'Failed to analyze')
    issue['effort_level'] = result.get('effort_level', 'medium')
    issue['reasoning'] = result.get('reasoning', 'Could not determine')
    if 'recommended_implementation' in result:
        issue['recommended_implementation'] = result['recommended_implementation']
    else:
        issue.pop('recommended_implementation', None)
        
    print(f"Completed Bug #{issue['number']} -> {issue['effort_level']}", flush=True)
    
    # Atomic-ish write
    with file_lock:
        with open(BUGS_FILE, 'w') as f:
            json.dump(bugs, f, indent=2)
            
    return issue

def main():
    print(f"Starting RE-ANALYSIS for {len(bugs)} bugs...", flush=True)
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        list(executor.map(process_issue, bugs))
                
    print("Agentic analysis complete. `bugs.json` is updated.", flush=True)

if __name__ == '__main__':
    main()
