import json
import urllib.request
import os
import subprocess
import concurrent.futures
import threading
import argparse

# --- Defaults and Configuration ---
DEFAULT_MODEL = "gemini-3-flash-preview"
DEFAULT_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

class GenericIssueProcessor:
    def __init__(self, api_key, input_file, output_file, project_path, system_prompt, model=DEFAULT_MODEL, max_workers=4, turn_limit=10):
        self.api_key = api_key
        self.model = model
        self.url = DEFAULT_URL_TEMPLATE.format(MODEL=model, API_KEY=api_key)
        self.input_file = input_file
        self.output_file = output_file
        self.project_path = os.path.abspath(project_path)
        self.system_prompt = system_prompt
        self.max_workers = max_workers
        self.turn_limit = turn_limit
        self.file_lock = threading.Lock()
        
        with open(input_file, 'r') as f:
            self.data = json.load(f)

    def _execute_tool(self, call):
        name = call['name']
        args = call.get('args', {})
        
        if name == 'search_code':
            pattern = args.get('pattern', '').replace('"', '\\"')
            try:
                cmd = f'grep -rn "{pattern}" {self.project_path} | grep -vE "node_modules|dist|build|\\.test\\." | head -n 20'
                res = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
                return res if res else "No matches found."
            except subprocess.CalledProcessError as e:
                return e.output if e.output else "No matches found."
        elif name == 'read_file':
            filepath = args.get('filepath', '')
            if not filepath.startswith('/'):
                filepath = os.path.join(self.project_path, filepath)
            
            try:
                if not os.path.exists(filepath):
                    basename = os.path.basename(filepath)
                    find_cmd = f'find {self.project_path} -name "{basename}" | head -n 1'
                    found_path = subprocess.check_output(find_cmd, shell=True, text=True).strip()
                    if found_path: filepath = found_path
                    else: return f"File {filepath} not found."
                
                cmd = f'head -n 300 "{filepath}"'
                res = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
                return res
            except Exception as e:
                return str(e)
        return "Unknown tool"

    def _call_gemini(self, messages):
        tools = [{
            "functionDeclarations": [
                {
                    "name": "search_code",
                    "description": "Search the project directory for a string using grep.",
                    "parameters": {
                        "type": "OBJECT",
                        "properties": {"pattern": {"type": "STRING"}},
                        "required": ["pattern"]
                    }
                },
                {
                    "name": "read_file",
                    "description": "Read a specific file context.",
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
        req = urllib.request.Request(self.url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))

    def process_item(self, item):
        item_id = item.get('number') or item.get('id', 'unknown')
        print(f"Processing item {item_id}...")
        
        prompt = f"{self.system_prompt}\n\nItem Content:\n{json.dumps(item, indent=2)[:2000]}"
        messages = [{"role": "user", "parts": [{"text": prompt}]}]
        
        result = {"error": "Turn limit exceeded"}
        for turn in range(self.turn_limit):
            try:
                res = self._call_gemini(messages)
                candidate = res['candidates'][0]['content']
                parts = candidate.get('parts', [])
                
                if 'role' not in candidate: candidate['role'] = 'model'
                messages.append(candidate)
                
                fcalls = [p for p in parts if 'functionCall' in p]
                if fcalls:
                    responses = []
                    for fc in fcalls:
                        tool_res = self._execute_tool(fc['functionCall'])
                        responses.append({
                            "functionResponse": {
                                "name": fc['functionCall']['name'],
                                "response": {"result": tool_res[:5000]}
                            }
                        })
                    messages.append({"role": "user", "parts": responses})
                else:
                    text = parts[0].get('text', '')
                    if not text: continue
                    text = text.replace('```json', '').replace('```', '').strip()
                    result = json.loads(text)
                    break
            except Exception as e:
                result = {"error": str(e)}
                break
        
        item.update(result)
        
        with self.file_lock:
            with open(self.output_file, 'w') as f:
                json.dump(self.data, f, indent=2)
        print(f"Finished item {item_id}")

    def run(self):
        print(f"Starting processing with {self.max_workers} workers...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            list(executor.map(self.process_item, self.data))
        print(f"Processing complete. Saved to {self.output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generic AI Issue Processor")
    parser.add_argument("--api-key", required=True, help="Gemini API Key")
    parser.add_argument("--input", required=True, help="Input JSON file")
    parser.add_argument("--output", required=True, help="Output JSON file")
    parser.add_argument("--project", default=".", help="Project root for tools")
    parser.add_argument("--prompt", required=True, help="System prompt / Instructions")
    parser.add_argument("--limit", type=int, default=10, help="Turn limit per item")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent workers")

    args = parser.parse_args()
    
    processor = GenericIssueProcessor(
        api_key=args.api_key,
        input_file=args.input,
        output_file=args.output,
        project_path=args.project,
        system_prompt=args.prompt,
        max_workers=args.workers,
        turn_limit=args.limit
    )
    processor.run()
