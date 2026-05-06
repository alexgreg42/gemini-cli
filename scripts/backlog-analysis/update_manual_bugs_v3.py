import json

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

# Data from generalist analysis
updates = {
    22120: {
        "analysis": "`CoreToolScheduler` incorrectly drops the payload during `ask_user` tool confirmations. This happens because the `originalOnConfirm` callback in `packages/core/src/scheduler/confirmation.ts` is called without the necessary user-provided response object.",
        "effort_level": "small",
        "reasoning": "The bug is in a single core scheduler file and involves adding a missing argument to a function call.",
        "recommended_implementation": "In `packages/core/src/scheduler/confirmation.ts`, locate the `confirmExecute` implementation and ensure the `payload` from the user is passed to the `originalOnConfirm` or `resolve` call."
    },
    22032: {
        "analysis": "Several test suites (notably `mcp-client.test.ts`) create temporary directories during execution but do not clean them up, leading to filesystem clutter and potential test interference.",
        "effort_level": "small",
        "reasoning": "Localized test cleanup issue.",
        "recommended_implementation": "Add `afterEach(() => fs.rmSync(tempDir, { recursive: true }))` hooks to the identified test files in `packages/core/src/tools/` and `packages/sdk/src/`."
    },
    22452: {
        "analysis": "When running in developer mode, the CLI bypasses certain CI environment scrubbing steps, potentially leaking secrets or local paths into logs.",
        "effort_level": "small",
        "reasoning": "Requires ensuring the sanitization logic is always active, regardless of the `DEV` flag.",
        "recommended_implementation": "In `packages/cli/src/gemini.tsx`, ensure `sanitizeEnvironment` is called during config initialization even if `isDev` is true."
    },
    22432: {
        "analysis": "The `ReloadResult` returned by the agent configuration reload logic is too restrictive, truncating important session or state data.",
        "effort_level": "small",
        "reasoning": "Simple interface/type definition change.",
        "recommended_implementation": "Expand the `ReloadResult` interface in `packages/core/src/config/config.ts` to include all necessary session metadata."
    },
    22409: {
        "analysis": "An infinite re-render loop occurs in the `ScrollProvider` when new history items are added, caused by an unstable `entry` object being passed to the `useScrollable` hook.",
        "effort_level": "small",
        "reasoning": "Standard React memoization fix.",
        "recommended_implementation": "In `packages/cli/src/ui/contexts/ScrollProvider.tsx`, wrap the `entry` calculation in a `useMemo` block with appropriate dependencies."
    },
    22125: {
        "analysis": "The `extensions link` command attempts to create a symlink even if one already exists, resulting in an 'EEXIST' error and command failure.",
        "effort_level": "small",
        "reasoning": "Localized fix in the extension linking logic.",
        "recommended_implementation": "In `packages/cli/src/ui/commands/extensionsCommand.ts`, add an `fs.existsSync()` check before calling `fs.symlinkSync()`."
    },
    22583: {
        "analysis": "PTY Master Device exhaustion on macOS caused by unclosed file descriptors after shell tool execution.",
        "effort_level": "medium",
        "reasoning": "Requires ensuring `pty.kill()` or `pty.destroy()` is called in a `finally` block in `packages/sdk/src/shell.ts`.",
        "recommended_implementation": "In `packages/sdk/src/shell.ts`, wrap the PTY execution in a try-finally block and ensure `term.destroy()` is called to release the file descriptor."
    },
    22596: {
        "analysis": "Crash in YOLO mode when multiple file edits are pending, caused by a race condition in the `TaskDisplay` component trying to access a tool result that was cleared.",
        "effort_level": "medium",
        "reasoning": "Requires adding a check for `toolCall.result` existence before rendering in `packages/cli/src/ui/components/TaskDisplay.tsx`."
    },
    22813: {
        "analysis": "Unintentional third-party extension usage causing account suspension. This is a policy enforcement issue.",
        "effort_level": "medium",
        "reasoning": "Requires implementing a stricter 'Only first-party extensions' default policy in `packages/core/src/config/extension-loader.ts`."
    }
}

for bug in bugs:
    num = bug.get('number')
    if num in updates:
        upd = updates[num]
        bug['analysis'] = upd['analysis']
        bug['effort_level'] = upd['effort_level']
        bug['reasoning'] = upd['reasoning']
        if 'recommended_implementation' in upd:
            bug['recommended_implementation'] = upd['recommended_implementation']

with open(BUGS_FILE, 'w') as f:
    json.dump(bugs, f, indent=2)

print("Updated 9 bugs.")
