/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GITHUB_OWNER, GITHUB_REPO } from '../types.js';
import { execSync } from 'node:child_process';

try {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const query = `
  query($owner: String!, $repo: String!, $issueQuery: String!, $prQuery: String!) {
    repository(owner: $owner, name: $repo) {
      issues: search(query: $issueQuery, type: ISSUE, first: 100) {
        issueCount
        nodes {
          ... on Issue {
            authorAssociation
            closedAt
          }
        }
      }
      prs: search(query: $prQuery, type: ISSUE, first: 100) {
        issueCount
        nodes {
          ... on PullRequest {
            authorAssociation
            mergedAt
          }
        }
      }
    }
  }
  `;

  const issueQuery = `repo:${GITHUB_OWNER}/${GITHUB_REPO} is:issue is:closed closed:>${sevenDaysAgo.split('T')[0]} sort:closed-desc`;
  const prQuery = `repo:${GITHUB_OWNER}/${GITHUB_REPO} is:pr is:merged merged:>${sevenDaysAgo.split('T')[0]} sort:merged-desc`;

  const output = execSync(
    `gh api graphql -F owner=${GITHUB_OWNER} -F repo=${GITHUB_REPO} -F issueQuery='${issueQuery}' -F prQuery='${prQuery}' -f query='${query}'`,
    { encoding: 'utf-8' },
  );
  const data = JSON.parse(output).data.repository;

  const isMaintainer = (assoc: string) =>
    ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(assoc);

  const issueNodes = data.issues.nodes;
  const prNodes = data.prs.nodes;

  const issueOverall = data.issues.issueCount / 7;
  const issueMaintainers = (issueNodes.filter((i: any) => isMaintainer(i.authorAssociation)).length / Math.min(issueNodes.length || 1, 100)) * issueOverall;
  const issueCommunity = issueOverall - issueMaintainers;

  const prOverall = data.prs.issueCount / 7;
  const prMaintainers = (prNodes.filter((p: any) => isMaintainer(p.authorAssociation)).length / Math.min(prNodes.length || 1, 100)) * prOverall;
  const prCommunity = prOverall - prMaintainers;

  process.stdout.write(`throughput_pr_overall_per_day,${Math.round(prOverall * 100) / 100}\n`);
  process.stdout.write(`throughput_pr_maintainers_per_day,${Math.round(prMaintainers * 100) / 100}\n`);
  process.stdout.write(`throughput_pr_community_per_day,${Math.round(prCommunity * 100) / 100}\n`);
  process.stdout.write(`throughput_issue_overall_per_day,${Math.round(issueOverall * 100) / 100}\n`);
  process.stdout.write(`throughput_issue_maintainers_per_day,${Math.round(issueMaintainers * 100) / 100}\n`);
  process.stdout.write(`throughput_issue_community_per_day,${Math.round(issueCommunity * 100) / 100}\n`);
  process.stdout.write(`throughput_issue_overall_days_per_issue,${issueOverall > 0 ? Math.round((1 / issueOverall) * 100) / 100 : 0}\n`);
  process.stdout.write(`throughput_issue_maintainers_days_per_issue,${issueMaintainers > 0 ? Math.round((1 / issueMaintainers) * 100) / 100 : 0}\n`);
  process.stdout.write(`throughput_issue_community_days_per_issue,${issueCommunity > 0 ? Math.round((1 / issueCommunity) * 100) / 100 : 0}\n`);
} catch (err) {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
