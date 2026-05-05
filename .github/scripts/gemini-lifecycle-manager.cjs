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
  const PR_NUDGE_LABEL = 'status/pr-nudge-sent';
  const EXEMPT_LABELS = [
    'pinned',
    'security',
    '🔒 maintainer only',
    'help wanted',
    '🗓️ Public Roadmap',
  ];

  const STALE_DAYS = 60;
  const CLOSE_DAYS = 14;
  const NO_RESPONSE_DAYS = 14;
  const PR_NUDGE_DAYS = 7;
  const PR_CLOSE_DAYS = 14;

  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);
  const closeThreshold = new Date(now.getTime() - CLOSE_DAYS * 24 * 60 * 60 * 1000);
  const noResponseThreshold = new Date(now.getTime() - NO_RESPONSE_DAYS * 24 * 60 * 60 * 1000);
  const prNudgeThreshold = new Date(now.getTime() - PR_NUDGE_DAYS * 24 * 60 * 60 * 1000);
  const prCloseThreshold = new Date(now.getTime() - PR_CLOSE_DAYS * 24 * 60 * 60 * 1000);

  /**
   * Helper to process items with pagination and rate-limit awareness
   */
  async function processItems(query, callback) {
    core.info(`Searching: ${query}`);
    const items = await github.paginate(github.rest.search.issuesAndPullRequests, {
      q: query,
      per_page: 100,
      sort: 'updated',
      order: 'asc',
    });

    core.info(`Found ${items.length} items.`);
    for (const item of items) {
      try {
        await callback(item);
      } catch (err) {
        core.error(`Error processing #${item.number}: ${err.message}`);
        // Continue to next item
      }
    }
  }

  // 1. Handle No-Response (status/need-information)
  // Removal: Check issues updated in the last 48h that have the label and >1 comment
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  await processItems(
    `repo:${owner}/${repo} is:open label:"${NEED_INFO_LABEL}" updated:>${twoDaysAgo.toISOString()} comments:>1`,
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
      if (
        lastComment &&
        !['OWNER', 'MEMBER', 'COLLABORATOR'].includes(lastComment.author_association) &&
        lastComment.user?.type !== 'Bot'
      ) {
        core.info(`Removing ${NEED_INFO_LABEL} from #${item.number} due to contributor response.`);
        if (!dryRun) {
          await github.rest.issues.removeLabel({
            owner,
            repo,
            issue_number: item.number,
            name: NEED_INFO_LABEL,
          }).catch(() => {});
        }
      }
    }
  );

  // Closure: Check issues with the label that haven't been updated in 14 days
  await processItems(
    `repo:${owner}/${repo} is:open label:"${NEED_INFO_LABEL}" updated:<${noResponseThreshold.toISOString()}`,
    async (item) => {
      core.info(`Closing #${item.number} due to no response for ${NO_RESPONSE_DAYS} days.`);
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
    }
  );

  // 2. Handle Stale Mark (60 days inactivity, no stale label)
  const exemptQuery = EXEMPT_LABELS.map((l) => `-label:"${l}"`).join(' ');
  await processItems(
    `repo:${owner}/${repo} is:open -label:"${STALE_LABEL}" ${exemptQuery} updated:<${staleThreshold.toISOString()}`,
    async (item) => {
      core.info(`Marking #${item.number} as stale.`);
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
          body: `This item has been automatically marked as stale due to ${STALE_DAYS} days of inactivity. It will be closed in ${CLOSE_DAYS} days if no further activity occurs. Thank you!`,
        });
      }
    }
  );

  // 3. Handle Stale Close (14 days with stale label)
  await processItems(
    `repo:${owner}/${repo} is:open label:"${STALE_LABEL}" ${exemptQuery} updated:<${closeThreshold.toISOString()}`,
    async (item) => {
      core.info(`Closing stale item #${item.number}.`);
      if (!dryRun) {
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: item.number,
          body: `This item has been closed due to ${CLOSE_DAYS} additional days of inactivity after being marked as stale. If you believe this is still relevant, feel free to comment or reopen. Thank you!`,
        });
        await github.rest.issues.update({
          owner,
          repo,
          issue_number: item.number,
          state: 'closed',
        });
      }
    }
  );

  // 4. Handle PR Contribution Policy (Nudge at 7d, Close at 14d)
  // Nudge: Older than 7d and no nudge label
  await processItems(
    `repo:${owner}/${repo} is:open is:pr -label:"help wanted" -label:"🔒 maintainer only" -label:"${PR_NUDGE_LABEL}" created:<${prNudgeThreshold.toISOString()}`,
    async (pr) => {
      if (['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association) || pr.user?.type === 'Bot') return;

      core.info(`Nudging PR #${pr.number} for contribution policy.`);
      if (!dryRun) {
        await github.rest.issues.addLabels({
          owner,
          repo,
          issue_number: pr.number,
          labels: [PR_NUDGE_LABEL],
        });
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: pr.number,
          body: "Hi there! Thank you for your interest in contributing to Gemini CLI. \n\nTo ensure we maintain high code quality and focus on our prioritized roadmap, we only guarantee review and consideration of pull requests for issues that are explicitly labeled as 'help wanted'. \n\nThis PR will be closed in 7 days if it remains without that designation. We encourage you to find and contribute to existing 'help wanted' issues in our backlog! Thank you for your understanding.",
        });
      }
    }
  );

  // Close: Has nudge label AND older than 14d AND untouched for 7d (grace period)
  await processItems(
    `repo:${owner}/${repo} is:open is:pr label:"${PR_NUDGE_LABEL}" -label:"help wanted" -label:"🔒 maintainer only" created:<${prCloseThreshold.toISOString()} updated:<${prNudgeThreshold.toISOString()}`,
    async (pr) => {
      if (['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association) || pr.user?.type === 'Bot') return;

      core.info(`Closing PR #${pr.number} per contribution policy (no 'help wanted' and grace period elapsed).`);
      if (!dryRun) {
        await github.rest.issues.createComment({
          owner,
          repo,
          issue_number: pr.number,
          body: "This pull request is being closed as it has been open for 14 days without a 'help wanted' designation. We encourage you to find and contribute to existing 'help wanted' issues in our backlog! Thank you for your understanding.",
        });
        await github.rest.pulls.update({
          owner,
          repo,
          pull_number: pr.number,
          state: 'closed',
        });
      }
    }
  );
};
