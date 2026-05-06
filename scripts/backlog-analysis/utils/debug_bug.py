import json
import urllib.request
import urllib.error
import os
import subprocess

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

def call_gemini(messages):
    tools = [{
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
    }]
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
    print(f"  > Executing: {name}({args})")
    if name == 'search_codebase':
        p = args.get('pattern', '').replace('"', '\\"')
        cmd = f'grep -rn "{p}" ../../packages | grep -vE "node_modules|dist|build" | head -n 10'
        try:
            return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT) or "No results."
        except: return "Error or no results."
    elif name == 'read_file':
        f = args.get('filepath', '')
        if not f.startswith('/'): f = os.path.join('../../../packages', f)
        if not os.path.exists(f): return "File not found."
        try:
            return subprocess.check_output(f'head -n 200 "{f}"', shell=True, text=True)
        except: return "Error reading file."
    return "Unknown tool"

def debug_one(issue_num):
    with open('../data/bugs.json', 'r') as f:
        bugs = json.load(f)
    issue = next(b for b in bugs if b['number'] == issue_num)
    
    prompt = f"Analyze this bug for gemini-cli codebase. pinpoint files/logic. rate effort (small/medium/large) with reasoning.\n\nTitle: {issue['title']}\nBody: {issue['body'][:1000]}\n\nOutput ONLY a JSON object with: analysis, effort_level, reasoning, recommended_implementation."
    messages = [{"role": "user", "parts": [{"text": prompt}]}]
    
    for i in range(10):
        print(f"--- Turn {i} ---")
        res = call_gemini(messages)
        candidate = res['candidates'][0]['content']
        parts = candidate.get('parts', [])
        messages.append(candidate)
        
        fcalls = [p['functionCall'] for p in parts if 'functionCall' in p]
        if fcalls:
            responses = []
            for fc in fcalls:
                out = execute_tool(fc)
                responses.append({"functionResponse": {"name": fc['name'], "response": {"result": out}}})
            messages.append({"role": "user", "parts": responses})
        else:
            txt = parts[0].get('text', '')
            print("Final Response:", txt)
            return

debug_one(23541)
