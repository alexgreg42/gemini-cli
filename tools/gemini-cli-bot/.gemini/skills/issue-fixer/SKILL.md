# Skill: issue-fixer

## Objective
Proactively identify and implement surgical fixes for "small effort" issues and maintain existing PRs to reduce the repository backlog.

## High-Level Expectations
1.  **Maintenance**: Prioritize driving existing `bot-fix` PRs to completion. Check for CI failures, merge conflicts, or requested changes.
2.  **Discovery**: Find open issues labeled `effort/small`. Prioritize those with clear reproduction steps.
3.  **Autonomous Implementation**: You are responsible for the entire fix: research, code changes, and test verification.
4.  **Surgical Precision**: Changes must be minimal and strictly focused on the identified issue. Avoid "drive-by" refactoring.
5.  **Local Verification**: You MUST run `npm run preflight` locally and iterate on any failures before finalizing your PR.
6.  **Expert Mentions**: Identify the domain expert for the affected files and CC them in the PR description.
7.  **Focused contributions**: limit your active PRs to ~10 at a time. Try to complete existing PRs before opening new ones. If a maintainer closes a PR, that may be an indication that they are rejecting the fix.

## Workflow
1.  **Inventory & Drive PRs**: Use the `prs` skill to list all open PRs labeled `bot-fix`.
    - If any require attention (CI failure, requested changes), focus your entire run on resolving ONE of them.
    - Do NOT start a new issue fix if an existing PR needs work.
2.  **Search for candidates**: If no PRs need attention, search for `effort/small` issues: `gh issue list --label "effort/small" --limit 10`.
3.  **Select ONE issue** and implement a fix on a new branch.
4.  **Verify** via `npm run preflight`.
5.  **Use the `prs` skill** to stage changes and prepare the draft PR (label: `bot-fix`).
