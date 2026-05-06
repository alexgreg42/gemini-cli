"""
Purpose: Automatically categorizes GitHub issues as 'bug' or 'feature' and applies the corresponding label on GitHub.
It fetches issues matching a search URL, uses the Gemini API to classify them, and runs 'gh issue edit' to update GitHub.
"""
import argparse
import urllib.parse
import urllib.request
import json
import subprocess
import sys
import concurrent.futures

MODEL = "gemini-3-flash-preview"

ISSUE_TYPES = {
    "bug": "IT_kwDOCaSVvs4BR7vP",
    "feature": "IT_kwDOCaSVvs4BR7vQ"
}

def fetch_issues(search_query, limit):
    cmd = ["gh", "issue", "list", "--search", search_query, "--limit", str(limit), "--json", "id,number,title,body,url"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(res.stdout)
    except subprocess.CalledProcessError as e:
        print(f"Error fetching issues: {e.stderr}", file=sys.stderr)
        sys.exit(1)

def categorize_issue(issue, api_key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={api_key}"
    prompt = f"""
Analyze the following GitHub issue and determine if it is a bug or a feature request.
Reply ONLY with a valid JSON object matching exactly this schema, without Markdown formatting:
{{"type": "bug" | "feature", "reasoning": "brief justification"}}

Issue Title: {issue.get('title')}
Issue Body: {issue.get('body', '')[:1500]}
"""
    data = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1}
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
        print(f"Error processing issue {issue['number']}: {e}")
        return None

def process_issue(issue, api_key):
    print(f"Categorizing Issue #{issue['number']}...")
    result = categorize_issue(issue, api_key)
    if not result or 'type' not in result:
        print(f"Failed to categorize #{issue['number']}.")
        return

    issue_type = result['type']
    label = f"type/{issue_type}"
    print(f"Issue #{issue['number']} is a {issue_type}. Applying label '{label}' and setting Issue Type on GitHub...")
    
    # 1. Add label via gh issue edit
    cmd_label = ["gh", "issue", "edit", str(issue['number']), "--add-label", label]
    try:
        subprocess.run(cmd_label, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error labeling #{issue['number']}: {e.stderr}", file=sys.stderr)

    # 2. Set the native GitHub Issue Type using GraphQL
    type_node_id = ISSUE_TYPES.get(issue_type)
    issue_node_id = issue.get('id')
    
    if type_node_id and issue_node_id:
        mutation = f"""
        mutation {{
          updateIssue(input: {{id: "{issue_node_id}", issueTypeId: "{type_node_id}"}}) {{
            issue {{
              id
            }}
          }}
        }}
        """
        cmd_type = ["gh", "api", "graphql", "-f", f"query={mutation}"]
        try:
            subprocess.run(cmd_type, capture_output=True, text=True, check=True)
            print(f"Successfully labeled and set native Issue Type for #{issue['number']}.")
        except subprocess.CalledProcessError as e:
            print(f"Error setting Issue Type for #{issue['number']}: {e.stderr}", file=sys.stderr)
    else:
        print(f"Could not resolve node IDs to set native Issue Type for #{issue['number']}.")

def main():
    parser = argparse.ArgumentParser(description="Auto-categorize GitHub issues (bug vs feature) from a GitHub URL and apply labels on GitHub.")
    parser.add_argument("url", help="The full GitHub Issues search URL (e.g., https://github.com/.../issues/?q=...)")
    parser.add_argument("--api-key", required=True, help="Gemini API Key")
    parser.add_argument("--limit", type=int, default=50, help="Maximum number of issues to process")
    args = parser.parse_args()

    parsed_url = urllib.parse.urlparse(args.url)
    query_params = urllib.parse.parse_qs(parsed_url.query)
    
    if 'q' in query_params:
        search_query = query_params['q'][0]
    else:
        print("Warning: No 'q=' search parameter found in URL. Fetching default open issues.")
        search_query = "is:issue is:open"

    if 'repo:' not in search_query:
        path_parts = [p for p in parsed_url.path.split('/') if p]
        if len(path_parts) >= 2:
            repo = f"{path_parts[0]}/{path_parts[1]}"
            search_query = f"repo:{repo} {search_query}"

    print(f"Fetching issues matching: '{search_query}'")
    issues = fetch_issues(search_query, args.limit)
    if not issues:
        print("No issues found matching the query.")
        return

    print(f"Found {len(issues)} issues to categorize.")
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(process_issue, issue, args.api_key) for issue in issues]
        concurrent.futures.wait(futures)
        
    print("Done categorizing issues.")

if __name__ == '__main__':
    main()
