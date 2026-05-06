/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';

async function getWorkflowMinutes(): Promise<Record<string, number>> {
  const sevenDaysAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const workflowMinutes: Record<string, number> = {};
  let token: string;
  let repoName: string;

  try {
    token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf-8',
    }).trim();
    const repoInfo = JSON.parse(
      execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], {
        encoding: 'utf-8',
      }),
    );
    repoName = repoInfo.nameWithOwner;
  } catch (err) {
    throw new Error(`Failed to initialize repository info: ${err}`);
  }

  let page = 1;
  const perPage = 100;
  let hasMore = true;
  const maxRuns = 5000;
  let totalRunsProcessed = 0;

  while (hasMore && totalRunsProcessed < maxRuns) {
    let output: string;
    try {
      output = execFileSync(
        'gh',
        [
          'api',
          `repos/${repoName}/actions/runs?created=>=${sevenDaysAgoDate}&per_page=${perPage}&page=${page}`,
        ],
        { encoding: 'utf-8' },
      );
    } catch (err) {
      process.stderr.write(`Failed to fetch page ${page}: ${err}\n`);
      break;
    }

    let workflow_runs: any[];
    try {
      const parsed = JSON.parse(output);
      workflow_runs = parsed.workflow_runs;
    } catch (err) {
      process.stderr.write(`Failed to parse runs JSON: ${err}\n`);
      break;
    }

    if (!workflow_runs || workflow_runs.length === 0) {
      hasMore = false;
      break;
    }

    const chunkSize = 20;
    for (let i = 0; i < workflow_runs.length; i += chunkSize) {
      const chunk = workflow_runs.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (r: { id: number; name?: string }) => {
          try {
            const res = await fetch(
              `https://api.github.com/repos/${repoName}/actions/runs/${r.id}/jobs`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: 'application/vnd.github.v3+json',
                },
              },
            );

            if (!res.ok) return;

            const { jobs } = (await res.json()) as { jobs: any[] };
            let runBillableMinutes = 0;

            for (const job of jobs || []) {
              if (!job.started_at || !job.completed_at) continue;
              const start = new Date(job.started_at).getTime();
              const end = new Date(job.completed_at).getTime();
              const durationMs = end - start;

              if (durationMs > 0) {
                runBillableMinutes += Math.ceil(durationMs / (1000 * 60));
              }
            }

            if (runBillableMinutes > 0) {
              const name = r.name || 'Unknown';
              workflowMinutes[name] =
                (workflowMinutes[name] || 0) + runBillableMinutes;
            }
          } catch {
            // Ignore failures for individual runs
          }
        }),
      );
    }

    totalRunsProcessed += workflow_runs.length;
    if (workflow_runs.length < perPage) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return workflowMinutes;
}

async function run() {
  try {
    const workflowMinutes = await getWorkflowMinutes();
    let totalMinutes = 0;

    for (const minutes of Object.values(workflowMinutes)) {
      totalMinutes += minutes;
    }

    process.stdout.write(`actions_spend_minutes,${totalMinutes}\n`);

    for (const [name, minutes] of Object.entries(workflowMinutes)) {
      const safeName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      process.stdout.write(
        `actions_spend_minutes_workflow:${safeName},${minutes}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

run();
