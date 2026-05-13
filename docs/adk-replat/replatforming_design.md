# Gemini CLI Replatforming Design

## Goals

1. **Fast ADK Replatforming:** Transition the default Gemini CLI agent to use
   the ADK execution engine to reduce maintenance overhead on the legacy run
   loop.
2. **Reuse Existing Frameworks:** Minimize UI and internal API churn by keeping
   existing callback mechanisms and frameworks. Specifically, we will _not_
   rewrite the existing tool approval and model fallback mechanisms to use ADK's
   `elicitation_request`/`elicitation_response` events. We will reuse the
   existing message bus and scheduler integrations.
3. **Unified Core Engine:** Ensure the main interactive chat, non-interactive
   mode, and subagents execute via the exact same core ADK engine.

## Non-Goals

1. **No Public SDK Readiness:** We are no longer refactoring the core codebase
   to expose a polished, public-facing SDK.
2. **No BYOA / Multi-Agent Orchestration:** We are explicitly not building
   extensibility for third-party agents or external runtime orchestration.
3. **No UI Modernization for Elicitations:** We will not refactor the React TUI
   or underlying message bus to adopt standard ADK elicitation events. Tool
   approvals and system interrupts will continue to use the legacy callback
   bridges.

---

## Open Questions

Where we want feedback. Each links to the section with more context — please weigh in there.

