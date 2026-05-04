# Audit Results - 2026-05-04

## Phase 1: Editor Audit

### Summary

Initial audit of the Gemini CLI documentation for style guide adherence and
technical accuracy.

### Findings

| File Path                           | Violation / Inaccuracy                                                                           | Recommendation                                                                              |
| :---------------------------------- | :----------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| `docs/index.md`                     | Violation (Formatting): `## Install` heading is followed immediately by a code block.            | Add an introductory sentence before the code block.                                         |
| `docs/get-started/index.md`         | Violation (Language): "Click on **Sign in**."                                                    | Replace with "Click **Sign in**." for more precise verb usage.                              |
| `docs/get-started/installation.mdx` | Violation (Voice and Tone): Uses "We recommend".                                                 | Replace with "Most users use" or similar passive/neutral phrasing, or use imperative voice. |
| `docs/get-started/installation.mdx` | Violation (Structure): Missing "Next steps" section.                                             | Add "Next steps" section linking to authentication.                                         |
| `docs/cli/cli-reference.md`         | Violation (Formatting): `## CLI commands` heading followed by a table without overview.          | Add an introductory overview paragraph.                                                     |
| `docs/cli/cli-reference.md`         | Violation (Formatting): `## CLI Options` heading followed by a table without overview.           | Add an introductory overview paragraph.                                                     |
| `docs/cli/cli-reference.md`         | Violation (Formatting): `## Extensions management` heading followed by a table without overview. | Add an introductory overview paragraph.                                                     |
| `docs/cli/cli-reference.md`         | Violation (Formatting): `## MCP server management` heading followed by a table without overview. | Add an introductory overview paragraph.                                                     |
| `docs/cli/cli-reference.md`         | Violation (Formatting): `## Skills management` heading followed by a table without overview.     | Add an introductory overview paragraph.                                                     |
| `docs/cli/cli-reference.md`         | Violation (Structure): Missing "Next steps".                                                     | Add "Next steps" section.                                                                   |
| `docs/cli/cli-reference.md`         | Inaccuracy (Code): `/memory reload` example uses "for example, `GEMINI.md`".                     | Ensure the description is concise. (Wait, this is okay, but I can improve it).              |

## Phase 2: Software Engineer Audit

### Undocumented Features

- **`/gemma` command:** The `/gemma` slash command is available in sessions but
  not listed in the [Command Reference](../reference/commands.md).
- **Advanced UI Settings:** Settings like `ui.footer.items`,
  `ui.footer.showLabels`, `ui.renderProcess`, and `ui.terminalBuffer` are
  available in the schema but not documented in the
  [Configuration Reference](../reference/configuration.md) (due to
  `showInDialog: false` or `ignoreInDocs`). They should be added to the
  reference as advanced options.
- **Context-Aware Security (Conseca):** The `security.enableConseca` setting is
  mentioned in the settings reference but lacks a detailed explanation or
  tutorial on how it works.
