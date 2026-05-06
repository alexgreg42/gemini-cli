import json
import urllib.request
import urllib.error
import os
import concurrent.futures
import subprocess
import sys
import threading
import time

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

BUGS_FILE = 'data/bugs.json'
file_lock = threading.Lock()

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

# Define tools for the LLM to use
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

def call_gemini(messages, use_tools=True):
    data = {
        "contents": messages,
        "generationConfig": {"temperature": 0.1}
    }
    if use_tools:
        data["tools"] = tools
    
    req = urllib.request.Request(URL, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode('utf-8'))

def execute_tool(call):
    name = call['name']
    args = call.get('args', {})
    print(f"  [TOOL] {name}({args})", flush=True)
    
    if name == 'search_codebase':
        pattern = args.get('pattern', '')
        pattern = pattern.replace('"', '\\"')
        try:
            cmd = f'grep -rn "{pattern}" ../../packages | grep -vE "node_modules|dist|build|\\.test\\." | head -n 30'
            res = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
            return res if res else "No matches found."
        except subprocess.CalledProcessError as e:
            return e.output if e.output else "No matches found."
    elif name == 'read_file':
        filepath = args.get('filepath', '')
        if not filepath.startswith('/'):
            filepath = os.path.join('../../packages', filepath)
        
        if '..' in filepath: return "Invalid path."

        try:
            if not os.path.exists(filepath):
                basename = os.path.basename(filepath)
                find_cmd = f'find ../../packages -name "{basename}" | head -n 1'
                found_path = subprocess.check_output(find_cmd, shell=True, text=True).strip()
                if found_path: filepath = found_path
                else: return f"File {filepath} not found."
            
            cmd = f'head -n 200 "{filepath}"'
            res = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
            return res
        except Exception as e:
            return str(e)
    return "Unknown tool"

def analyze_issue(issue):
    system_instruction = """You are a senior software engineer analyzing bug reports for the gemini-cli codebase. 
You MUST use the provided tools to investigate the codebase and pinpoint exactly which files and logic are responsible for the bug. 

Rating Effort Level:
- small (1 day): Localized fix (1-2 files), clear cause.
- medium (2-3 days): Harder to reproduce, multiple components, or significant tracing.
- large (>3 days): Architectural issues, core protocol changes, or complex multi-package bugs.

REPRODUCTION RULE:
If a bug is hard to reproduce (specific OS, complex setup, intermittent), it MUST NOT be rated as small.

Output format (ONLY valid JSON, NO markdown):
{
  "analysis": "technical analysis of root cause and fix",
  "effort_level": "small|medium|large",
  "reasoning": "justification with specific files/lines/logic you found"
}
"""
    
    prompt = f"{system_instruction}\n\nBug Title: {issue.get('title')}\nBug Body: {issue.get('body', '')[:1200]}"
    messages = [{"role": "user", "parts": [{"text": prompt}]}]
    
    for turn in range(30):
        try:
            res = call_gemini(messages)
            candidate = res['candidates'][0]['content']
            parts = candidate.get('parts', [])
            
            if 'role' not in candidate: candidate['role'] = 'model'
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
                            "response": {"result": result[:10000]}
                        }
                    })
                messages.append({"role": "user", "parts": tool_responses})
            else:
                text = parts[0].get('text', '')
                if not text:
                    # try a follow-up if it gave no text
                    messages.append({"role": "user", "parts": [{"text": "Please provide the final analysis in the specified JSON format. If you have investigated enough, conclude now."}]})
                    continue
                
                text = text.replace('```json', '').replace('```', '').strip()
                try:
                    return json.loads(text)
                except:
                    # failed to parse, ask again
                    messages.append({"role": "user", "parts": [{"text": "Your response was not valid JSON. Please provide ONLY the JSON object without any preamble or code blocks."}]})
                    continue
        except Exception as e:
            print(f"  [ERROR] {e}", flush=True)
            time.sleep(1)
            break
            
    return None

def process_issue(issue):
    current_analysis = issue.get('analysis', '')
    if current_analysis and current_analysis != "Failed to analyze autonomously" and len(current_analysis) > 30:
        return issue
        
    print(f"Analyzing Bug #{issue['number']}...", flush=True)
    result = analyze_issue(issue)
    
    if result:
        issue['analysis'] = result.get('analysis', 'Failed to analyze')
        issue['effort_level'] = result.get('effort_level', 'medium')
        issue['reasoning'] = result.get('reasoning', 'Could not determine')
        print(f"Completed Bug #{issue['number']} -> {issue['effort_level']}", flush=True)
    else:
        print(f"Failed Bug #{issue['number']}", flush=True)
    
    with file_lock:
        with open(BUGS_FILE, 'w') as f:
            json.dump(bugs, f, indent=2)
    return issue

def main():
    # Filter only failed/missing ones
    to_analyze = [b for b in bugs if b.get('analysis') == "Failed to analyze autonomously" or not b.get('analysis')]
    print(f"Starting analysis for {len(to_analyze)} bugs...", flush=True)
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(process_issue, to_analyze))
                
    print("Agentic analysis complete. `bugs.json` is updated.", flush=True)

if __name__ == '__main__':
    main()
