"""
Purpose: Exports analyzed JSON issue data into a human-readable CSV format.
This is typically the final step in the workflow, making the output suitable for sharing, spreadsheet import, or manual review.
"""
import argparse
import json
import csv
from datetime import datetime

parser = argparse.ArgumentParser(description="Export JSON issues to CSV.")
parser.add_argument("--input", default="data/bugs.json", help="Input JSON file")
parser.add_argument("--output", default="data/bugs.csv", help="Output CSV file")
args = parser.parse_args()

with open(args.input, 'r') as f:
    issues = json.load(f)

today = datetime.now().strftime("%Y-%m-%d")

with open(args.output, 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f, delimiter='\t')
    writer.writerow([
        'Issue ID', 'Title', 'Status', 'Assignee', 'Labels', 
        'Last Sync', 'Link', 'analysis', 'effort_level', 
        'reasoning', 'recommended_implementation'
    ])
    
    for issue in issues:
        num = issue.get('number')
        
        assignee_list = issue.get('assignees', [])
        if isinstance(assignee_list, dict) and 'nodes' in assignee_list:
            assignee_list = assignee_list['nodes']
        assignee = ", ".join([a.get('login', '') for a in assignee_list])
        
        labels_list = issue.get('labels', [])
        if isinstance(labels_list, dict) and 'nodes' in labels_list:
            labels_list = labels_list['nodes']
        labels = ", ".join([l.get('name', '') for l in labels_list])
        
        writer.writerow([
            num,
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

print(f"Successfully generated {args.output}")
