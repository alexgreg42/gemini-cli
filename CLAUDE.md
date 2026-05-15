# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Repository Overview

This is a **Google Gemini CLI** monorepo (npm workspaces under `packages/`) plus
a separate **Electron desktop app** (`studio/`) that wraps the Code Assist API
with a graphical interface. The two are independent — `studio/` is not a
workspace member and has its own build pipeline.

## Commands

### Root monorepo

```bash
npm run build           # build all packages via scripts/build.js
npm run test            # vitest across all packages
npm run lint            # ESLint (--max-warnings 0, 8 GB heap)
npm run lint:fix        # ESLint + Prettier auto-fix
npm run typecheck       # tsc --noEmit across packages
npm run preflight       # full CI gate: clean → install → format → build → lint:ci → typecheck → test:ci
```

### Run a single test file

```bash
cd packages/core   # or packages/cli
npx vitest run src/path/to/file.test.ts
```

### Integration / E2E

```bash
npm run test:integration:sandbox:none   # no sandbox (fastest)
npm run test:integration:sandbox:docker
npm run test:e2e
```

### Studio (Electron desktop app)

```bash
cd studio
npm run dev             # Vite dev server only (browser preview)
npm run dev:electron    # Vite + Electron (full desktop, concurrent)
npm run build           # tsc + vite build (production)
npm run build:electron  # tsc + vite + electron-builder → studio/release/*.exe (Windows x64)
npx tsc --noEmit        # type-check studio only
```

The built installer lands in `studio/release/Gemini CLI Studio Setup 1.0.0.exe`.

## Architecture

### Monorepo packages

| Package                         | Role                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/core`                 | AI model interaction, agent execution, MCP protocol, Code Assist API client, OpenTelemetry, file/shell tools |
| `packages/cli`                  | Terminal UI (React Ink), command parsing, interactive/non-interactive modes, entry point                     |
| `packages/sdk`                  | Public SDK for external consumers                                                                            |
| `packages/a2a-server`           | Agent-to-Agent communication server                                                                          |
| `packages/vscode-ide-companion` | VS Code extension bridge                                                                                     |

Key boundary: **`packages/cli` depends on `packages/core`** but core never
imports cli. The Code Assist API client lives entirely in
`packages/core/src/code_assist/`.

### Code Assist API (`packages/core/src/code_assist/`)

- `server.ts` — `CodeAssistServer` class; all API calls go through `requestPost`
  / `requestStreamingPost` which build URLs as
  `https://cloudcode-pa.googleapis.com/v1internal:<method>`
- `converter.ts` — defines `CAGenerateContentRequest` schema and
  `toGenerateContentRequest` / `fromGenerateContentResponse` converters
- `types.ts` — request/response types
- Auth: `google-auth-library` `AuthClient` automatically injects
  `Authorization: Bearer`; `X-Goog-User-Project` is only injected if
  `quota_project_id` is present in the saved credentials (set from env vars)
- `loadCodeAssist` must be called before `generateContent` to initialise the
  user session server-side

### Studio (`studio/`)

A standalone Electron + React + TypeScript app. Does **not** import from
`packages/`.

**IPC architecture (renderer ↔ main):**

- `preload.cjs` — exposes `window.electronAPI` to the renderer via
  `contextBridge`
- `electron.cjs` — main process: OAuth flow, Code Assist API proxy, CLI child
  process
- `src/services/` — renderer-side services (gemini.ts, auth.ts, settings.ts,
  github.ts)

**Auth routing in `gemini.ts`:**

1. If `authState.mode === 'google_oauth'` + Electron present →
   `sendViaElectronOAuth` (IPC to main → Code Assist API)
2. Otherwise → `sendViaApiKey` (direct `@google/generative-ai` SDK call)

**Code Assist request rules (electron.cjs):**

- Call `ensureCodeAssistInit` (→ `loadCodeAssist`) before first
  `generateContent` to get `cloudaicompanionProject`
- `ensureCodeAssistInit` logic (mirrors `setup.ts`):
  - If `loadCodeAssist` returns `currentTier` → already registered, use
    `cloudaicompanionProject` directly, **do NOT call `onboardUser`**
  - If no `currentTier` → call `onboardUser` with `tierId` from default
    `allowedTier` (never pass `cloudaicompanionProject` for FREE tier)
- **Do NOT send `X-Goog-User-Project` header** for free-tier users — the native
  CLI doesn't send it; sending the Google-managed project ID as
  `X-Goog-User-Project` triggers a 403 (API-not-enabled check on a project the
  user can't control). Use `project` field in the request body instead.
- `gemini-2.5+` / `gemini-3+` models:
  `generationConfig = { temperature:1, topP:0.95, topK:64, thinkingConfig:{ includeThoughts:true, thinkingBudget:8192 } }`
- `gemini-2.0-flash` and older: same base config **without** `thinkingConfig`
  (field causes 400)
- Filter `thought:true` parts from response before returning text to renderer

**Available models (studio):** `gemini-2.5-flash`, `gemini-3-flash-preview`,
`gemini-2.0-flash`, `gemini-2.5-pro`

OAuth credentials are stored in `~/.gemini/oauth_creds.json` (same file as the
native CLI).

## Billing lock — Claude Pro $20/month

**ANTHROPIC_API_KEY must never be set.** The user operates exclusively on the
Claude Pro $20/month subscription. Setting this env var would switch Claude Code
to pay-per-token API billing and generate charges outside the plan.

- `effortLevel` is set to `"normal"` in `~/.claude/settings.json` — do **not**
  change it to `"max"` (that enables Opus which costs more tokens).
- If a task seems to require `effortLevel: max`, ask the user before changing
  it.
- Studio uses **Google OAuth → Code Assist API (free tier)** for all Gemini
  calls — no Gemini API key is required or expected in normal use. A Gemini API
  key in Settings is optional and only used as a fallback for image attachments.

## Pre-commit hook

`scripts/pre-commit.js` runs automatically on every commit (Husky). It stashes,
runs lint-staged (Prettier + ESLint `--fix --max-warnings 0` on staged
`.ts/.tsx/.json/.md` files), then unstashes. **A failed hook does NOT create the
commit** — fix the reported issue and re-commit (never amend).

## Config / models reference

- `packages/core/src/config/models.ts` — canonical model ID constants
  (`PREVIEW_GEMINI_FLASH_MODEL`, `DEFAULT_GEMINI_FLASH_MODEL`,
  `VALID_GEMINI_MODELS`, etc.)
- `packages/core/src/config/defaultModelConfigs.ts` — per-model
  `generationConfig` defaults used by the native CLI (source of truth for
  `temperature`, `thinkingBudget`, etc.)
