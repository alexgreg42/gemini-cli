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
        nodes {
          ... on Issue {
            authorAssociation
            comments { totalCount }
          }
        }
      }
      prs: search(query: $prQuery, type: ISSUE, first: 100) {
        nodes {
          ... on PullRequest {
            authorAssociation
            comments { totalCount }
            reviews { totalCount }
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

  const prs = data.prs.nodes;
  const issues = data.issues.nodes;

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

  process.stdout.write(`user_touches_overall,${Math.round(overall * 100) / 100}\n`);
  process.stdout.write(`user_touches_maintainers,${Math.round(maintainers * 100) / 100}\n`);
  process.stdout.write(`user_touches_community,${Math.round(community * 100) / 100}\n`);
} catch (err) {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
