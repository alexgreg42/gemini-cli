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
  const days = 7;
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const getItems = (type: 'prs' | 'issues') => {
    const field = type === 'prs' ? 'merged-at' : 'closed-at';
    const jsonFields = type === 'prs' ? 'authorAssociation,mergedAt' : 'authorAssociation,closedAt';
    const output = execSync(
      `gh search ${type} --repo ${GITHUB_OWNER}/${GITHUB_REPO} --${field} >=${sinceDate} --limit 1000 --json ${jsonFields}`,
      { encoding: 'utf-8' }
    );
    return JSON.parse(output);
  };

  const prs = getItems('prs').map((p: any) => ({
    association: p.authorAssociation,
    date: new Date(p.mergedAt).getTime(),
  }));

  const issues = getItems('issues').map((i: any) => ({
    association: i.authorAssociation,
    date: new Date(i.closedAt).getTime(),
  }));

  const isMaintainer = (assoc: string) =>
    ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(assoc);

  const calculateThroughput = (items: any[]) => items.length / days;

  const prOverall = calculateThroughput(prs);
  const prMaintainers = calculateThroughput(
    prs.filter((i) => isMaintainer(i.association))
  );
  const prCommunity = calculateThroughput(
    prs.filter((i) => !isMaintainer(i.association))
  );

  const issueOverall = calculateThroughput(issues);
  const issueMaintainers = calculateThroughput(
    issues.filter((i) => isMaintainer(i.association))
  );
  const issueCommunity = calculateThroughput(
    issues.filter((i) => !isMaintainer(i.association))
  );

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

