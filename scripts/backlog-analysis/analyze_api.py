import json
import urllib.request
import urllib.error
import os
import concurrent.futures
from pathlib import Path

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

ISSUES_FILE = 'data/issues.json'

with open(ISSUES_FILE, 'r') as f:
    issues = json.load(f)

# Collect basic directory structure to provide as context
def get_tree(path, max_depth=3):
    tree = []
    base_path = Path(path)
    if not base_path.exists(): return ""
    for root, dirs, files in os.walk(base_path):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'dist', 'build', 'coverage')]
        depth = Path(root).relative_to(base_path).parts
        if len(depth) >= max_depth:
            dirs.clear()
            continue
        indent = '  ' * len(depth)
        tree.append(f"{indent}{Path(root).name}/")
        for f in files:
            if f.endswith(('.ts', '.tsx', '.js', '.json', '.toml', '.md')):
                tree.append(f"{indent}  {f}")
    return "\n".join(tree)

tree_context = get_tree('../../packages')

def analyze_issue(issue):
    prompt = f"""
You are analyzing issues for the google-gemini/gemini-cli codebase.
Here is the directory structure of the 'packages' directory:
{tree_context[:4000]}

Analyze the following GitHub issue to determine the implementation effort.
Rate the effort level with reasoning (small as in 1 day, medium as in 2-3 day, else large).
Look at the directory structure above to pinpoint which packages and files need modification.

Issue Title: {issue.get('title')}
Issue Body: {issue.get('body', '')[:1000]}

Reply with ONLY a valid JSON object matching exactly this schema, without Markdown formatting:
{{"analysis": "short analysis of what needs to be changed in the codebase", "effort_level": "small|medium|large", "reasoning": "brief justification mapping the effort to the files/components involved"}}
"""
    data = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
        }
    }
    
    req = urllib.request.Request(URL, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            text = result['candidates'][0]['content']['parts'][0]['text']
            
            # Clean markdown block if present
            if text.startswith('```json'):
                text = text[7:]
            if text.startswith('```'):
                text = text[3:]
            if text.endswith('```'):
                text = text[:-3]
                
            parsed = json.loads(text.strip())
            return parsed
    except Exception as e:
        print(f"Error processing issue {issue['number']}: {e}")
        return {"analysis": "Failed to analyze", "effort_level": "medium", "reasoning": "Error calling Gemini API"}

def process_issue(i, issue):
    print(f"Analyzing {issue['number']}...")
    result = analyze_issue(issue)
    issue['analysis'] = result.get('analysis', '')
    issue['effort_level'] = result.get('effort_level', 'medium')
    issue['reasoning'] = result.get('reasoning', '')
    return issue

def main():
    print(f"Starting analysis of {len(issues)} issues...")
    updated_issues = []
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(process_issue, i, issue): i for i, issue in enumerate(issues)}
        for future in concurrent.futures.as_completed(futures):
            updated_issues.append(future.result())
            
    # Sort back to original order (optional, but good practice)
    # We'll just write them as is, or better, we modify the dictionary in-place above
    
    with open(ISSUES_FILE, 'w') as f:
        json.dump(issues, f, indent=2)
        
    print("Done analyzing all issues!")

if __name__ == '__main__':
    main()
