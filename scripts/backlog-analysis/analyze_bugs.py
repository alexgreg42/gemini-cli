import json
import urllib.request
import urllib.error
import os
import argparse
import concurrent.futures
from pathlib import Path

MODEL = "gemini-3-flash-preview"

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
            if f.endswith(('.ts', '.tsx', '.js', '.json', '.toml', '.md', '.py', '.sh')):
                tree.append(f"{indent}  {f}")
    return "\n".join(tree)

def analyze_bug(bug, url, tree_context):
    prompt = f"""
You are analyzing bugs for the current codebase.
Here is the directory structure of the project:
{tree_context[:4000]}

Analyze the following GitHub bug report to determine the implementation effort.
Rate the effort level with reasoning (small as in 1 day, medium as in 2-3 day, else large).
Look at the directory structure above to pinpoint which packages and files need modification.

Issue Title: {bug.get('title')}
Issue Body: {bug.get('body', '')[:1000]}

Reply with ONLY a valid JSON object matching exactly this schema, without Markdown formatting:
{{"analysis": "short technical analysis of the root cause and required fix", "effort_level": "small|medium|large", "reasoning": "brief justification mapping the effort to the files/components involved", "recommended_implementation": "concise code change instructions (only if small effort)"}}
"""
    data = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
        }
    }
    
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
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
        print(f"Error processing bug {bug.get('number', 'unknown')}: {e}")
        return {"analysis": "Failed to analyze", "effort_level": "medium", "reasoning": "Error calling Gemini API"}

def process_bug_task(args):
    bug, url, tree_context = args
    print(f"Analyzing Bug #{bug.get('number', 'unknown')}...")
    result = analyze_bug(bug, url, tree_context)
    bug['analysis'] = result.get('analysis', '')
    bug['effort_level'] = result.get('effort_level', 'medium')
    bug['reasoning'] = result.get('reasoning', '')
    if 'recommended_implementation' in result:
        bug['recommended_implementation'] = result['recommended_implementation']
    return bug

def main():
    parser = argparse.ArgumentParser(description="Static initial triage analyzer for bugs.")
    parser.add_argument("--api-key", required=True, help="Gemini API Key")
    parser.add_argument("--input", default="data/bugs.json", help="Input JSON file containing bugs")
    parser.add_argument("--project", default="../../packages", help="Project root to analyze")
    args = parser.parse_args()

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={args.api_key}"

    with open(args.input, 'r') as f:
        bugs = json.load(f)

    tree_context = get_tree(args.project)

    print(f"Starting static analysis of {len(bugs)} bugs...")
    
    # Process in batches to save incrementally
    batch_size = 10
    for i in range(0, len(bugs), batch_size):
        batch = bugs[i:i+batch_size]
        tasks = [(bug, url, tree_context) for bug in batch]
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            list(executor.map(process_bug_task, tasks))
        
        with open(args.input, 'w') as f:
            json.dump(bugs, f, indent=2)
        print(f"Saved batch {i//batch_size + 1}")
        
    print("Done analyzing all bugs!")

if __name__ == '__main__':
    main()
