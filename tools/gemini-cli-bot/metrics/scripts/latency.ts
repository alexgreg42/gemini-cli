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
          createdAt
          mergedAt
        }
      }
    }
    issues: search(query: $issueQuery, type: ISSUE, last: 100) {
      nodes {
        ... on Issue {
          authorAssociation
          createdAt
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
    .filter((p: any) => p && p.mergedAt && p.createdAt)
    .map(
      (p: any) => ({
        association: p.authorAssociation,
        latencyHours:
          (new Date(p.mergedAt).getTime() - new Date(p.createdAt).getTime()) /
          (1000 * 60 * 60),
      }),
    );
  const issues = data.issues.nodes
    .filter((i: any) => i && i.closedAt && i.createdAt)
    .map(
      (i: any) => ({
        association: i.authorAssociation,
        latencyHours:
          (new Date(i.closedAt).getTime() - new Date(i.createdAt).getTime()) /
          (1000 * 60 * 60),
      }),
    );

  const isMaintainer = (assoc: string) =>
    ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(assoc);
  const calculateAvg = (
    items: { association: string; latencyHours: number }[],
  ) =>
    items.length
      ? items.reduce((a, b) => a + b.latencyHours, 0) / items.length
      : 0;

  const prMaintainers = calculateAvg(
    prs.filter((i: { association: string; latencyHours: number }) =>
      isMaintainer(i.association),
    ),
  );
  const prCommunity = calculateAvg(
    prs.filter(
      (i: { association: string; latencyHours: number }) =>
        !isMaintainer(i.association),
    ),
  );
  const prOverall = calculateAvg(prs);

  const issueMaintainers = calculateAvg(
    issues.filter((i: { association: string; latencyHours: number }) =>
      isMaintainer(i.association),
    ),
  );
  const issueCommunity = calculateAvg(
    issues.filter(
      (i: { association: string; latencyHours: number }) =>
        !isMaintainer(i.association),
    ),
  );
  const issueOverall = calculateAvg(issues);

  process.stdout.write(
    `latency_pr_overall_hours,${Math.round(prOverall * 100) / 100}\n`,
  );
  process.stdout.write(
    `latency_pr_maintainers_hours,${Math.round(prMaintainers * 100) / 100}\n`,
  );
  process.stdout.write(
    `latency_pr_community_hours,${Math.round(prCommunity * 100) / 100}\n`,
  );
  process.stdout.write(
    `latency_issue_overall_hours,${Math.round(issueOverall * 100) / 100}\n`,
  );
  process.stdout.write(
    `latency_issue_maintainers_hours,${Math.round(issueMaintainers * 100) / 100}\n`,
  );
  process.stdout.write(
    `latency_issue_community_hours,${Math.round(issueCommunity * 100) / 100}\n`,
  );
} catch (err) {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
