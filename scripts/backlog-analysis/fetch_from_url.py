"""
Purpose: Fetches issues from GitHub using a standard GitHub Issues search URL.
It parses the URL to extract the search query (the 'q=' parameter) and uses the GitHub CLI ('gh') to download the matching issues into a JSON file, ready for analysis.
"""
import argparse
import urllib.parse
import subprocess
import json
import sys
import os

def main():
    parser = argparse.ArgumentParser(description="Fetch GitHub issues from a search URL.")
    parser.add_argument("url", help="The full GitHub Issues search URL (e.g., https://github.com/.../issues/?q=...)")
    parser.add_argument("--output", default="data/bugs.json", help="Path to save the output JSON (default: data/bugs.json)")
    parser.add_argument("--limit", type=int, default=1000, help="Maximum number of issues to fetch")
    
    args = parser.parse_args()
    
    parsed_url = urllib.parse.urlparse(args.url)
    query_params = urllib.parse.parse_qs(parsed_url.query)
    
    # Extract the 'q' parameter. If there isn't one, we default to whatever the URL represents 
    # but gh CLI requires explicit search terms or just fetching the repo.
    if 'q' in query_params:
        search_query = query_params['q'][0]
    else:
        print("Warning: No 'q=' search parameter found in URL. Fetching default open issues.")
        search_query = "is:issue is:open"

    # Ensure repo context is attached if not already in the query
    if 'repo:' not in search_query:
        # Try to extract repo from URL path (e.g., /google-gemini/gemini-cli/issues)
        path_parts = [p for p in parsed_url.path.split('/') if p]
        if len(path_parts) >= 2:
            repo = f"{path_parts[0]}/{path_parts[1]}"
            search_query = f"repo:{repo} {search_query}"
            
    print(f"Extracted Search Query: {search_query}")
    print(f"Fetching up to {args.limit} issues...")
    
    # Required fields for our analysis tools
    fields = "number,title,body,url,labels,assignees,state"
    
    cmd = [
        "gh", "issue", "list", 
        "--search", search_query, 
        "--limit", str(args.limit),
        "--json", fields
    ]
    
    try:
        # Run gh CLI
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        issues = json.loads(result.stdout)
        
        # Ensure data directory exists
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        
        with open(args.output, 'w') as f:
            json.dump(issues, f, indent=2)
            
        print(f"Successfully fetched {len(issues)} issues and saved to {args.output}")
        
    except subprocess.CalledProcessError as e:
        print(f"Error running GitHub CLI: {e.stderr}", file=sys.stderr)
        print("Make sure you have the 'gh' CLI installed and authenticated (gh auth login).", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError:
        print("Error: GitHub CLI did not return valid JSON.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
