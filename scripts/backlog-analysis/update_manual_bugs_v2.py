import json

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

# Data from generalist analysis and my follow-up investigation
updates = {
    23172: {
        "analysis": "The CLI startup flow calls `loadCliConfig` twice: once for authentication bootstrapping and once for full initialization. Each call triggers the `ExtensionManager` to load extensions, which emits warnings twice.",
        "effort_level": "small",
        "reasoning": "The fix is localized to the startup sequence in `packages/cli/src/gemini.tsx` and requires a flag to skip extensions during the first pass.",
        "recommended_implementation": "Update `loadCliConfig` in `packages/cli/src/config/config.ts` to accept a `skipExtensions: boolean` option. Set this to `true` in `gemini.tsx` line 434 (partialConfig pass)."
    },
    23222: {
        "analysis": "A validation failure during PNPM/ZSH installation where `experimental.plan` is incorrectly checked despite migration logic. PNPM symlinking likely causes the CLI to load stale configuration or miss the migration path.",
        "effort_level": "medium",
        "reasoning": "Requires cross-environment testing of the migration logic in `packages/cli/src/config/settings.ts` and ensure validation in `config.ts` handles legacy keys gracefully."
    },
    23146: {
        "analysis": "Ctrl+C for clearing input conflicts with the terminal's SIGINT signal. The key event in `InputPrompt.tsx` is either not fast enough to consume the event or bubbling causes a race condition with the global exit handler.",
        "effort_level": "medium",
        "reasoning": "Requires fixing input event priority in `packages/cli/src/ui/components/InputPrompt.tsx` and potential changes to `KeypressContext.tsx`."
    },
    23138: {
        "analysis": "Changing the theme triggers a settings save that overwrites the existing file. If recognition of certain blocks (like `hooks`) was skipped during load, they are omitted from the serialized JSON.",
        "effort_level": "medium",
        "reasoning": "Requires updating the `Settings` class in `packages/cli/src/config/settings.ts` to preserve 'unknown' properties from the original file during the merge-and-save cycle."
    },
    23117: {
        "analysis": "The `run_shell_command` tool inherits the user's environment. If `VIRTUAL_ENV` is set in the parent shell, it bleeds into the agent's child process, potentially causing it to use the wrong Python interpreter.",
        "effort_level": "small",
        "reasoning": "The environment sanitization logic in `packages/core/src/services/environmentSanitization.ts` should explicitly block `VIRTUAL_ENV` by default to ensure agent process isolation.",
        "recommended_implementation": "Add `'VIRTUAL_ENV'` and `'CONDA_PREFIX'` to the `NEVER_ALLOWED_ENVIRONMENT_VARIABLES` set in `packages/core/src/services/environmentSanitization.ts`."
    },
    23054: {
        "analysis": "Headless mode execution traces are fragmented because the main loop in `nonInteractiveCli.ts` does not wrap the entire session in a single root span.",
        "effort_level": "small",
        "reasoning": "Localized change to the entry point of the non-interactive CLI.",
        "recommended_implementation": "In `packages/cli/src/nonInteractiveCli.ts`, wrap the `run()` call inside a `telemetry.startSpan('non_interactive_session', ...)` block."
    },
    23003: {
        "analysis": "Vim mode state transitions in the TUI are not correctly capturing terminal escape sequences for cursor movement, causing 'Normal' mode to be unresponsive or leaky.",
        "effort_level": "medium",
        "reasoning": "Requires deep debugging of the Vim state machine in `packages/cli/src/ui/hooks/vim.ts` and ensuring all captured keys are correctly handled or suppressed."
    },
    23227: {
        "analysis": "Frequent 'Uncaught Promise Rejection' errors during UI re-renders, likely caused by an async event listener in `UIStateContext` attempting to update state on an unmounted component.",
        "effort_level": "medium",
        "reasoning": "Requires adding `AbortController` or `isMounted` checks to all async hooks in `packages/cli/src/ui/hooks`."
    },
    23091: {
        "analysis": "Flickering in the status bar during long-running tool executions caused by high-frequency telemetry updates triggering React re-renders.",
        "effort_level": "medium",
        "reasoning": "Requires throttling the update frequency of the `StatusRow` component or using a more granular context for status updates."
    },
    23039: {
        "analysis": "Memory leak in the TUI during prolonged sessions caused by accumulating old message parts in the Ink virtual DOM.",
        "effort_level": "large",
        "reasoning": "Requires implementing a proper message virtualization strategy in `packages/cli/src/ui/components/MainContent.tsx` to unmount off-screen messages."
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
    # Clean up previous bad ones for these 10
    elif num in [23227, 23222, 23172, 23146, 23138, 23117, 23091, 23054, 23039, 23003]:
        # should be covered by above, but just in case
        pass

with open(BUGS_FILE, 'w') as f:
    json.dump(bugs, f, indent=2)

print("Updated another 10 bugs.")
