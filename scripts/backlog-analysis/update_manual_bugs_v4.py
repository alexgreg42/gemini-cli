import json

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

updates = {
    22946: {
        "analysis": "The logic for the 'press tab twice for more' hint resides in `packages/cli/src/ui/components/StatusRow.tsx`. The `tipContentStr` unconditionally returns this string when `settings.merged.ui.showShortcutsHint` is true, without accounting for whether the footer is actually visible.",
        "effort_level": "small",
        "reasoning": "The fix only requires modifying a simple boolean condition in a single React component (`StatusRow.tsx`) to check if the footer is visible or simply removing the redundant hint.",
        "recommended_implementation": "Update the `tipContentStr` logic in `packages/cli/src/ui/components/StatusRow.tsx` to check a `isFooterVisible` state before returning the hint, or remove the 'press tab twice for more' string entirely."
    },
    22904: {
        "analysis": "The error 'Cannot read properties of undefined (reading \"publish\")' during `run_shell_command` indicates that `this.messageBus` is undefined when a publish operation is attempted in `packages/core/src/tools/shell.ts`.",
        "effort_level": "small",
        "reasoning": "The fix involves adding optional chaining or verifying the initialization of the `messageBus` dependency in the tool invocation lifecycle.",
        "recommended_implementation": "Add optional chaining when calling `publish` (e.g., `this.messageBus?.publish(...)`) in `packages/core/src/tools/shell.ts` or ensure `messageBus` is properly injected."
    },
    22878: {
        "analysis": "Duplicate confirmation cascades occur because the `ToolConfirmationQueue` does not properly isolate parallel tool confirmations, causing overlapping UI components instead of batching them.",
        "effort_level": "medium",
        "reasoning": "Fixing this requires structural changes to how the UI state (`UIStateContext`) and `ToolConfirmationQueue` handle arrays of pending tools in parallel."
    },
    22814: {
        "analysis": "In `packages/core/src/services/shellExecutionService.ts`, the `background(pid)` method unconditionally creates an `fs.WriteStream`. Since `background(pid)` is delayed by 200ms, if the process exits before this delay, `cleanupLogStream` is never triggered for the newly created stream, causing a file descriptor leak.",
        "effort_level": "small",
        "reasoning": "The root cause is a straightforward race condition between the process exit lifecycle and the delayed backgrounding logic.",
        "recommended_implementation": "In `ShellExecutionService.background(pid)`, check if the process has already exited (e.g., by checking if `pid` is still in `activePtys` or `activeChildProcesses`) before creating the `fs.WriteStream`."
    },
    22779: {
        "analysis": "The 'Context Refresh' loop originates in `packages/core/src/tools/mcp-client-manager.ts`. MCP context refreshes are being scheduled and coalesced continuously, creating a reactive loop that hangs the CLI.",
        "effort_level": "medium",
        "reasoning": "This involves debugging asynchronous state management and event loop cycles within the `MCPClientManager` to break the cyclic dependency."
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

print("Updated 5 bugs.")
