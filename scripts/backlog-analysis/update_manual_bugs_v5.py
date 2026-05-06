import json

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

updates = {
    22588: {
        "analysis": "In `packages/core/src/confirmation-bus/message-bus.ts`, the `MessageBus.request()` method creates a Promise but calls `this.publish()` without awaiting it or attaching a `.catch()`. If publish fails (e.g. due to policy engine rejection or validation error), the error is emitted on the bus but the Promise hangs until the 60s timeout.",
        "effort_level": "small",
        "reasoning": "The fix is localized to a single file (`message-bus.ts`). It simply requires chaining `.catch(reject)` onto the floating `this.publish()` call within the `request` method's Promise constructor.",
        "recommended_implementation": "In `packages/core/src/confirmation-bus/message-bus.ts`, change `this.publish({ ...request, correlationId } as TRequest);` to `this.publish({ ...request, correlationId } as TRequest).catch(reject);`."
    },
    22566: {
        "analysis": "When displaying large blocks of text (like file contents) in the console on Windows, the final line is duplicated. This is likely a TUI rendering bug in Ink or `packages/cli/src/ui/utils/MarkdownDisplay.tsx` related to how terminal width wrapping and CRLF (`\\r\\n`) line endings are calculated, causing the cursor to jump and draw the last line twice.",
        "effort_level": "medium",
        "reasoning": "TUI rendering issues on Windows are notoriously difficult to fix without causing regressions on other platforms. Requires debugging the React Ink layout engine and how `MarkdownDisplay` handles terminal escape codes and line heights."
    },
    22560: {
        "analysis": "Two distinct bugs: 1) `MemoryToolInvocation.allowlist` is a `static` property in `packages/core/src/tools/save-memory.ts`, causing approvals to persist across different projects if the CLI process is kept alive (e.g., via ACP or a daemon). 2) Chat compression in `packages/core/src/services/summarizer.ts` instantiates a new `AbortController` but fails to link it to the user's cancellation signal (Ctrl+C).",
        "effort_level": "medium",
        "reasoning": "Requires fixing state scoping for the MemoryTool (moving the allowlist to the instance or session context) and properly piping `AbortSignal`s through the summarization network requests."
    },
    22309: {
        "analysis": "The user receives a 'home directory' warning even when in a subfolder because they have likely set the `GEMINI_CLI_HOME` environment variable to their project directory. The `getUserStartupWarnings` function compares `process.cwd()` to `homedir()`. Since `homedir()` is imported from `@google/gemini-cli-core/paths.ts` (which respects `GEMINI_CLI_HOME`), they evaluate as equal, triggering the false positive.",
        "effort_level": "small",
        "reasoning": "The fix is isolated to `packages/cli/src/utils/userStartupWarnings.ts`. We should use the native `os.homedir()` for this security/UX warning rather than the overridden CLI configuration directory.",
        "recommended_implementation": "In `packages/cli/src/utils/userStartupWarnings.ts`, change the import of `homedir` from `@google/gemini-cli-core` to `import * as os from 'node:os'` and use `os.homedir()` in the `homeDirectoryCheck`."
    },
    22274: {
        "analysis": "In WSL2, `XDG_SESSION_TYPE` is often unset, causing `getUserLinuxClipboardTool` in `packages/cli/src/ui/utils/clipboardUtils.ts` to fail to detect a clipboard. Furthermore, Windows clipboard images are exposed to WSL2 as `image/bmp`, but `saveClipboardImage` hardcodes `--type image/png` for `wl-paste`.",
        "effort_level": "medium",
        "reasoning": "Requires updating the clipboard tool detection to fall back to `WAYLAND_DISPLAY` or `DISPLAY` environment variables, and modifying the `wl-paste`/`xclip` execution logic to accept and convert `.bmp` images, which involves cross-platform WSL2 testing."
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
        else:
            bug.pop('recommended_implementation', None)

with open(BUGS_FILE, 'w') as f:
    json.dump(bugs, f, indent=2)

print("Updated 5 bugs.")
