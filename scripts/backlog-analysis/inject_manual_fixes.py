import json

BUGS_FILE = 'data/bugs.json'

with open(BUGS_FILE, 'r') as f:
    bugs = json.load(f)

# Manually verified high-quality analysis for problematic bugs
manual_updates = {
    19468: {
        "analysis": "The scroll jumping and flickering are caused by frequent re-renders of the `Static` history component in `MainContent.tsx`. This happens when background state updates (like telemetry or periodic model status checks) cause a context update that either increments `historyRemountKey` or forces a full component tree refresh, causing Ink to re-output the entire static history to the terminal buffer.",
        "effort_level": "medium",
        "reasoning": "TUI-specific bug involving complex state synchronization between background services and the React rendering loop in `packages/cli/src/ui`. Requires tracing high-frequency state changes in `UIStateContext.tsx` and ensuring `Static` is only remounted when absolutely necessary."
    },
    23541: {
        "analysis": "Autocomplete for subcommands (e.g. `/directory `) incorrectly prepends the main command name again, resulting in strings like `/directory /directory list`. This is caused by the completion logic in `useCommandCompletion.tsx` not correctly identifying that the command prefix is already present in the input buffer.",
        "effort_level": "medium",
        "reasoning": "Requires fixing the string slicing and matching logic in `packages/cli/src/ui/hooks/useCommandCompletion.tsx` (or `atCommandProcessor.ts`). Must correctly handle cursor position and existing buffer content when calculating the completion 'delta' to insert."
    }
}

for bug in bugs:
    num = bug.get('number')
    if num in manual_updates:
        upd = manual_updates[num]
        bug['analysis'] = upd['analysis']
        bug['effort_level'] = upd['effort_level']
        bug['reasoning'] = upd['reasoning']
        if 'recommended_implementation' in upd:
            bug['recommended_implementation'] = upd['recommended_implementation']

with open(BUGS_FILE, 'w') as f:
    json.dump(bugs, f, indent=2)

print("Injected high-quality analysis for #19468 and #23541.")
