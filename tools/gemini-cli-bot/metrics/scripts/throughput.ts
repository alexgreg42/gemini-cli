/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { GITHUB_OWNER, GITHUB_REPO } from '../types.js';
import { execSync } from 'node:child_process';

try {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const query = `
  query($prQuery: String!, $issueQuery: String!) {
    prs: search(query: $prQuery, type: ISSUE, last: 100) {
      nodes {
        ... on PullRequest {
          authorAssociation
          mergedAt
        }
      }
    }
    issues: search(query: $issueQuery, type: ISSUE, last: 100) {
      nodes {
        ... on Issue {
          authorAssociation
          closedAt
        }
      }
    }
  }
  `;
  const prSearchQuery = `repo:${GITHUB_OWNER}/${GITHUB_REPO} is:pr is:merged merged:>${sevenDaysAgo}`;
  const issueSearchQuery = `repo:${GITHUB_OWNER}/${GITHUB_REPO} is:issue is:closed closed:>${sevenDaysAgo}`;
  const output = execSync(
    `gh api graphql -F prQuery='${prSearchQuery}' -F issueQuery='${issueSearchQuery}' -f query='${query}'`,
    { encoding: 'utf-8' },
  );
  const data = JSON.parse(output).data;

  const prs = data.prs.nodes
    .filter((p: any) => p && p.mergedAt)
    .map((p: any) => ({
      association: p.authorAssociation,
      date: new Date(p.mergedAt).getTime(),
    }));

  const issues = data.issues.nodes
    .filter((i: any) => i && i.closedAt)
    .map((i: any) => ({
      association: i.authorAssociation,
      date: new Date(i.closedAt).getTime(),
    }));

  const isMaintainer = (assoc: string) =>
    ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(assoc);

  const calculateThroughput = (
    items: { association: string; date: number }[],
  ) => {
    return items.length / 7; // items per day over 7 day window
  };

  const prOverall = calculateThroughput(prs);
  const prMaintainers = calculateThroughput(
    prs.filter((i: { association: string; date: number }) =>
      isMaintainer(i.association),
    ),
  );
  const prCommunity = calculateThroughput(
    prs.filter(
      (i: { association: string; date: number }) =>
        !isMaintainer(i.association),
    ),
  );

  const issueOverall = calculateThroughput(issues);
  const issueMaintainers = calculateThroughput(
    issues.filter((i: { association: string; date: number }) =>
      isMaintainer(i.association),
    ),
  );
  const issueCommunity = calculateThroughput(
    issues.filter(
      (i: { association: string; date: number }) =>
        !isMaintainer(i.association),
    ),
  );

  process.stdout.write(
    `throughput_pr_overall_per_day,${Math.round(prOverall * 100) / 100}\n`,
  );
  process.stdout.write(
    `throughput_pr_maintainers_per_day,${Math.round(prMaintainers * 100) / 100}\n`,
  );
  process.stdout.write(
    `throughput_pr_community_per_day,${Math.round(prCommunity * 100) / 100}\n`,
  );
  process.stdout.write(
    `throughput_issue_overall_per_day,${Math.round(issueOverall * 100) / 100}\n`,
  );
  process.stdout.write(
    `throughput_issue_maintainers_per_day,${Math.round(issueMaintainers * 100) / 100}\n`,
  );
  process.stdout.write(
    `throughput_issue_community_per_day,${Math.round(issueCommunity * 100) / 100}\n`,
  );
  process.stdout.write(
    `throughput_issue_overall_days_per_issue,${issueOverall > 0 ? Math.round((1 / issueOverall) * 100) / 100 : 0}\n`,
  );
  process.stdout.write(
    `throughput_issue_maintainers_days_per_issue,${issueMaintainers > 0 ? Math.round((1 / issueMaintainers) * 100) / 100 : 0}\n`,
  );
  process.stdout.write(
    `throughput_issue_community_days_per_issue,${issueCommunity > 0 ? Math.round((1 / issueCommunity) * 100) / 100 : 0}\n`,
  );
} catch (err) {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
