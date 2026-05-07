/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { GITHUB_OWNER, GITHUB_REPO } from '../types.js';

/**
 * This script calculates the triage accuracy by detecting human overrides of bot-applied labels.
 * It identifies the first 'area/' label added by a bot and checks if it was later removed
 * or replaced by a human.
 */
async function run() {
  try {
    const query = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        issues(last: 100, orderBy: {field: CREATED_AT, direction: ASC}) {
          nodes {
            number
            timelineItems(last: 50, itemTypes: [LABELED_EVENT, UNLABELED_EVENT]) {
              nodes {
                __typename
                ... on LabeledEvent {
                  label { name }
                  actor { login }
                  createdAt
                }
                ... on UnlabeledEvent {
                  label { name }
                  actor { login }
                  createdAt
                }
              }
            }
          }
        }
      }
    }
    `;

    const output = execSync(
      `gh api graphql -F owner=${GITHUB_OWNER} -F repo=${GITHUB_REPO} -f query='${query}'`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );

    const response = JSON.parse(output);
    if (response.errors) {
      throw new Error(`GraphQL Errors: ${JSON.stringify(response.errors)}`);
    }

    const issues = response.data?.repository?.issues?.nodes || [];

    let botLabeledCount = 0;
    let overrideCount = 0;

    const isBot = (login: string) =>
      login.toLowerCase().includes('[bot]') || login === 'gemini-cli-robot';

    for (const issue of issues) {
      if (!issue) continue;
      const events = (issue.timelineItems?.nodes || []) as any[];
      
      // Find first area/ label added by a bot
      const firstBotLabelEvent = events.find(
        (e: any) =>
          e.__typename === 'LabeledEvent' &&
          e.label.name.startsWith('area/') &&
          e.actor?.login &&
          isBot(e.actor.login)
      );

      if (firstBotLabelEvent) {
        botLabeledCount++;
        const botLabelName = firstBotLabelEvent.label.name;
        const botLabelTime = new Date(firstBotLabelEvent.createdAt).getTime();

        // Check for overrides after this event
        const isOverridden = events.some((e: any) => {
          const eventTime = new Date(e.createdAt).getTime();
          if (eventTime <= botLabelTime) return false;

          const actorLogin = e.actor?.login;
          if (!actorLogin || isBot(actorLogin)) return false;

          // Case 1: Human removed the bot's label
          if (e.__typename === 'UnlabeledEvent' && e.label.name === botLabelName) {
            return true;
          }

          // Case 2: Human added a different area/ label
          if (
            e.__typename === 'LabeledEvent' &&
            e.label.name.startsWith('area/') &&
            e.label.name !== botLabelName
          ) {
            return true;
          }

          return false;
        });

        if (isOverridden) {
          overrideCount++;
        }
      }
    }

    const accuracyRate = botLabeledCount > 0
      ? (botLabeledCount - overrideCount) / botLabeledCount
      : 1;

    process.stdout.write(`triage_accuracy_overrides,${overrideCount}\n`);
    process.stdout.write(`triage_accuracy_total_bot_labeled,${botLabeledCount}\n`);
    process.stdout.write(`triage_accuracy_rate,${Math.round(accuracyRate * 100) / 100}\n`);

  } catch (err) {
    process.stderr.write(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

run();
