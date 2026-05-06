import json

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

verified_updates = {
    25757: {
        "analysis": "Slow boot times (9.77s) are likely due to sequential initialization of heavy services like `agentRegistry`, `toolRegistry` (which may check `canUseRipgrep`), and MCP clients in `Config._initialize`.",
        "effort_level": "medium",
        "reasoning": "Requires profiling `packages/core/src/config/config.ts` to identify the specific bottleneck. Parallelizing initialization is a non-trivial refactor to avoid race conditions during service hydration."
    },
    25744: {
        "analysis": "Account suspension (403 error) is an external issue, but the CLI should catch this status code and provide a user-friendly explanation rather than a raw API error.",
        "effort_level": "small",
        "reasoning": "Localized fix in the `OAuth` provider or `GeminiChat` error handler. Requires checking for `status === 403` and returning a clear message directing the user to Google Support.",
        "recommended_implementation": "In `packages/core/src/utils/errors.ts` or the API transport layer, add a specific case for 403 errors that maps to a 'Account Suspended or Restricted' message."
    },
    25656: {
        "analysis": "Markdown rendering fails for LaTeX syntax because the `inlineRegex` in `markdownParsingUtils.ts` does not account for `$` delimiters, and `stripUnsafeCharacters` may be over-eager.",
        "effort_level": "medium",
        "reasoning": "Requires updating the markdown parser logic in `packages/cli/src/ui/utils/markdownParsingUtils.ts` to recognize math blocks and ensuring that LaTeX-specific characters like `\\` are preserved during sanitization.",
    },
    25615: {
        "analysis": "Infinite UI loop on Windows during `run_shell_command` suggests a synchronization or buffer handling issue between the shell process and the Ink TUI when handling Windows-specific control characters.",
        "effort_level": "large",
        "reasoning": "Extremely hard to reproduce and debug without a Windows environment. Impacts core process execution in `packages/core/src/tools/shell.ts` and terminal rendering in `packages/cli`.",
    },
    25610: {
        "analysis": "Theme validation error for `text.response` key is caused by a mismatch between the `CustomTheme` TypeScript interface and the JSON schema used for validation.",
        "effort_level": "small",
        "reasoning": "The `CustomTheme` interface in `packages/core/src/config/config.ts` includes `response`, but the `SETTINGS_SCHEMA` in `packages/cli/src/config/settingsSchema.ts` does not. This is a one-line schema update.",
        "recommended_implementation": "In `packages/cli/src/config/settingsSchema.ts`, add `response: { type: 'string' }` to the `CustomTheme.properties.text.properties` object."
    }
}

for bug in bugs:
    num = bug.get('number')
    if num in verified_updates:
        upd = verified_updates[num]
        bug['analysis'] = upd['analysis']
        bug['effort_level'] = upd['effort_level']
        bug['reasoning'] = upd['reasoning']
        if 'recommended_implementation' in upd:
            bug['recommended_implementation'] = upd['recommended_implementation']

with open(BUGS_FILE, 'w') as f:
    json.dump(bugs, f, indent=2)

print("Saved verified updates for first 5 bugs.")