**Milestone 3 — TUI behind `AgentSession`:** scope to be fleshed out by @Jacob Richman; tracked in [#22702](https://github.com/google-gemini/gemini-cli/issues/22702). Exemplar areas listed in [Transition Plan](#transition-plan).

**Milestone 5 — ADK Execution Engine:**

- Loop detection: which event stream feeds the detector, how does soft-recovery get into the next request, and which terminate mechanism (abort / throw / replacement response)? See [Loop detection](#loop-detection).
- MCP: upstream the missing surface into `MCPToolset`, or keep `McpClient` and pass its outputs as functional tools? See [MCP](#mcp).
- Slash commands: live outside the protocol layer — scope of the slash-command/runtime-adapter layer TBD. See [Slash commands](#slash-commands).

---

## Milestones

1. AgentSession Interface Create `AgentSession` abstraction flexible enough to
   support the legacy runtime and ADK.
2. Adapting the Non-Interactive Runtime Adapt the existing non-interactive CLI
   to conform to the new `AgentSession` API.
3. Initial TUI Adaptation & Session Creation Move the main agent behind the
   `AgentSession` interface, adapting the TUI via `useAgentStream` and
   `LegacyAgentProtocol` while reusing the message bus. **Includes implementing
   the Agent Creation Factory/Function.**
4. Subagent Orchestration Decouple subagents from the legacy runtime by wrapping
   them in the `AgentSession` interface.
5. ADK Execution Engine Build the unified ADK agent conforming to
   `AgentSession`, handling all modes (Main, Non-Interactive, Subagents).
   Adopts ADK's loop and request processors; retains gemini-cli's scheduler,
   routing, fallback, masking, hooks, compression, recording, and loop
   detection. See [Detailed Design §5](#5-milestone-5-adk-execution-engine).

## Progress

| Milestone                                    | Owner                            | Status      | Relevant PRs / Branches                                                                                                                                                                                                                                                                                                                                      | Time Estimate |
| :------------------------------------------- | :------------------------------- | :---------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------ |
| 1. AgentSession Interface                    | Adam Weidman, Michael Bleigh     | ✅ Complete | [PR #22270](https://github.com/google-gemini/gemini-cli/pull/22270), [PR #23159](https://github.com/google-gemini/gemini-cli/pull/23159), [PR #23548](https://github.com/google-gemini/gemini-cli/pull/23548)                                                                                                                                                | -             |
| 2. Adapting the Non-Interactive Runtime      | Adam Weidman                     | ✅ Complete | [PR #22984](https://github.com/google-gemini/gemini-cli/pull/22984), [PR #22985](https://github.com/google-gemini/gemini-cli/pull/22985), [PR #22986](https://github.com/google-gemini/gemini-cli/pull/22986), [PR #24439](https://github.com/google-gemini/gemini-cli/pull/24439), [PR #22987](https://github.com/google-gemini/gemini-cli/pull/22987)      | -             |
| 3. Initial TUI Adaptation & Session Creation | Michael Bleigh                   | 🚧 WIP      | [PR #24275](https://github.com/google-gemini/gemini-cli/pull/24275), [PR #24287](https://github.com/google-gemini/gemini-cli/pull/24287), [PR #24292](https://github.com/google-gemini/gemini-cli/pull/24292), [PR #24297](https://github.com/google-gemini/gemini-cli/pull/24297), [Issue #25046](https://github.com/google-gemini/gemini-cli/issues/25046) | 2-3 weeks     |
| 4. Subagent Orchestration                    | Adam Weidman                     | 🚧 WIP      | [PR #25302](https://github.com/google-gemini/gemini-cli/pull/25302), [PR #25303](https://github.com/google-gemini/gemini-cli/pull/25303)<br>Branches: `agent-session/local-invocation`, `agent-session/remote-invocation`, `agent-session/agent-tool`                                                                                                        | 1 week        |
| 5. ADK Execution Engine                      | Adam Weidman, Alexey Kalenkevich | 🚧 WIP      | Alexey Prototype: `eeb9301`. See [M5 Execution Plan](#m5-execution-plan) below for the PR breakdown.                                                                                                                                                                                                                                                          | 4 weeks       |
| 6. Testing / Validation / Bug fixing         | Adam Weidman, Alexey Kalenkevich | ⏳ Upcoming | Folded into each phase below: non-interactive first, then subagents, then interactive. See [M5 Execution Plan](#m5-execution-plan).                                                                                                                                                                                                                            | 2 weeks       |

_(Note: Previous milestones related to "Unified Elicitations" and "Adopt ADK
Primitives" have been removed as per the updated Non-Goals)._

---

## Detailed Design

### 1. Milestone 1: AgentSession Interface

The `AgentSession` interface is the core abstraction that decouples the TUI from
the specific agent implementation by proposing a purely event-driven loop
boundary (`AgentEvent` streams). _For full rationale and design, see the
[Gemini CLI Agents design document](https://docs.google.com/document/d/1Zv2_VuVNc-PtsFIU5HYApdmaC3EyK5_fNeivYUtL1fs/edit?tab=t.0#heading=h.ok5bx3z7fmr8)._

### 2. Milestone 2: Adapting the Non-Interactive Runtime

The non-interactive runtime conforms to the `AgentSession` API via a legacy
protocol adapter. This adapter translates internal message bus and scheduler
events into standard agent event streams. Because this mode does not require
user interaction, it bypasses complex UI features like tool approvals.

This capability is enabled via the following experimental setting in
`.gemini/settings.json`:

```json
{
  "experimental": {
    "adk": {
      "agentSessionNoninteractiveEnabled": true
    }
  }
}
```

### 3. Milestone 3: Initial TUI Adaptation & Session Creation

Adapting the interactive TUI to consume the `AgentSession` interface is a
complex, multi-layered effort. The core mechanism is an event-streaming hook
that subscribes to the session.

#### Current Event Handling State (Legacy Mechanism)

The legacy system relies on a central `Scheduler` and a `MessageBus` to
orchestrate tool execution and approvals. This is the mechanism we are retaining
to avoid a full UI refactor:

- **Tool Approvals**: When a tool requires user confirmation, the scheduler
  calls `resolveConfirmation`
  ([`scheduler.ts:L663`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/scheduler/scheduler.ts#L663))
  and updates the tool's status to `AwaitingApproval` in `confirmation.ts`
  ([`confirmation.ts:L162`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/scheduler/confirmation.ts#L162)).
- **UI Notification**: The `SchedulerStateManager` publishes a
  `TOOL_CALLS_UPDATE` event on the message bus
  ([`state-manager.ts:L254`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/scheduler/state-manager.ts#L254)).
  The UI hook `useToolScheduler.ts` subscribes to this event to update the React
  state
  ([`useToolScheduler.ts:L178`](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/hooks/useToolScheduler.ts#L178)).
- **User Interaction**: If any tool requires approval, the TUI transitions to a
  waiting state
  ([`useGeminiStream.ts:L174`](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/hooks/useGeminiStream.ts#L174))
  and renders the `ToolConfirmationQueue.tsx` component.
- **Response Loop**: Once the user makes a decision, `ToolActionsContext.tsx`
  publishes a `TOOL_CONFIRMATION_RESPONSE`
  ([`ToolActionsContext.tsx:L150`](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/contexts/ToolActionsContext.tsx#L150)).
  The scheduler, which is blocked in `waitForConfirmation`
  ([`confirmation.ts:L168`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/scheduler/confirmation.ts#L168)),
  receives the response via the message bus and resumes execution.

#### Transition Plan

The interactive `AgentSession` adapter continues to leverage the legacy message bus and scheduler rather than migrating tool approvals to ADK elicitations — minimizing UI churn. The adapter subscribes to the message bus and translates read-only observational events (`tool_update`, `message`, `usage`) into `AgentEvent` streams; interactive/blocking events (tool approvals) stay on the legacy callback path.

Work areas (scope is settled; implementation within each owned by @Jacob Richman in [#22702](https://github.com/google-gemini/gemini-cli/issues/22702)):

- **Event Parity:** standard tool calls, MCP tool calls, and subagent display.
- **UI Coalescence:** using `agent_start` / `agent_end` for robust UI state management.
- **Tool-Controlled Display:** per-tool render variants (`FileDiff`, `TodoList`, `AnsiOutput`, etc.) passing through `AgentEvent`, plus tool-triggered out-of-band display state (e.g., IDE diff overlay, plan-mode toggle).
- **Command Routing:** client-initiated commands (slash commands) routed down to the session; ensuring `abort` works properly.
- **System Notices:** generic notice events for system notifications.

### 4. Milestone 4: Subagent Orchestration

Subagents invoke both local and remote execution via a unified `AgentTool` that
wraps them in `AgentSession` instances. This pattern translates low-level
execution events into standard `AgentEvent`s for the parent session.

### 5. Milestone 5: ADK Execution Engine

Replaces the legacy `GeminiClient` + `Turn` loop with an ADK `Runner` + `LlmAgent`
behind the existing `AgentSession` interface. ADK contributes the agent loop;
gemini-cli contributes everything else.

Reference implementation:
[commit `eeb9301a`](https://github.com/google-gemini/gemini-cli/commit/eeb9301a489a1609f7d74e6c61569d82c5742821).

#### Approach: progressive integration

Start by landing the initial scaffolding: the `adk-agent/` module, the runtime
flag, the top-level session factory, and the event-type cleanup. These changes
should compile green, keep the flag off by default, and avoid behavior changes.

Once the initial scaffolding lands, M5 proceeds by **runnable surface**, not
by isolated subsystem. Each phase wires one call site end-to-end before
moving to the next:

1. **Non-interactive first.** Run the ADK loop end-to-end without UI. This phase brings up the translator, model dispatch through `GcliAgentModel`, routing, scheduler-backed tool execution, output masking, abort propagation, loop detection, and native MCP. The 429 retry path lands here too: `handleFallback` silently swaps to an available model when the policy allows. The TUI-side prompt that lets a user pick `retry_once` or `stop` is a separate callback registered in Phase C; non-interactive runs without it.

2. **Local subagents second.** Same ADK runtime — no second implementation. The new work is the subagent-only behavior that doesn't exist on the top-level loop: `complete_task` as a mandatory terminator, grace-period retry, scoped workspace/memory wrappers, and the confirmation-waiting activity signal. Event propagation back to the parent already works through the M4 wrapper.

3. **Interactive last.** Wire the TUI once the runtime is proven. Stream rendering, `session_update` behavior, hooks and notifications, plan mode, between-turn steering, the TUI fallback prompt callback, and `/rewind`. All slash commands live outside the protocol layer — `/rewind` is owned by the slash-command/runtime-adapter layer, not `AgentProtocol`.

#### Architectural sketch

```
                  User input
                       │
                       ▼
            ┌──────────────────────┐
            │  AgentSession        │  existing wrapper (agent-session.ts:18)
            └──────────┬───────────┘   SessionStart / SessionEnd hooks
                       ▼
            ┌──────────────────────┐
            │  AdkAgentProtocol    │  send/subscribe/abort/events
            │                      │  agent_start/end → Before/AfterAgent hooks
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐
            │  GeminiCliAgent      │  extends BaseAgent
            │   .runAsyncImpl(ctx) │  yields ADK Events
            └──────────┬───────────┘
                       ▼
   ┌─────────────────────────────────────────────┐
   │  ADK Runner with:                            │
   │   • GcliSessionService (live event state)    │
   │   • RequestProcessors (ordered):             │
   │       ADK defaults through content build     │
   │       ToolOutputMaskingProcessor             │
   │       GcliRoutingProcessor                   │
   │       remaining ADK defaults                 │
   │   • Plugins:                                 │
   │       MaxTurns / TokenLimit / MaxTime        │
   │       HookBridgePlugin                       │
   │       LoopDetectionAdkPlugin                 │
   │       Steering injection                     │
   │                                              │
   │   LlmAgent loop: call → parse → dispatch →   │
   │                  feed back → iterate         │
   └────────┬──────────────────────┬──────────────┘
            │                      │
   ┌────────▼─────────┐  ┌─────────▼──────────────┐
   │ GcliAgentModel   │  │  toAdkTool              │
   │ • dispatch       │  │  scheduler.schedule({   │
   │ • fallback retry │  │    callId, name, args   │
   │ • abort          │  │  }, signal)             │
   │     │            │  │   → BeforeTool hook     │
   │     ▼            │  │   → MessageBus policy   │
   │ ContentGenerator │  │   → tool exec           │
   │ (auth lives here)│  │   → AfterTool hook      │
   └──────────────────┘  │   → CompletedToolCall[] │
                         └─────────────────────────┘

   Runner yields Events → adk-event-translator → AgentEvent[]
     → AdkAgentProtocol._emit → subscribers (TUI, non-interactive, etc.)
     └─ ChatRecordingService.recordMessage on final (non-partial) events:
        user messages, consolidated model responses, usage, tool calls
```

Per-flow walkthroughs (typical message, 429 fallback, loop detection,
`/rewind`, subagent invocation) and scaffold sketches live in
[`implementation_details.md`](./implementation_details.md).

#### Session entry point

`AgentProtocol` is the interface ([`types.ts:11`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agent/types.ts#L11)). `AgentSession` is the
existing wrapper class that implements `AgentProtocol`
([`agent-session.ts:18`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agent/agent-session.ts#L18)). M5 adds `AdkAgentProtocol` as a second
implementation; the existing `AgentSession` wrapper composes either one.
The whole ADK runtime sits inside one constructor:

```ts
class AdkAgentProtocol implements AgentProtocol {
  constructor(opts: {
    config: Config;                            // model + workspace + services
                                               // (auth lives inside the ContentGenerator
                                               //  returned by config.getContentGenerator())
    instructionProvider: InstructionProvider;  // system prompt (mode-aware)
    tools: BaseTool[];                         // gemini-cli tools wrapped via toAdkTool;
                                               // MCP tools come from MCPToolset
    plugins: BasePlugin[];                     // HookBridge, LoopDetection, MaxTurns, ...
    requestProcessors: RequestProcessor[];     // full ordered ADK + GCLI processor list
    sessionService: BaseSessionService;        // GcliSessionService (live in-memory events)
    parentSessionId?: string;                  // present iff this is a subagent
  });
  send(input: AgentSend): Promise<{ streamId: string | null }>;
  subscribe(cb: (e: AgentEvent) => void): Unsubscribe;
  abort(): Promise<void>;
  get events(): readonly AgentEvent[];
}
```

#### Hooks

Gemini CLI's `HookSystem` (`packages/core/src/hooks/`) ships 11 events
that user-defined hooks integrate against. We keep it as the user-facing
surface; exposing ADK plugins to users would force every existing hook
to rewrite against different signatures.

Eight of the 11 fire at boundaries our own code controls. Three fire
mid-loop where only ADK knows the timing. We fire the eight directly;
the three go through a small ADK plugin.

Owned — fire from our own code:

| Hook | Fires from |
| --- | --- |
| `BeforeTool` / `AfterTool` | `scheduler.schedule()` |
| `BeforeAgent` / `AfterAgent` | `AdkAgentProtocol` on `agent_start` / `agent_end` |
| `SessionStart` / `SessionEnd` | `AdkAgentProtocol` constructor / `.dispose()` |
| `PreCompress` | `ChatCompressionService` |
| `Notification` | `AdkAgentProtocol._emit` on tool-notification events |

Bridged — fire from an ADK plugin callback:

| Hook | Fires from |
| --- | --- |
| `BeforeToolSelection` | `HookBridgePlugin.beforeModelCallback` |
| `BeforeModel` | `HookBridgePlugin.beforeModelCallback` |
| `AfterModel` | `HookBridgePlugin.afterModelCallback` |

`HookBridgePlugin` is a `BasePlugin` registered with the runner. ADK
invokes its model callbacks; the body fires the matching gemini-cli
hook events. One-way, no state.

#### MCP

Today. `mcp-client.ts` is a full server-lifecycle layer: tool discovery, prompt and resource registries, OAuth refresh and 401 recovery, list-change notifications, stdio crash restart, and progress routing.

What ADK provides. `MCPToolset` is tool-scoped — tools/list and tools/call only, for stdio and streamable HTTP ([`mcp_toolset.ts:58`](https://github.com/google/adk-js/blob/main/core/src/tools/mcp/mcp_toolset.ts#L58), [`mcp_tool.ts:65`](https://github.com/google/adk-js/blob/main/core/src/tools/mcp/mcp_tool.ts#L65)), with HTTP auth material set at connection construction ([`mcp_session_manager.ts:38-50`](https://github.com/google/adk-js/blob/main/core/src/tools/mcp/mcp_session_manager.ts#L38-L50)). It builds its own session manager rather than reusing ours, and exposes no path to prompts or resources even though the underlying `@modelcontextprotocol/sdk` client supports them. Stored-token refresh, 401 recovery, list-change handlers, progress notifications, and stdio crash restart are absent.

Open Questions:

- Upstream the missing surface into `MCPToolset`, or keep `McpClient` and pass its outputs (tools, prompts, resources) into the ADK runtime as functional tools?

#### Subagents

A subagent is an `AgentProtocol` with a different system prompt, tool subset, and termination policy. Local subagents run through the same `AdkAgentProtocol` constructor as the top-level session; the session factory selects the runtime and picks which plugins ride along per session. The factory omits `LoopDetectionAdkPlugin` for subagents — they have no loop detection today and terminate via `complete_task` plus the executor's turn/time guards. `Config` and `MessageBus` pass through.

Remote subagents (`RemoteAgentInvocation`, [`remote-invocation.ts:41`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/remote-invocation.ts#L41)) are unaffected — they run on our own A2A integration, and M4's `AgentTool` routes remote vs. local on `definition.kind`. The wiring change is at [`subagent-tool-wrapper.ts:97`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/subagent-tool-wrapper.ts#L97), which today directly constructs `LocalSubagentInvocation` ([`local-invocation.ts:48`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/local-invocation.ts#L48)) and instead delegates to the session factory.

Legacy reference points for the behaviors Phase B reimplements as plugins / wrappers:

- `complete_task` mandatory terminator ([`local-executor.ts:355`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/local-executor.ts#L355)) — subagent must call this tool or it errors with `ERROR_NO_COMPLETE_TASK_CALL`.
- Grace-period recovery turn ([`local-executor.ts:460`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/local-executor.ts#L460), [`:724`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/local-executor.ts#L724)) — single final retry with an injected "you must call `complete_task` now" message on recoverable terminate reasons.
- Scoped execution wrappers ([`local-executor.ts:530-545`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/local-executor.ts#L530-L545), memory injection at [`:624`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/local-executor.ts#L624) and [`:1339`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/local-executor.ts#L1339)) — workspace, memory-inbox, auto-memory-extraction wrap the run.
- `onWaitingForConfirmation` UI signal — propagated through the executor's activity callback today; maps to `BeforeTool` under ADK.

#### Loop detection

Today. `LoopDetectionService` runs two detectors against one strike counter: a sliding-window hash over text/tool-call chunks as they stream ([`loopDetectionService.ts:339-437`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/loopDetectionService.ts#L339-L437)), and a per-N-turn semantic check via a side LLM call ([`loopDetectionService.ts:261-311`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/loopDetectionService.ts#L261-L311)). Below threshold, `GeminiClient` prepends a "System: Potential loop detected..." nudge to the next request ([`client.ts:1246-1279`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/client.ts#L1246-L1279)); at threshold, it throws and the turn unwinds.

What ADK provides. Plugin callbacks at every event, around every model call, and on model error (the latter can return a replacement response to keep the loop going). Model output is double-emitted — partial deltas per chunk AND a single consolidated event for the same response — so anything reading the stream has to pick one to avoid double-counting. Exit mechanisms ([`llm_agent.js:634-686`](https://github.com/google/adk-js/blob/main/core/src/agents/llm_agent.ts#L634-L686)): a tripped abort signal returns the generator silently; a thrown Error from inside the model call yields a synthetic error event and ends the turn; a replacement response from `onModelErrorCallback` keeps the loop going. ADK has no direct equivalent of "prepend a system message to the next request"; the closest path is mutating the request contents inside `beforeModelCallback`.

Open Questions:

- Which event stream feeds the detector — partial deltas vs consolidated events?
- How does the soft-recovery nudge get into the next request?
- Which terminate mechanism — abort, throw, or replacement response ([`llm_agent.js:634-686`](https://github.com/google/adk-js/blob/main/core/src/agents/llm_agent.ts#L634-L686))?

#### Slash commands

Slash commands live outside the core `AgentProtocol` layer, in a slash-command/runtime-adapter layer wired during Phase C. Specific commands (`/clear`, `/help`, `/memory`, `/compress`, `/rewind`, `/agents`, ...) route differently — some are pure TUI commands, some need to talk to the session, some restart the engine. Implementation details for the adapter layer (per-command routing, abort propagation, and the `ConversationRecord → ADK Event` conversion that `/rewind` requires) are still being expanded.

#### What we reuse from gemini-cli

These existing services remain the source of truth under the ADK runtime.
M5 adapts to them rather than replacing them:

- `scheduler.schedule()` — tool execution, approval, telemetry, truncation/distillation, `BeforeTool`/`AfterTool` hooks all run inside it (masking is separate — see Tool output masking row)
- `MessageBus` + `PolicyEngine` — tool approval correlation; legacy approval UI continues to consume bus events
- `handleFallback` + `ModelAvailabilityService` — 429 fallback + model pool
- `ModelRouterService` — per-turn model selection (sequence-sticky), authoritative for routing
- `ModelConfigService` — model resolution per request
- `LoopDetectionService` — strike-tracked detector
- `ChatRecordingService` — product-facing conversation persistence + `rewindTo`
- `ChatCompressionService` — outgoing-history projection only; ADK `Session.events` stays as in-memory loop state, `ConversationRecord` stays authoritative for persistence and `/rewind`
- `InjectionService` — user steering queue
- `ToolOutputMaskingService` — masking
- `HookSystem` + 11 hook events — see Hooks section
- Existing tool catalog and slash commands

#### What old logic gets dropped under ADK

These are the legacy bits the ADK runtime actually replaces:

- `GeminiClient.processTurn` — replaced by ADK `Runner` + request processors.
- `GeminiChat` — replaced by ADK `Session` events.
- `Turn` loop — replaced by ADK `LlmAgent.runAsyncImpl`.
- `ServerGeminiStreamEvent` — replaced by ADK `Event` → translator → `AgentEvent`.

#### What we don't reuse from ADK

ADK is a framework; we adopt the loop and a few extension points. The
exclusions below would each be plausible mistakes without explicit
rejection:

- ADK's built-in `Gemini` (`BaseLlm`) — we run our own `BaseLlm` subclass (`GcliAgentModel`) that dispatches through `config.getContentGenerator()`. Auth (OAuth / Gemini API key / Vertex), fallback retry, recording/logging wrappers, and telemetry all live in our content generator; using ADK's bare client would bypass all of that.
- `BasePolicyEngine` / `SecurityPlugin` — legacy `MessageBus` + `PolicyEngine` stays. ADK's security plugin would force the approval UI to re-bind against ADK elicitations.
- `BaseContextCompactor` — `ChatCompressionService` stays. ADK's compactor doesn't know about our token-budget projection rules.
- ADK `RoutedLlm` — not the routing source of truth. Gemini CLI routing (`ModelRouterService` + `ModelConfigService` + `ModelAvailabilityService`, sequence-sticky model, model-specific tool/config updates) remains authoritative. Routing lives in a custom ADK `RequestProcessor` — see Model routing in implementation_details.md.
- `BaseSessionService` (file-backed) — `ChatRecordingService` stays. M5 uses a small `GcliSessionService` implementation for in-memory ADK event state.
- Most ADK plugin callbacks — see Hooks section.

#### Supported under ADK runtime

| Feature | Seam |
| --- | --- |
| Auth (OAuth / Gemini API key / Vertex) | `GcliAgentModel` maps ADK `LlmRequest` to `GenerateContentParameters` and dispatches through `config.getContentGenerator()`; auth lives in the content generator implementation |
| Model fallback (429) | `GcliAgentModel` ports the existing `retryWithBackoff` + `handleFallback` + `ModelAvailabilityService` path; retry stays inside the model wrapper, not ADK Runner |
| Dynamic routing & availability | `GcliRoutingProcessor` (a custom ADK `RequestProcessor`) consults `ModelRouterService`, `ModelConfigService`, `ModelAvailabilityService`, and the sequence-sticky model, then rewrites `LlmRequest.model` + tool/config before tool preprocessing. No ADK `RoutedLlm` — see Model routing in implementation_details.md |
| Tool execution | Existing `scheduler.schedule()` |
| Tool approval | Existing `MessageBus` + `ToolConfirmationQueue.tsx` |
| Tool output masking | `ToolOutputMaskingProcessor` (a custom ADK `RequestProcessor`) runs `ToolOutputMaskingService.mask`, writes the masked view back to `LlmRequest.contents`, and applies the same masked function responses back to the live ADK session events by event/part identity rather than request-content index; then calls `ChatRecordingService.updateMessagesFromHistory` to sync the transcript. Per-call truncation rides for free inside `scheduler.schedule`. |
| Chat compression | Existing `ChatCompressionService` (outgoing-history projection only) |
| Loop detection | `LoopDetectionAdkPlugin` + `LoopDetectionService` — see Loop detection section |
| Plan mode | `InstructionProvider` + mode-aware tools (mode-change side effects fire from `Config`, runtime-independent) |
| User steering (between turns) | `beforeModelCallback` consumes `InjectionService` queue |
| MCP `tools/list` + `tools/call` | Native `MCPToolset` — see MCP section |
| MCP OAuth | Scoping open — see MCP section |
| Subagents | M4 `AgentTool` + session factory — see Subagents section |
| `/rewind` and all `/slash commands` | Live outside the protocol layer. `/rewind` is a slash-command/runtime-adapter concern: the adapter truncates `ConversationRecord` via `ChatRecordingService.rewindTo` and drops the ADK session; next `send()` rebuilds via `appendEvent`. Wired in Phase C (interactive). |
| User hooks (11 events) | See Hooks section |
| Max turns / tokens / time | Custom plugins (`MaxTurnsAdkPlugin`, `TokenLimitAdkPlugin`, `MaxTimeAdkPlugin`) |
| Telemetry / Clearcut | Translator + plugin instrumentation; no new telemetry architecture |
| Session persistence | `ChatRecordingService` remains the persisted conversation record; ADK `Session.events` (held in `GcliSessionService`) is runtime state only. `streamId` parity only; `eventId` resume is preserved on the protocol interface, see Rewind PR |
| Skills, slash commands, ACP | Unchanged surfaces (ACP picks runtime by feature flag) |
| VSCode IDE companion | Unaffected — side-channel to CLI process |

#### Not supported under ADK runtime

| Feature | Status | Rationale |
| --- | --- | --- |
| MCP `/mcp prompts` (`prompts/list`, `prompts/get`) | Scoping open — see MCP section | `MCPToolset` exposes no prompts API today. |
| MCP `/mcp resources` (`resources/list`, `resources/read`) | Scoping open — see MCP section | Same gap as prompts. |

---

## M5 Execution Plan

**Foundation** — sequenced first:

| # | Title | Type |
| --- | --- | --- |
| 1 | `[AdkAgent] Scaffold adk-agent/ module: AdkAgentProtocol skeleton, GcliSessionService, seam names` | Feature |
| 2 | `[AdkAgent] Add experimental.adk.runtimeEnabled flag + session factory + define precedence vs existing agentSessionNoninteractiveEnabled` | Feature |
| 3 | `[AdkAgent] Delete unused elicitation_request/response from AgentEvent types` | Bug |

**Phase A — Non-interactive.** Wires the non-interactive AgentSession entry
point through the ADK runtime. Proves the core loop without TUI complexity.

| # | Title | Type |
| --- | --- | --- |
| A1 | `[AdkAgent] Translator: text + thought + functionCall + functionResponse + usage + error (with _meta.code) + partial/consolidation + agent_start/end; matches event-translator.test.ts shape` | Feature |
| A2 | `[AdkAgent] GcliAgentModel: dispatch ADK LlmRequest through config.getContentGenerator() + AbortSignal propagation` | Feature |
| A3 | `[AdkAgent] GcliAgentModel: 429 retry via retryWithBackoff + handleFallback + ModelAvailabilityService (retry inside the model wrapper); silent-policy branch covers non-interactive without a UI handler; covers concrete-model changes` | Feature |
| A4 | `[AdkAgent] GcliRoutingProcessor (custom ADK RequestProcessor) + move sequence-sticky model owner from GeminiClient to Config with named reset points` | Feature |
| A5 | `[AdkAgent] Invalid-stream retry + next-speaker continuation (client.ts:818, :845) — port or explicitly mark Not Supported` | Feature |
| A6 | `[AdkAgent] toAdkTool: route execution through existing scheduler.schedule()` | Feature |
| A7 | `[AdkAgent] GcliSessionService: BaseSessionService implementation with authoritative live session map and single-append semantics` | Feature |
| A8 | `[AdkAgent] ToolOutputMaskingProcessor: ToolOutputMaskingService.mask + apply masks back to live session events by event/part identity + sync ChatRecordingService.updateMessagesFromHistory` | Feature |
| A8a | `[Cleanup] Migrate toolDistillationService off GeminiClient onto BaseLlmClient` | Bug |
| A9 | `[AdkAgent] Plugins: MaxTurnsAdkPlugin + TokenLimitAdkPlugin + MaxTimeAdkPlugin (beforeModelCallback / before+after)` | Feature |
| A10 | `[AdkAgent] LoopDetectionAdkPlugin: feed partial:true deltas to detector; on terminate call protocol.abort() with LOOP_DETECTED; protocol emits synthetic error event` | Feature |
| A11 | `[AdkAgent] MCP: adopt native MCPToolset for stdio + HTTP (tools/list + tools/call only)` | Feature |
| A11a–d | `[adk-js upstream] MCPToolset capability gaps: prompts/resources, auth lifecycle (token reuse/refresh/401), server lifecycle (list-change, stdio restart, progress, close), and wire upstream prompts/resources into PromptRegistry + ResourceRegistry` | Feature |
| A12 | `[AdkAgent] Wire non-interactive entry point through session factory to select ADK runtime` | Feature |

**Phase B — Local subagents.** Reuses the Phase-A runtime for child sessions
once Phase A is wired and runs cleanly.

| # | Title | Type |
| --- | --- | --- |
| B1 | `[AdkAgent] Route subagent-tool-wrapper.ts:97 constructor through session factory; return ADK-backed AgentProtocol when the parent runtime is ADK` | Feature |
| B2 | `[AdkAgent] Subagent: complete_task mandatory terminator plugin (afterModelCallback)` | Feature |
| B3 | `[AdkAgent] Subagent: grace-period recovery turn (inject "you must call complete_task now" + final retry)` | Feature |
| B4 | `[AdkAgent] Subagent: scoped execution wrappers (workspace, memory-inbox, auto-memory-extraction)` | Feature |
| B5 | `[AdkAgent] Subagent: onWaitingForConfirmation activity signal via BeforeTool` | Feature |

**Phase C — Interactive.** Wires the TUI last. By this point the runtime
loop, model path, tools, fallback, masking, and subagents are already proven
outside the TUI. **All `/slash commands` live outside the protocol layer.**

| # | Title | Type |
| --- | --- | --- |
| C1 | `[AdkAgent] Wire interactive AgentSession through session factory; TUI stream rendering parity` | Feature |
| C2 | `[AdkAgent] User steering injection via beforeModelCallback` | Feature |
| C3 | `[AdkAgent] Plan mode: InstructionProvider for system-prompt swapping + mode-aware tool filtering via BaseToolset` | Feature |
| C4 | `[AdkAgent] HookBridgePlugin: fire BeforeModel / AfterModel / BeforeToolSelection from beforeModelCallback / afterModelCallback` | Feature |
| C5 | `[AdkAgent] Wire SessionStart / SessionEnd / BeforeAgent / AfterAgent / Notification hooks (Notification fires from AdkAgentProtocol._emit on tool-notification events)` | Feature |
| C6 | `[AdkAgent] Register TUI fallbackModelHandler callback so non-silent intents (retry_once / stop / upgrade / retry_with_credits) work; handleFallback machinery is already wired in Phase A` | Feature |
| C7 | `[AdkAgent] /rewind: slash-command/runtime-adapter truncates ConversationRecord via ChatRecordingService.rewindTo, drops ADK session, next send() rebuilds via appendEvent (NOT an AgentProtocol method)` | Feature |
| C8 | `[AdkAgent] Make ADK runtime the default for all wired surfaces` | Feature |
