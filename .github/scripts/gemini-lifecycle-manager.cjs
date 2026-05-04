/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gemini Scheduled Lifecycle Manager Script
 * @param {object} param0
 * @param {import('@octokit/rest').Octokit} param0.github
 * @param {import('@actions/github/lib/context').Context} param0.context
 * @param {import('@actions/core')} param0.core
 */
module.exports = async ({ github, context, core }) => {
  const dryRun = process.env.DRY_RUN === 'true';
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  const STALE_LABEL = 'stale';
  const NEED_INFO_LABEL = 'status/need-information';
  const EXEMPT_LABELS = [
    'pinned',
    'security',
    '🔒 maintainer only',
    'help wanted',
    '🗓️ Public Roadmap',
  ];

  // Optimizing for high backlog (2000+ issues)
  const STALE_DAYS = 30; // Reduced from 60
  const CLOSE_DAYS = 7;  // Reduced from 14
  const NO_RESPONSE_DAYS = 14;

  const now = new Date();
  const staleThreshold = new Date(
    now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000,
  );
  const closeThreshold = new Date(
    now.getTime() - CLOSE_DAYS * 24 * 60 * 60 * 1000,
  );
  const noResponseThreshold = new Date(
    now.getTime() - NO_RESPONSE_DAYS * 24 * 60 * 60 * 1000,
  );

  async function processItems(query, callback) {
    core.info(`Searching: ${query}`);
    try {
      // Use github.paginate to handle > 100 items per run
      const items = await github.paginate(github.rest.search.issuesAndPullRequests, {
        q: query,
        sort: 'updated',
        order: 'asc',
        per_page: 100,
      });

      core.info(`Found ${items.length} items.`);
      for (const item of items) {
        try {
          await callback(item);
        } catch (err) {
          core.error(`Error processing #${item.number}: ${err.message}`);
        }
      }
    } catch (err) {
      core.error(`Search failed: ${err.message}`);
    }
  }

  // 1. Handle No-Response (status/need-information)
  // Removal: Check issues updated recently that have the label
  const checkRecentThreshold = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  await processItems(
    `repo:${owner}/${repo} is:open label:"${NEED_INFO_LABEL}" updated:>${checkRecentThreshold.toISOString()}`,
    async (item) => {
      const { data: comments } = await github.rest.issues.listComments({
        owner,
        repo,
        issue_number: item.number,
        sort: 'created',
        direction: 'desc',
        per_page: 5,
      });

      // Check if the last comment is from a non-maintainer
      const lastComment = comments[0];
      if (
        lastComment &&
        !['OWNER', 'MEMBER', 'COLLABORATOR'].includes(
          lastComment.author_association,
        ) &&
        lastComment.user?.type !== 'Bot'
      ) {
        core.info(
          `Removing ${NEED_INFO_LABEL} from #${item.number} due to contributor response.`,
        );
        if (!dryRun) {
          await github.rest.issues
            .removeLabel({
              owner,
              repo,
              issue_number: item.number,
              name: NEED_INFO_LABEL,
            })
            .catch(() => {});
        }
      }
    },
  );

  // Closure: Check issues with the label that haven't been updated in 14 days
  await processItems(
    `repo:${owner}/${repo} is:open label:"${NEED_INFO_LABEL}" updated:<${noResponseThreshold.toISOString()}`,
    async (item) => {
      core.info(
        `Closing #${item.number} due to no response for ${NO_RESPONSE_DAYS} days.`,
      );
      if (!dryRun) {
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: item.number,
          body: `This item was marked as needing more information and has not received a response in ${NO_RESPONSE_DAYS} days. Closing it for now. If you still face this problem, feel free to reopen with more details. Thank you!`,
        });
        await github.rest.issues.update({
          owner,
          repo,
          issue_number: item.number,
          state: 'closed',
        });
      }
    },
  );

  // 2. Handle Stale Issues (30 days inactivity)
  const exemptQuery = EXEMPT_LABELS.map((l) => `-label:"${l}"`).join(' ');

  // Removal: Remove stale label if there is new activity
  await processItems(
    `repo:${owner}/${repo} is:open is:issue label:"${STALE_LABEL}" updated:>${checkRecentThreshold.toISOString()}`,
    async (item) => {
      const { data: comments } = await github.rest.issues.listComments({
        owner,
        repo,
        issue_number: item.number,
        sort: 'created',
        direction: 'desc',
        per_page: 5,
      });

      const lastComment = comments[0];
      if (lastComment && lastComment.user?.type !== 'Bot') {
        core.info(`Removing ${STALE_LABEL} from #${item.number} due to activity.`);
        if (!dryRun) {
          await github.rest.issues
            .removeLabel({
              owner,
              repo,
              issue_number: item.number,
              name: STALE_LABEL,
            })
            .catch(() => {});
        }
      }
    },
  );

  // Mark: Mark issues as stale
  await processItems(
    `repo:${owner}/${repo} is:open is:issue -label:"${STALE_LABEL}" ${exemptQuery} updated:<${staleThreshold.toISOString()}`,
    async (item) => {
      core.info(`Marking issue #${item.number} as stale.`);
      if (!dryRun) {
        await github.rest.issues.addLabels({
          owner,
          repo,
          issue_number: item.number,
          labels: [STALE_LABEL],
        });
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: item.number,
          body: `This issue has been automatically marked as stale due to ${STALE_DAYS} days of inactivity. It will be closed in ${CLOSE_DAYS} days if no further activity occurs. Thank you!`,
        });
      }
    },
  );

  // Close: Handle Stale Close (7 days with stale label)
  await processItems(
    `repo:${owner}/${repo} is:open is:issue label:"${STALE_LABEL}" ${exemptQuery} updated:<${closeThreshold.toISOString()}`,
    async (item) => {
      core.info(`Closing stale issue #${item.number}.`);
      if (!dryRun) {
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: item.number,
          body: `This issue has been closed due to ${CLOSE_DAYS} additional days of inactivity after being marked as stale. If you believe this is still relevant, feel free to comment or reopen. Thank you!`,
        });
        await github.rest.issues.update({
          owner,
          repo,
          issue_number: item.number,
          state: 'closed',
        });
      }
    },
  );

  // 3. Handle PR Contribution Policy (Nudge at 7d, Close 7d after nudge)
  const PR_NUDGE_DAYS = 7;
  const nudgeThreshold = new Date(
    now.getTime() - PR_NUDGE_DAYS * 24 * 60 * 60 * 1000,
  );

  // Nudge: PRs older than 7 days without 'help wanted' and not yet nudged
  await processItems(
    `repo:${owner}/${repo} is:open is:pr -label:"help wanted" -label:"🔒 maintainer only" -label:"status/pr-nudge-sent" created:<${nudgeThreshold.toISOString()}`,
    async (pr) => {
      if (
        ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association) ||
        pr.user?.type === 'Bot'
      )
        return;

      core.info(`Nudging PR #${pr.number} for contribution policy.`);
      if (!dryRun) {
        await github.rest.issues.addLabels({
          owner,
          repo,
          issue_number: pr.number,
          labels: ['status/pr-nudge-sent'],
        });
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: pr.number,
          body: "Hi there! Thank you for your interest in contributing to Gemini CLI. \n\nTo ensure we maintain high code quality and focus on our prioritized roadmap, we only guarantee review and consideration of pull requests for issues that are explicitly labeled as 'help wanted'. \n\nThis PR will be closed in 7 days if it remains without that designation. We encourage you to find and contribute to existing 'help wanted' issues in our backlog! Thank you for your understanding.",
        });
      }
    },
  );

  // Close: PRs that were nudged at least 7 days ago and still don't have 'help wanted'
  await processItems(
    `repo:${owner}/${repo} is:open is:pr -label:"help wanted" -label:"🔒 maintainer only" label:"status/pr-nudge-sent" updated:<${nudgeThreshold.toISOString()}`,
    async (pr) => {
      if (
        ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association) ||
        pr.user?.type === 'Bot'
      )
        return;

      core.info(
        `Closing PR #${pr.number} per contribution policy (no 'help wanted' after grace period).`,
      );
      if (!dryRun) {
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: pr.number,
          body: "This pull request is being closed as it has been open for at least 14 days (including a 7-day grace period) without a 'help wanted' designation. We encourage you to find and contribute to existing 'help wanted' issues in our backlog! Thank you for your understanding.",
        });
        await github.rest.pulls.update({
          owner,
          repo,
          pull_number: pr.number,
          state: 'closed',
        });
      }
    },
  );
};
