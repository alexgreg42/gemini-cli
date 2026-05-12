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
    const jsonFields = type === 'prs' ? 'authorAssociation,comments,reviews' : 'authorAssociation,comments';
    const output = execSync(
      `gh search ${type} --repo ${GITHUB_OWNER}/${GITHUB_REPO} --${field} >=${sinceDate} --limit 1000 --json ${jsonFields}`,
      { encoding: 'utf-8' }
    );
    return JSON.parse(output);
  };

  const prs = getItems('prs').map((p: any) => ({
    association: p.authorAssociation,
    touches: (p.comments?.length || 0) + (p.reviews?.length || 0),
  }));

  const issues = getItems('issues').map((i: any) => ({
    association: i.authorAssociation,
    touches: i.comments?.length || 0,
  }));

  const allItems = [...prs, ...issues];

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

