import json
import csv
from datetime import datetime

ISSUES_FILE = 'data/issues.json'
METADATA_FILE = 'data/metadata.json'
CSV_FILE = 'data/issues.csv'

with open(ISSUES_FILE, 'r') as f:
    issues = json.load(f)

with open(METADATA_FILE, 'r') as f:
    metadata_list = json.load(f)

# Create lookup map for metadata
metadata_map = {m['number']: m for m in metadata_list}

today = "2026-04-21"

with open(CSV_FILE, 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f, delimiter='\t') # Use tab as delimiter for easier copy-paste into Sheets
    # Header
    writer.writerow([
        'Issue ID', 'Title', 'Status', 'Assignee', 'Labels', 
        'Last Sync', 'Link', 'analysis', 'effort_level', 
        'reasoning', 'recommended_implementation'
    ])
    
    for issue in issues:
        num = issue.get('number')
        meta = metadata_map.get(num, {})
        
        assignee = ", ".join([a['login'] for a in meta.get('assignees', [])])
        labels = ", ".join([l['name'] for l in meta.get('labels', [])])
        
        writer.writerow([
            num,
            issue.get('title', ''),
            meta.get('state', 'open'),
            assignee,
            labels,
            today,
            issue.get('url', ''),
            issue.get('analysis', ''),
            issue.get('effort_level', ''),
            issue.get('reasoning', ''),
            issue.get('recommended_implementation', '')
        ])

print(f"Successfully generated {CSV_FILE}")
