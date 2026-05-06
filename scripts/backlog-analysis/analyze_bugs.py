import json
import urllib.request
import urllib.error
import os
import concurrent.futures
from pathlib import Path

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

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

def analyze_bug(bug):
    prompt = f"""
You are analyzing bugs for the google-gemini/gemini-cli codebase.
Here is the directory structure of the 'packages' directory:
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
        print(f"Error processing bug {bug['number']}: {e}")
        return {"analysis": "Failed to analyze", "effort_level": "medium", "reasoning": "Error calling Gemini API"}

def process_bug(bug):
    print(f"Analyzing Bug #{bug['number']}...")
    result = analyze_bug(bug)
    bug['analysis'] = result.get('analysis', '')
    bug['effort_level'] = result.get('effort_level', 'medium')
    bug['reasoning'] = result.get('reasoning', '')
    if 'recommended_implementation' in result:
        bug['recommended_implementation'] = result['recommended_implementation']
    return bug

def main():
    print(f"Starting analysis of {len(bugs)} bugs...")
    
    # Process in batches to save incrementally
    batch_size = 10
    for i in range(0, len(bugs), batch_size):
        batch = bugs[i:i+batch_size]
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            executor.map(process_bug, batch)
        
        with open(BUGS_FILE, 'w') as f:
            json.dump(bugs, f, indent=2)
        print(f"Saved batch {i//batch_size + 1}")
        
    print("Done analyzing all bugs!")

if __name__ == '__main__':
    main()
