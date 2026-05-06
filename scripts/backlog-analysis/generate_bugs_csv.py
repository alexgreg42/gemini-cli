import json
import csv
from datetime import datetime

BUGS_FILE = 'data/bugs.json'
METADATA_FILE = 'data/metadata_bugs.json'
CSV_FILE = 'data/bugs.csv'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

with open(METADATA_FILE, 'r') as f:
    metadata_list = json.load(f)

metadata_map = {m['number']: m for m in metadata_list}
today = "2026-04-21"

with open(CSV_FILE, 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f, delimiter='\t')
    writer.writerow([
        'Issue ID', 'Title', 'Status', 'Assignee', 'Labels', 
        'Last Sync', 'Link', 'analysis', 'effort_level', 
        'reasoning', 'recommended_implementation'
    ])
    
    for bug in bugs:
        num = bug.get('number')
        meta = metadata_map.get(num, {})
        
        assignee = ", ".join([a['login'] for a in meta.get('assignees', [])])
        labels = ", ".join([l['name'] for l in meta.get('labels', [])])
        
        writer.writerow([
            num,
            bug.get('title', ''),
            meta.get('state', 'open'),
            assignee,
            labels,
            today,
            bug.get('url', ''),
            bug.get('analysis', ''),
            bug.get('effort_level', ''),
            bug.get('reasoning', ''),
            bug.get('recommended_implementation', '')
        ])

print(f"Successfully generated {CSV_FILE}")
