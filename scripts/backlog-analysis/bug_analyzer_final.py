"""
Purpose: Performs deep, agentic analysis on backlog issues.
It equips the Gemini model with tool-calling capabilities (grep and file reading), allowing it to autonomously navigate the codebase and investigate the root cause over multiple turns (up to 30) for high-accuracy effort estimation.
"""
import json
import urllib.request
import urllib.error
import os
import argparse
import concurrent.futures
import subprocess
import sys
import threading

MODEL = "gemini-3-flash-preview"
file_lock = threading.Lock()

tools_decl = [
    {
        "functionDeclarations": [
            {
                "name": "search_codebase",
                "description": "Search the project directory for a string using grep. Returns matching lines and file paths.",
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

def call_gemini(messages, url):
    data = {
        "contents": messages,
        "tools": tools_decl,
        "generationConfig": {"temperature": 0.1}
    }
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode('utf-8'))

def execute_tool(call, project_path):
    name = call['name']
    args = call.get('args', {})
    
    if name == 'search_codebase':
        pattern = args.get('pattern', '')
        pattern = pattern.replace('"', '\\"')
        try:
            cmd = f'grep -rn "{pattern}" "{project_path}" | grep -vE "node_modules|dist|build|\\.test\\." | head -n 20'
            res = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
            return res if res else "No matches found."
        except subprocess.CalledProcessError as e:
            return e.output if e.output else "No matches found."
    elif name == 'read_file':
        filepath = args.get('filepath', '')
        if not filepath.startswith('/'):
            filepath = os.path.join(project_path, filepath)
        
        try:
            if not os.path.exists(filepath):
                basename = os.path.basename(filepath)
                find_cmd = f'find "{project_path}" -name "{basename}" | head -n 1'
                found_path = subprocess.check_output(find_cmd, shell=True, text=True).strip()
                if found_path: filepath = found_path
                else: return f"File {filepath} not found."
            
            cmd = f'head -n 300 "{filepath}"'
            res = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
            return res
        except Exception as e:
            return str(e)
    return "Unknown tool"

def analyze_issue(issue, url, project_path):
    system_instruction = """You are a senior software engineer analyzing bug reports. 
You MUST use the provided tools to investigate the codebase and pinpoint exactly which files and logic are responsible for the bug. 
DO NOT GUESS.

Rating Effort Level:
- small (1 day): Bug is easy to reproduce, clear cause, localized fix (1-2 files).
- medium (2-3 days): Harder to reproduce (needs specific platform/setup), requires tracing, or touches multiple components.
- large (>3 days): Architectural issues, core protocol changes, or very complex multi-package bugs.

REPRODUCTION RULE:
If a bug is hard to reproduce (specific OS, complex setup, intermittent/flickering), it MUST NOT be rated as small.

Output format (ONLY valid JSON, NO markdown):
{
  "analysis": "technical analysis of root cause and fix",
  "effort_level": "small|medium|large",
  "reasoning": "justification with specific files/lines/logic you found",
  "recommended_implementation": "code snippets or specific logic changes (only if small)"
}
"""
    
    prompt = f"{system_instruction}\n\nBug Title: {issue.get('title')}\nBug Body: {issue.get('body', '')[:1200]}"
    messages = [{"role": "user", "parts": [{"text": prompt}]}]
    
    for turn in range(30):
        try:
            res = call_gemini(messages, url)
            candidate = res['candidates'][0]['content']
            parts = candidate.get('parts', [])
            
            if 'role' not in candidate: candidate['role'] = 'model'
            messages.append(candidate)
            
            function_calls = [p for p in parts if 'functionCall' in p]
            
            if function_calls:
                tool_responses = []
                for fcall in function_calls:
                    call_data = fcall['functionCall']
                    result = execute_tool(call_data, project_path)
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
                text = text.replace('```json', '').replace('```', '').strip()
                return json.loads(text)
        except Exception as e: break
            
    return {"analysis": "Failed to analyze autonomously", "effort_level": "medium", "reasoning": "Agent loop exceeded 30 turns or errored."}

def process_issue_task(args_tuple):
    issue, url, project_path, input_file, bugs = args_tuple
    current_analysis = issue.get('analysis', '')
    if current_analysis and current_analysis != "Failed to analyze autonomously" and len(current_analysis) > 50:
        return issue
        
    print(f"Analyzing Bug #{issue.get('number', 'unknown')}...", flush=True)
    result = analyze_issue(issue, url, project_path)
    
    issue['analysis'] = result.get('analysis', 'Failed to analyze')
    issue['effort_level'] = result.get('effort_level', 'medium')
    issue['reasoning'] = result.get('reasoning', 'Could not determine')
    if 'recommended_implementation' in result:
        issue['recommended_implementation'] = result['recommended_implementation']
    else:
        issue.pop('recommended_implementation', None)
        
    print(f"Completed Bug #{issue.get('number', 'unknown')} -> {issue.get('effort_level', 'unknown')}", flush=True)
    
    with file_lock:
        with open(input_file, 'w') as f:
            json.dump(bugs, f, indent=2)
    return issue

def main():
    parser = argparse.ArgumentParser(description="Deep agentic bug analyzer.")
    parser.add_argument("--api-key", required=True, help="Gemini API Key")
    parser.add_argument("--input", default="data/bugs.json", help="Input JSON file containing bugs")
    parser.add_argument("--project", default="../../packages", help="Project root to analyze")
    args = parser.parse_args()

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={args.api_key}"

    with open(args.input, 'r') as f:
        bugs = json.load(f)

    print(f"Starting FINAL RE-ANALYSIS for {len(bugs)} bugs (Turn Limit: 30)...", flush=True)
    
    tasks = [(b, url, args.project, args.input, bugs) for b in bugs]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(process_issue_task, tasks))
        
    print("Agentic analysis complete. JSON is updated.", flush=True)

if __name__ == '__main__':
    main()
