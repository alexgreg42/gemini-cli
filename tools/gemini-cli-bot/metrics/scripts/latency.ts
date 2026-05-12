/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GITHUB_OWNER, GITHUB_REPO } from '../types.js';
import { execSync } from 'node:child_process';

try {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since = sevenDaysAgo.toISOString().split('T')[0];

  const query = `
  query($prQuery: String!, $issueQuery: String!) {
    prSearch: search(query: $prQuery, type: ISSUE, first: 100) {
      nodes {
        ... on PullRequest {
          authorAssociation
          createdAt
          mergedAt
        }
      }
    }
    issueSearch: search(query: $issueQuery, type: ISSUE, first: 100) {
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

  const prQuery = `repo:${GITHUB_OWNER}/${GITHUB_REPO} is:pr is:merged merged:>=${since}`;
  const issueQuery = `repo:${GITHUB_OWNER}/${GITHUB_REPO} is:issue is:closed closed:>=${since}`;

  const output = execSync(
    `gh api graphql -F prQuery='${prQuery}' -F issueQuery='${issueQuery}' -f query='${query}'`,
    { encoding: 'utf-8' },
  );
  const data = JSON.parse(output).data;

  const prs = (data?.prSearch?.nodes || [])
    .filter((p: any) => p && p.mergedAt)
    .map(
      (p: {
        authorAssociation: string;
        mergedAt: string;
        createdAt: string;
      }) => ({
        association: p.authorAssociation,
        latencyHours:
          (new Date(p.mergedAt).getTime() - new Date(p.createdAt).getTime()) /
          (1000 * 60 * 60),
      }),
    );

  const issues = (data?.issueSearch?.nodes || [])
    .filter((i: any) => i && i.closedAt)
    .map(
      (i: {
        authorAssociation: string;
        closedAt: string;
        createdAt: string;
      }) => ({
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
