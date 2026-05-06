import json

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

updates = {
    25599: {
        "analysis": "The `gemini mcp list` command uses `testMCPConnection` which calls `await client.ping()`. Because some first-party servers do not implement the `ping` method, they throw a `MethodNotFound` error, causing the `catch` block to incorrectly return `DISCONNECTED` even though the transport connected successfully.",
        "effort_level": "small",
        "reasoning": "The issue is localized to a single file (`packages/cli/src/commands/mcp/list.ts`). It only requires modifying the `try/catch` block around the `ping()` call to ignore `MethodNotFound` errors.",
        "recommended_implementation": "In `packages/cli/src/commands/mcp/list.ts`, catch the error from `await client.ping()`. If the error indicates an unsupported method (or simply if `client.connect()` already succeeded), return `MCPServerStatus.CONNECTED` instead of dropping to `DISCONNECTED`."
    },
    25597: {
        "analysis": "The `vscode-ide-companion` extension indiscriminately tracks active text editors via `vscode.window.onDidChangeActiveTextEditor` in `open-files-manager.ts`. When a user opens `.vscode/settings.json`, its content is sent to the CLI's context, confusing the LLM with IDE-specific configuration keys.",
        "effort_level": "small",
        "reasoning": "The fix requires a simple string exclusion check in the companion extension's event listener to prevent specific configuration files from being added to the open files context payload.",
        "recommended_implementation": "In `packages/vscode-ide-companion/src/open-files-manager.ts`, update the `isFileUri` helper or the event listener to explicitly return `false` if `uri.path.endsWith('.vscode/settings.json')`."
    },
    25590: {
        "analysis": "The `relaunchAppInChildProcess` utility spawns a replacement CLI process using `child_process.spawn`. However, the parent process does not bind signal listeners (`SIGTERM`, `SIGHUP`) to forward termination events to the child. If a process manager kills the parent, the child is orphaned and reparented to PID 1.",
        "effort_level": "small",
        "reasoning": "Localized fix in `packages/cli/src/utils/relaunch.ts` involving standard Node.js process event listeners.",
        "recommended_implementation": "In `packages/cli/src/utils/relaunch.ts`, immediately after spawning the child, add signal handlers: `['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => process.on(sig, () => child.kill(sig)));`."
    },
    25583: {
        "analysis": "Executing numerous shell commands in YOLO mode exhausts the macOS pseudo-terminal limit (`ptmx_max`). While `pty.kill()` is called on exit in `ShellExecutionService`, `node-pty` can leak file descriptors on macOS under heavy concurrent usage if the underlying C++ bindings fail to release the master FD promptly when destroyed asynchronously.",
        "effort_level": "large",
        "reasoning": "Debugging and patching PTY file descriptor leaks in `node-pty` on macOS is a complex, OS-specific resource management issue that requires deep tracing of the process lifecycle in `packages/core/src/services/shellExecutionService.ts`."
    },
    25566: {
        "analysis": "If a user configures a custom plans directory that resolves outside the project root, `_Storage.getPlansDir()` intentionally throws an Error. Because this is called during the asynchronous `Config._initialize()` bootstrap phase without a surrounding `try/catch`, it results in an Unhandled Promise Rejection that crashes the CLI.",
        "effort_level": "small",
        "reasoning": "The crash is caused by a missing error boundary during initialization in `packages/core/src/config/config.ts`. It is a simple, localized control-flow fix.",
        "recommended_implementation": "In `packages/core/src/config/config.ts`, wrap the `this.storage.getPlansDir()` path resolution check in a `try/catch` block. Catch the error, emit a user-friendly warning to the console, and safely fall back to the default `getProjectTempPlansDir()`."
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

print("Updated bugs 25599 to 25566.")
