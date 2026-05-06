"""
Purpose: Performs a single-turn analysis on backlog issues.
It pre-fetches context by grepping the codebase for keywords found in the issue description, then sends a single prompt to Gemini to determine the root cause and effort level. Faster than agentic analysis but more grounded than static analysis.
"""
import json
import urllib.request
import os
import subprocess
import re
import argparse
import concurrent.futures
import threading

MODEL = "gemini-3-flash-preview"
file_lock = threading.Lock()

def extract_keywords(text):
    words = re.findall(r'\b[A-Z][a-zA-Z0-9]+\b|\b\w+\.tsx?\b|\b\w+Service\b|\b\w+Command\b', text)
    words = list(set([w for w in words if len(w) > 4]))
    return words[:8]

def search_codebase(keywords, project_path):
    context = ""
    for kw in keywords:
        try:
            kw_clean = kw.replace('"', '\\"')
            cmd = f'grep -rn "{kw_clean}" "{project_path}" | grep -vE "node_modules|dist|build|\\.test\\." | head -n 8'
            out = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
            if out:
                context += f"\n--- Matches for {kw_clean} ---\n{out}\n"
        except:
            pass
    return context

def process_issue_task(args_tuple):
    issue, url, project_path, input_file, bugs = args_tuple
    
    if issue.get('analysis') and issue['analysis'] != "Failed to analyze autonomously" and len(issue['analysis']) > 30:
        return issue

    title = issue.get('title', '')
    body = issue.get('body', '')[:1500]
    
    keywords = extract_keywords(title + " " + body)
    code_context = search_codebase(keywords, project_path)

    prompt = f"""You are a senior software engineer analyzing bug reports. 
Based on the bug description and the provided codebase search context, pinpoint exactly which files and logic are responsible for the bug. 
DO NOT GUESS. If the context isn't enough, provide your best technical hypothesis.

Rating Effort Level:
- small (1 day): Localized fix (1-2 files), clear cause.
- medium (2-3 days): Touches multiple components or hard to trace.
- large (>3 days): Architectural issues, Windows/WSL-specific, core protocols.

Bug Title: {title}
Bug Body: {body}

Codebase Search Context:
{code_context[:8000]}

Output ONLY valid JSON (no markdown block):
{{
  "analysis": "technical analysis of root cause and fix",
  "effort_level": "small|medium|large",
  "reasoning": "justification with specific files/lines found"
}}
"""
    data = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1}
    }
    
    try:
        req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as response:
            res = json.loads(response.read().decode('utf-8'))
            txt = res['candidates'][0]['content']['parts'][0]['text']
            txt = txt.replace('```json', '').replace('```', '').strip()
            parsed = json.loads(txt)
            
            issue['analysis'] = parsed.get('analysis', 'Failed to analyze')
            issue['effort_level'] = parsed.get('effort_level', 'medium')
            issue['reasoning'] = parsed.get('reasoning', 'Could not determine')
            print(f"Completed {issue.get('number', 'unknown')} -> {issue['effort_level']}", flush=True)
    except Exception as e:
        print(f"Failed {issue.get('number', 'unknown')}: {e}", flush=True)
        
    with file_lock:
        with open(input_file, 'w') as f:
            json.dump(bugs, f, indent=2)
            
    return issue

def main():
    parser = argparse.ArgumentParser(description="Single turn code search bug analyzer.")
    parser.add_argument("--api-key", required=True, help="Gemini API Key")
    parser.add_argument("--input", default="data/bugs.json", help="Input JSON file containing bugs")
    parser.add_argument("--project", default="../../packages", help="Project root to analyze")
    args = parser.parse_args()

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={args.api_key}"

    with open(args.input, 'r') as f:
        bugs = json.load(f)

    to_analyze = [b for b in bugs if b.get('analysis') == "Failed to analyze autonomously" or not b.get('analysis') or len(b.get('analysis', '')) < 30]
    to_analyze = to_analyze[:5]
    
    print(f"Starting single-turn analysis for {len(to_analyze)} bugs...", flush=True)
    
    tasks = [(b, url, args.project, args.input, bugs) for b in to_analyze]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        list(executor.map(process_issue_task, tasks))
        
    print("Done processing batch.", flush=True)

if __name__ == '__main__':
    main()
