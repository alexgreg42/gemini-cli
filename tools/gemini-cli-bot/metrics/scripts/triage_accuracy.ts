/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { GITHUB_OWNER, GITHUB_REPO } from '../types.js';

interface GitHubResponse {
  data?: {
    search?: {
      nodes?: Array<{
        number: number;
        timelineItems: {
          nodes: Array<LabeledEvent | UnlabeledEvent>;
        };
      } | null>;
    };
  };
  errors?: Array<{ message: string }>;
}

interface LabeledEvent {
  __typename: 'LabeledEvent';
  label: { name: string };
  actor: { login: string } | null;
  createdAt: string;
}

interface UnlabeledEvent {
  __typename: 'UnlabeledEvent';
  label: { name: string };
  actor: { login: string } | null;
  createdAt: string;
}

type TimelineEvent = LabeledEvent | UnlabeledEvent;

/**
 * This script calculates the triage accuracy by detecting human overrides of bot-applied labels.
 * It identifies the first 'area/' label added by a bot and checks if it was later removed
 * or replaced by a human.
 *
 * It uses the Search API to get a representative sample of recent issues.
 */
async function run() {
  try {
    // Increase sample size to 250 for a more representative set.
    // We sort by created-desc to get the most recent activity.
    const query = `
    query($searchQuery: String!) {
      search(query: $searchQuery, type: ISSUE, first: 250) {
        nodes {
          ... on Issue {
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

    const searchQuery = `repo:${GITHUB_OWNER}/${GITHUB_REPO} is:issue sort:created-desc`;
    const output = execSync(
      `gh api graphql -F searchQuery='${searchQuery}' -f query='${query}'`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );

    const response = JSON.parse(output) as GitHubResponse;
    if (response.errors) {
      throw new Error(`GraphQL Errors: ${JSON.stringify(response.errors)}`);
    }

    const issues = response.data?.search?.nodes || [];

    let botLabeledCount = 0;
    let overrideCount = 0;

    const isBot = (login: string) =>
      login.toLowerCase().includes('[bot]') || login === 'gemini-cli-robot';

    for (const issue of issues) {
      if (!issue || !('number' in issue)) continue;
      const events = (issue.timelineItems?.nodes || []) as TimelineEvent[];
      
      // Find first area/ label added by a bot
      const firstBotLabelEvent = events.find(
        (e: TimelineEvent) =>
          e.__typename === 'LabeledEvent' &&
          e.label.name.startsWith('area/') &&
          e.actor?.login &&
          isBot(e.actor.login)
      ) as LabeledEvent | undefined;

      if (firstBotLabelEvent) {
        botLabeledCount++;
        const botLabelName = firstBotLabelEvent.label.name;
        const botLabelTime = new Date(firstBotLabelEvent.createdAt).getTime();

        // Check for overrides after this event
        const isOverridden = events.some((e: TimelineEvent) => {
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
