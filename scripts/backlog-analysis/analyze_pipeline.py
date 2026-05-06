"""
Purpose: A unified pipeline that performs end-to-end effort analysis on a dataset of GitHub issues.
It relies exclusively on an efficient single-turn analysis that pre-fetches codebase context using grep, followed by CSV export.
"""
import argparse
import json
import urllib.request
import os
import subprocess
import re
import concurrent.futures
import threading
import csv
from datetime import datetime
from pathlib import Path

MODEL = "gemini-3-flash-preview"
file_lock = threading.Lock()

def extract_keywords(text):
    words = re.findall(r'\b[A-Z][a-zA-Z0-9]+\b|\b\w+\.tsx?\b|\b\w+Service\b|\b\w+Command\b', text)
    words = list(set([w for w in words if len(w) > 4]))
    return words[:8]

def search_codebase_static(keywords, project_path):
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

def analyze_issue_single_turn(issue, url, project_path):
    title = issue.get('title', '')
    body = issue.get('body', '')[:1500]
    
    keywords = extract_keywords(title + " " + body)
    code_context = search_codebase_static(keywords, project_path)

    prompt = f"""You are a principal software engineer analyzing an issue to determine its root cause and effort estimation.
Based on the description and codebase search context, pinpoint exactly which files and logic are responsible. 
DO NOT GUESS. If the context isn't enough, provide your best technical hypothesis.

Carefully evaluate the architectural complexity to determine the effort level:

RULES FOR 'LARGE' EFFORT (>3 days):
- Involves OS-level integrations (Windows/WSL support, process spawning, PTY, POSIX signals).
- Involves complex multi-threading, race conditions, memory leaks, or performance bottlenecks.
- Involves core architectural refactoring, custom protocols (like MCP or A2A), or network streams.
- The bug is described as intermittent, flickering, or hard to reproduce.

RULES FOR 'MEDIUM' EFFORT (2-3 days):
- Involves complex UI state management (React hooks, Ink TUI lifecycle).
- Involves asynchronous control flow (Promises, async/await chaining) where failure states are complex.
- Requires modifying parsers, schemas, or complex regex.
- Touches multiple components or is generally hard to trace.

RULES FOR 'SMALL' EFFORT (1 day):
- Localized fix/change (1-2 files), clear logic, easily reproducible.

Issue Title: {title}
Issue Body: {body}

Codebase Search Context:
{code_context[:8000]}

Output ONLY valid JSON (no markdown block):
{{
  "analysis": "technical analysis of root cause and fix",
  "effort_level": "small|medium|large",
  "reasoning": "detailed justification mapping the effort level to the architectural rules and specific files/lines found"
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
            return json.loads(txt)
    except Exception as e:
        return {"analysis": "Failed to analyze autonomously", "effort_level": "medium", "reasoning": str(e)}

def process_pipeline_task(args_tuple):
    issue, url, project_path, input_file, all_issues = args_tuple
    
    needs_analysis = not issue.get('analysis') or issue.get('analysis') == "Failed to analyze autonomously" or len(issue.get('analysis', '')) < 30
    
    if needs_analysis:
        print(f"[{issue.get('number', 'unknown')}] Starting Contextual Analysis...")
        result = analyze_issue_single_turn(issue, url, project_path)

        issue['analysis'] = result.get('analysis', 'Failed to analyze')
        issue['effort_level'] = result.get('effort_level', 'medium')
        issue['reasoning'] = result.get('reasoning', 'Could not determine')
        if 'recommended_implementation' in result:
            issue['recommended_implementation'] = result['recommended_implementation']
        
        with file_lock:
            with open(input_file, 'w') as f:
                json.dump(all_issues, f, indent=2)

        print(f"[{issue.get('number', 'unknown')}] Completed -> {issue.get('effort_level')}")
    return issue

def export_csv(issues, output_csv):
    today = datetime.now().strftime("%Y-%m-%d")
    with open(output_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f, delimiter='\t')
        writer.writerow([
            'Issue ID', 'Title', 'Status', 'Assignee', 'Labels', 
            'Last Sync', 'Link', 'analysis', 'effort_level', 
            'reasoning', 'recommended_implementation'
        ])
        
        for issue in issues:
            assignee_list = issue.get('assignees', [])
            if isinstance(assignee_list, dict) and 'nodes' in assignee_list: assignee_list = assignee_list['nodes']
            assignee = ", ".join([a.get('login', '') for a in assignee_list])
            
            labels_list = issue.get('labels', [])
            if isinstance(labels_list, dict) and 'nodes' in labels_list: labels_list = labels_list['nodes']
            labels = ", ".join([l.get('name', '') for l in labels_list])
            
            writer.writerow([
                issue.get('number'),
                issue.get('title', ''),
                issue.get('state', 'OPEN'),
                assignee,
                labels,
                today,
                issue.get('url', ''),
                issue.get('analysis', ''),
                issue.get('effort_level', ''),
                issue.get('reasoning', ''),
                issue.get('recommended_implementation', '')
            ])
    print(f"Exported successfully to {output_csv}")

def main():
    parser = argparse.ArgumentParser(description="Unified Effort Analysis Pipeline (Single-Turn).")
    parser.add_argument("--api-key", required=True, help="Gemini API Key")
    parser.add_argument("--input", default="data/bugs.json", help="Input JSON file")
    parser.add_argument("--project", default="../../packages", help="Project root to analyze")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent workers")
    args = parser.parse_args()

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={args.api_key}"

    with open(args.input, 'r') as f:
        issues = json.load(f)

    print(f"Starting single-turn analysis pipeline on {len(issues)} issues...")
    
    tasks = [(issue, url, args.project, args.input, issues) for issue in issues]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        list(executor.map(process_pipeline_task, tasks))
        
    output_csv = args.input.replace('.json', '.csv')
    export_csv(issues, output_csv)
    print("Pipeline fully complete!")

if __name__ == '__main__':
    main()
