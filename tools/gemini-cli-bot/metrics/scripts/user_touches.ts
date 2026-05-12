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
          comments { totalCount }
          reviews { totalCount }
        }
      }
    }
    issues: search(query: $issueQuery, type: ISSUE, last: 100) {
      nodes {
        ... on Issue {
          authorAssociation
          comments { totalCount }
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

  const prs = data.prs.nodes.filter((p: any) => p && p.comments);
  const issues = data.issues.nodes.filter((i: any) => i && i.comments);

  const allItems = [
    ...prs.map(
      (p: {
        authorAssociation: string;
        comments: { totalCount: number };
        reviews?: { totalCount: number };
      }) => ({
        association: p.authorAssociation,
        touches: p.comments.totalCount + (p.reviews ? p.reviews.totalCount : 0),
      }),
    ),
    ...issues.map(
      (i: { authorAssociation: string; comments: { totalCount: number } }) => ({
        association: i.authorAssociation,
        touches: i.comments.totalCount,
      }),
    ),
  ];

  const isMaintainer = (assoc: string) =>
    ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(assoc);

  const calculateAvg = (items: { touches: number; association: string }[]) =>
    items.length ? items.reduce((a, b) => a + b.touches, 0) / items.length : 0;

  const overall = calculateAvg(allItems);
  const maintainers = calculateAvg(
    allItems.filter((i) => isMaintainer(i.association)),
  );
  const community = calculateAvg(
    allItems.filter((i) => !isMaintainer(i.association)),
  );

  process.stdout.write(
    `user_touches_overall,${Math.round(overall * 100) / 100}\n`,
  );
  process.stdout.write(
    `user_touches_maintainers,${Math.round(maintainers * 100) / 100}\n`,
  );
  process.stdout.write(
    `user_touches_community,${Math.round(community * 100) / 100}\n`,
  );
} catch (err) {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
