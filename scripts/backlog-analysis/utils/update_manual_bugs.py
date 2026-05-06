"""
Purpose: Updates the primary JSON data file with manually provided analysis.
Used to explicitly override or inject specific 'analysis', 'effort_level', and 'reasoning' values for known issues where AI analysis is insufficient.
"""
import json

BUGS_FILE = '../data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

# Data from generalist analysis
updates = {
    23643: {
        "analysis": "YOLO mode performs rapid sequential tool calls. On Windows, `fs.writeFile` in `StandardFileSystemService` (packages/core/src/services/fileSystemService.ts) frequently fails due to file locks from IDE watchers or indexing services that trigger on the first write.",
        "effort_level": "medium",
        "reasoning": "Requires implementing a robust retry-with-backoff mechanism specifically for Windows in the core file system service to handle transient 'Resource busy' errors."
    },
    23528: {
        "analysis": "A variant of the file lock issue where the Node.js `fs` layer fails while native tools might succeed. It can also be caused by path normalization issues in `packages/core/src/tools/write-file.ts` where `getTargetDir()` doesn't align with the environment's path expectations.",
        "effort_level": "medium",
        "reasoning": "Requires cross-layer debugging of the path resolution and write verification logic on Windows."
    },
    23507: {
        "analysis": "In ACP mode (non-interactive), the shell tool (packages/core/src/tools/shell.ts) attempts to solicit user confirmation. Since no TTY is available, the request hangs or fails to return a result to the ACP stream.",
        "effort_level": "medium",
        "reasoning": "Logic needs to be added to `executeToolWithHooks` or the scheduler to auto-approve or return a specific error when confirmation is impossible."
    },
    23480: {
        "analysis": "When extensions from private repositories are checked for updates, the spawned `git fetch` process prompts for credentials, stealing stdin from the main CLI.",
        "effort_level": "small",
        "reasoning": "This is a standard process isolation issue.",
        "recommended_implementation": "Set `GIT_TERMINAL_PROMPT=0` in the environment of any `git` process spawned for background tasks in `McpClientManager` or the extension service."
    },
    23427: {
        "analysis": "The `executeToolWithHooks` function in `packages/core/src/core/coreToolHookTriggers.ts` processes blocking and stopping decisions but omits the `systemMessage` field from the `HookOutput` for successful turns.",
        "effort_level": "medium",
        "reasoning": "Requires updating the core client's event loop to yield a new `GeminiEventType.SystemMessage` and modifying the UI to render it."
    },
    23417: {
        "analysis": "`packages/cli/src/utils/readStdin.ts` sets UTF-8 encoding and then uses `chunk.length`, which measures UTF-16 code units, not actual bytes.",
        "effort_level": "small",
        "reasoning": "Multi-byte characters (like emojis) are undercounted, leading to inaccurate 8MB limit enforcement.",
        "recommended_implementation": "Replace `chunk.length` with `Buffer.byteLength(chunk, 'utf8')`."
    },
    23356: {
        "analysis": "Likely an unhandled promise rejection or timeout in the IDE companion communication layer (packages/vscode-ide-companion).",
        "effort_level": "medium",
        "reasoning": "Intermittent connection drops between the extension host and the `ide-server` need better error boundaries."
    },
    23346: {
        "analysis": "The sidebar input component lacks bracketed paste mode support. Carriage returns in pasted blocks are interpreted as immediate submission signals.",
        "effort_level": "medium",
        "reasoning": "Requires updating the sidebar input logic to buffer multi-character sequences wrapped in paste escape codes."
    },
    23336: {
        "analysis": "The model's internal thought blocks (prefixed with `s94>thought`) are not correctly stripped by the regex in the CLI's UI rendering layer.",
        "effort_level": "small",
        "reasoning": "A simple regex update in the message display component is required.",
        "recommended_implementation": "Update the display filter to catch and remove `s94>thought` and standard `<thought>` tags before the string reaches Ink's `Text` component."
    },
    23297: {
        "analysis": "The UI is often hung because a fetch call in `IDEConnectionUtils` (used for companion features) has timed out at the Node level (5 mins) without a client-side timeout, blocking the React/Ink event loop.",
        "effort_level": "medium",
        "reasoning": "Requires adding explicit `AbortSignal` timeouts to all IDE fetch calls."
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

print("Updated 10 bugs.")
