import json

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

updates = {
    22219: {
        "analysis": "When a tool request requires user confirmation (like `ask_user` or file edits) and times out or gets aborted, the resulting promise rejection is not caught within the asynchronous execution chain of the `CoreToolScheduler`, leading to a process-crashing Unhandled Promise Rejection.",
        "effort_level": "medium",
        "reasoning": "Fixing this requires identifying the exact boundary in `packages/core/src/scheduler` where the user input promise is awaited and wrapping it in a proper try-catch or `.catch()` to return a graceful tool failure response instead of crashing the Node process."
    },
    22029: {
        "analysis": "The CLI attempts to interpret pasted text as potential file paths to determine if read permissions are needed. If a user pastes a massive text block (like JSON), `robustRealpath` passes the entire block to `fs.lstat`, which throws an `ENAMETOOLONG` system error, crashing the app.",
        "effort_level": "small",
        "reasoning": "The fix is localized to the path parsing logic. We just need to catch and ignore `ENAMETOOLONG` errors or skip checking strings that exceed the OS max path length.",
        "recommended_implementation": "In `packages/core/src/utils/paths.ts` (inside `robustRealpath` or `resolveToRealPath`), wrap the `fs.lstatSync` call in a try/catch block and safely return or ignore errors with `e.code === 'ENAMETOOLONG'`."
    },
    22004: {
        "analysis": "High-frequency terminal re-renders triggered by the 'Thinking' spinner component cause severe screen flickering in terminal multiplexers like tmux. The issue suggests implementing DCS Synchronized Output escape sequences to buffer the redraws.",
        "effort_level": "large",
        "reasoning": "Ink handles the terminal output buffering. Implementing DCS Synchronized Output requires intercepting the raw output stream from Ink or creating a custom render patcher in `ConsolePatcher`, which is highly complex and environment-dependent."
    },
    22001: {
        "analysis": "The `Terminal` instances from `@xterm/headless` created for background shell execution are stored in memory but never explicitly disposed when the process exits, leading to a memory leak.",
        "effort_level": "small",
        "reasoning": "The lifecycle of the PTY is managed in `packages/core/src/services/shellExecutionService.ts`. This only requires adding a disposal call to the existing cleanup method.",
        "recommended_implementation": "In `packages/core/src/services/shellExecutionService.ts`, update the `cleanupPtyEntry` method to call `entry.headlessTerminal.dispose()` before deleting the entry from `activePtys`."
    },
    21970: {
        "analysis": "The TUI's 'vi mode' implementation lacks many standard Vim keyboard shortcuts and navigation commands, making it incomplete for power users.",
        "effort_level": "medium",
        "reasoning": "Implementing a robust Vi emulation layer in a React-based TUI (`packages/cli/src/ui/hooks/vim.ts`) involves complex state machines for Normal, Insert, and Visual modes, and mapping multi-key chords accurately."
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
