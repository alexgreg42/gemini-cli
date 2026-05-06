import json
import urllib.request
import os
import subprocess
import re
import concurrent.futures

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"
BUGS_FILE = 'data/issues.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

def extract_files(text):
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
                return f"\n--- {filepath} ---\n" + "\n".join(content.splitlines()[:200]) + "\n"
    except:
        pass
    return ""

def process_bug(bug):
    if bug.get('effort_level') != 'small':
        return bug
    
    if bug.get('recommended_implementation') and bug['recommended_implementation'].strip() != "":
        return bug

    title = bug.get('title', '')
    body = bug.get('body', '')[:1000]
    analysis = bug.get('analysis', '')
    reasoning = bug.get('reasoning', '')
    
    combined_text = f"{title} {body} {analysis} {reasoning}"
    files = extract_files(combined_text)
    code_context = ""
    for f in list(files)[:3]:
        code_context += get_file_content(f)

    prompt = f"""You are a senior software engineer working on the gemini-cli codebase. 
This bug has been classified as a "small" effort bug. Please provide a concise, actionable `recommended_implementation` (or "recommended fix") for it.
It should be 1-3 sentences describing exactly what needs to be changed in the code (e.g., "In `file.ts`, change X to Y.").

Bug Title: {title}
Bug Body: {body}
Analysis: {analysis}
Reasoning: {reasoning}

Codebase Context:
{code_context[:8000]}

Output ONLY a JSON object (no markdown formatting, no codeblocks):
{{
  "recommended_implementation": "your suggested fix"
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
            
            bug['recommended_implementation'] = parsed.get('recommended_implementation', '')
            print(f"Generated fix for #{bug['number']}", flush=True)
    except Exception as e:
        print(f"Failed #{bug['number']}: {e}", flush=True)
        
    return bug

def main():
    to_process = [b for b in bugs if b.get('effort_level') == 'small' and not b.get('recommended_implementation')]
    print(f"Starting LLM generation for {len(to_process)} small bugs...", flush=True)
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(process_bug, bugs))
    
    with open(BUGS_FILE, 'w') as f:
        json.dump(results, f, indent=2)
        
    print("Done generating fixes.", flush=True)

if __name__ == '__main__':
    main()