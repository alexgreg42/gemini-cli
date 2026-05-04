/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const REVIEW_HEADER = '## 🤖 Gemini Bot Pre-review';

/**
 * Runs a shell command and returns the output.
 */
function runCommand(cmd: string, args: string[], options: any = {}): string {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      ...options,
    }).trim();
  } catch (err) {
    // Silence errors for expected failures or missing data
    return '';
  }
}

async function main() {
  console.log('Starting Gemini PR Pre-review Reflex...');

  // 1. Get open PRs
  const prsJson = runCommand('gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '20',
    '--json',
    'number,title,body,author,labels',
  ]);

  if (!prsJson) {
    console.log('No open PRs found or gh command failed.');
    return;
  }
  
  let prs;
  try {
    prs = JSON.parse(prsJson);
  } catch (err) {
    console.error('Failed to parse PR list JSON.');
    return;
  }

  for (const pr of prs) {
    // Skip bot PRs
    if (pr.author.login.includes('[bot]') || pr.author.login.includes('robot')) {
      continue;
    }

    // 2. Check if already reviewed by the bot
    const commentsJson = runCommand('gh', [
      'pr',
      'view',
      pr.number.toString(),
      '--json',
      'comments',
    ]);
    if (!commentsJson) continue;
    
    let comments;
    try {
      comments = JSON.parse(commentsJson).comments;
    } catch (err) {
      continue;
    }
    
    const alreadyReviewed = comments.some(
      (c: any) => c.body && c.body.includes(REVIEW_HEADER),
    );

    if (alreadyReviewed) {
      console.log(`PR #${pr.number} already has a Gemini pre-review. Skipping.`);
      continue;
    }

    console.log(`Pre-reviewing PR #${pr.number}: ${pr.title}`);

    // 3. Get Diff
    const diff = runCommand('gh', ['pr', 'diff', pr.number.toString()]);
    if (!diff) {
      console.log(`Could not get diff for PR #${pr.number}.`);
      continue;
    }

    // 4. Prepare Prompt
    const roadmapPath = join(process.cwd(), 'ROADMAP.md');
    const roadmap = existsSync(roadmapPath) ? readFileSync(roadmapPath, 'utf-8') : 'No roadmap found.';
    
    const prompt = `
You are the Gemini CLI Bot. Your task is to perform a pre-review of a Pull Request.
Provide a high-level assessment based on:
1. **Objective measures of quality**: (code structure, tests, documentation, performance).
2. **Alignment with the project roadmap**: (roadmap provided below).
3. **Identification of "obvious wins"**: (significant improvements, critical bug fixes, "good to go" small PRs).
4. **Conformity with TypeScript and repository best practices**: (license headers, type safety, naming conventions).

Roadmap:
${roadmap}

PR Title: ${pr.title}
PR Body: ${pr.body || 'No description provided.'}

PR Diff:
${diff.substring(0, 50000)}

Output your review in Markdown. 
Rules:
- Start with the header: ${REVIEW_HEADER}
- Use sections for the 4 points above.
- If you find a "roadmap match", mention it explicitly.
- If it's an "obvious win", recommend it for fast-track review.
- Suggest 1-3 labels if appropriate (e.g., area/core, status/needs-tests, priority/p2).
- Be concise, professional, and encouraging.
- Do NOT use tools. Just output the text of the review.
`;

    // 5. Run Gemini
    const promptFile = join(process.cwd(), `pr_prompt_${pr.number}.md`);
    writeFileSync(promptFile, prompt);
    
    let review = '';
    try {
      const geminiPath = join(process.cwd(), 'bundle', 'gemini.js');
      if (existsSync(geminiPath)) {
        review = execFileSync('node', [
          geminiPath,
          '--prompt-file', promptFile
        ], { 
          encoding: 'utf-8',
          env: { 
            ...process.env, 
            GEMINI_CLI_TRUST_WORKSPACE: 'true',
            GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
          }
        });
      } else {
        console.error('bundle/gemini.js not found. Cannot perform review.');
        continue;
      }
    } catch (err) {
      console.error(`Error running Gemini for PR #${pr.number}:`, err);
      continue;
    } finally {
      if (existsSync(promptFile)) rmSync(promptFile);
    }

    if (!review || review.trim().length === 0) {
      console.log(`Gemini returned an empty review for PR #${pr.number}.`);
      continue;
    }

    // 6. Post Comment
    const commentFile = join(process.cwd(), `pr_review_${pr.number}.md`);
    writeFileSync(commentFile, review);
    
    try {
      execFileSync('gh', ['pr', 'comment', pr.number.toString(), '--body-file', commentFile]);
      console.log(`Successfully posted pre-review for PR #${pr.number}.`);
    } catch (err) {
      console.error(`Failed to post comment for PR #${pr.number}:`, err);
    } finally {
      if (existsSync(commentFile)) rmSync(commentFile);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error in PR pre-review reflex:', err);
  process.exit(1);
});
