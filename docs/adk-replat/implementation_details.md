# M5 Implementation Details

Companion to `replatforming_design.md`. Per-flow walkthroughs, the routing
and masking integration recipes, and the seam-level acceptance criteria
for the early scaffolding PRs. Anything strategic goes back into the
design doc; this file is the mechanical reference.

## Surface Phases

M5 lands by runnable surface, not by isolated subsystem. Each phase wires
one call site end-to-end before the next starts.

**Phase A — Non-interactive.** Wires the ADK runtime through the
non-interactive AgentSession path. Translator, `GcliAgentModel` dispatch
through `ContentGenerator`, `GcliRoutingProcessor`, 429 retry +
`handleFallback` + `ModelAvailabilityService` (silent-policy branch swaps
models without a UI prompt; non-silent intents are unreachable until the
TUI handler lands), abort, scheduler-backed tool execution,
`ToolOutputMaskingProcessor`, `LoopDetectionAdkPlugin`, native
`MCPToolset` (`tools/list` + `tools/call`).

**Phase B — Local subagents.** Same `AdkAgentProtocol` as Phase A; new
work is subagent-only behavior: factory wiring at
[`subagent-tool-wrapper.ts:97`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/subagent-tool-wrapper.ts#L97), `complete_task` terminator, grace-period
recovery turn, scoped execution wrappers (workspace, memory-inbox,
auto-memory-extraction), and the `onWaitingForConfirmation` activity
signal. Event propagation to the parent is already an M4 property — no
new wiring.

**Phase C — Interactive.** Wires the TUI on top of the proven runtime.
Stream rendering parity, `session_update`, `HookBridgePlugin` + lifecycle
hooks + `Notification`, plan mode (`InstructionProvider` + mode-aware
tools), user steering injection, the TUI-registered
`fallbackModelHandler` callback (unlocks `retry_once`/`stop`/`upgrade`),
and `/rewind`. **All `/slash commands` live outside the protocol
layer** — `/rewind` is a slash-command/runtime-adapter concern.

## Walkthroughs

**Typical message:** user input → `AdkAgentProtocol.send` → emit `agent_start` (`BeforeAgent` hook fires) → emit deterministic `session_update{model}` once `config.getModel()` is resolved (do NOT wait on first translator output — first output may be `error` or `usage`) → `Runner.runAsync` → request processors run in one explicit ordered list (ADK defaults through `CONTENT_REQUEST_PROCESSOR`, then `ToolOutputMaskingProcessor`, then `GcliRoutingProcessor`, then the remaining ADK defaults; supplying `config.requestProcessors` replaces ADK's default list, so we must include the defaults ourselves) → tool preprocessing → `beforeModelCallback` runs guards + `BeforeModel` / `BeforeToolSelection` hooks → `GcliAgentModel.generateContentAsync` dispatches through `config.getContentGenerator().generateContentStream(...)` → translator emits `message` + `tool_request` events → `toAdkTool.execute` calls `scheduler.schedule` (`BeforeTool` hook, approval, exec, per-call truncation at 40k chars via [`tool-executor.ts:196-292`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/scheduler/tool-executor.ts#L196-L292), `AfterTool` hook) → feeds back → loop iterates → final `message` events → `agent_end` (`AfterAgent` hook fires). ADK currently dispatches function calls sequentially within a turn ([`functions.ts:345-491`](https://github.com/google/adk-js/blob/main/core/src/agents/functions.ts#L345-L491)), and `scheduler.schedule` queues concurrent callers — no interleaving risk.

**429 fallback:** `GcliAgentModel` owns the same retry loop shape that `GeminiChat` owns today: the content-generator call is inside a `retryWithBackoff` `apiCall` closure, `onPersistent429` calls `handleFallback(config, currentModel, authType, error)`, the handler applies the existing `ModelAvailabilityService` transition and may call `config.activateFallbackMode(...)` for `retry_always`, then the retry loop resets attempts and re-runs the same closure. Do not throw to ADK Runner for retry; `LlmAgent.runAndHandleError` converts thrown model errors into error responses/events. Fallback retry must re-resolve the same current model/config path used by `GcliRoutingProcessor`, and the parity test must cover a fallback that changes the concrete model so we do not dispatch with stale model-specific config or tool declarations. The TUI's `fallbackModelHandler` callback ([`handler.ts:89`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/fallback/handler.ts#L89)) is what unlocks the non-silent intents (`retry_once`, `stop`, `upgrade`); non-interactive runs without one and `handleFallback` returns `null` after silent transitions — that's by design, not a Phase A limitation.

**Loop detection:** `LoopDetectionAdkPlugin.onEventCallback` feeds each `partial:true` delta to `LoopDetectionService.addAndCheck`, and ignores the `partial:false` consolidated event so the accumulated buffer isn't double-counted. On terminate the plugin calls `protocol.abort()` with reason `LOOP_DETECTED`; the protocol emits a synthetic `error{_meta.code:'LOOP_DETECTED'}` event and the abort propagates through `InvocationContext.abortSignal` into `GcliAgentModel.generateContentAsync`. The plugin does NOT mutate the in-flight ADK event and does NOT abort inside `onEventCallback` — that would drop the event before yield ([`runner.ts:332-334`](https://github.com/google/adk-js/blob/main/core/src/runner/runner.ts#L332-L334)).

**`/rewind`:** slash command → slash-command/runtime-adapter (NOT an `AgentProtocol` method) → `ChatRecordingService.rewindTo(id)` truncates `ConversationRecord.messages` ([`chatRecordingService.ts:743-762`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts#L743-L762)) → `sessionService.deleteSession(...)` drops the ADK session → emits `session_update`. Next `send()` calls `sessionService.createSession(...)` then `appendEvent`s each retained `ConversationRecord` message converted to an ADK `Event` (`InMemorySessionService.createSession` has no seed-events parameter — [`in_memory_session_service.ts:54-67`](https://github.com/google/adk-js/blob/main/core/src/sessions/in_memory_session_service.ts#L54-L67)). Conversion fields: ISO timestamp → epoch ms, `type:'user'|'gemini'` → `author`, synthesized deterministic `invocationId` (ConversationRecord has none), `ToolCallRecord` → `FunctionCall` + `FunctionResponse` Parts, thoughts and `TokensSummary` → `actions.customMetadata`. Rewind-injected events are non-partial by construction. Wired in Phase C alongside the rest of the interactive surface.

**Subagent invocation:** Parent ADK `LlmAgent` dispatches an M4 subagent tool → [`subagent-tool-wrapper.ts:97`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/subagent-tool-wrapper.ts#L97) calls the session factory (today it constructs `LocalSubagentInvocation` directly — [`local-invocation.ts:48`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/local-invocation.ts#L48)) → factory returns an ADK-backed `AgentProtocol` when the flag is on, legacy `LocalSubagentInvocation` otherwise → child constructs its own independent `Runner` with its own `LlmAgent`, plugins, tools, and `GcliSessionService` → child events stream back through the M4 wrapper to the parent as `tool_update`s and a terminal `tool_response`. Both implementations satisfy `AgentProtocol`; the factory selects between them. Existing parent-side telemetry on [`subagent-tool.ts:224`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/subagent-tool.ts#L224) / [`subagent-tool-wrapper.ts:75`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/subagent-tool-wrapper.ts#L75) is the correlation point — no aggregation changes for M5.

## Model routing

ADK ships a `RoutedLlm` that can sit in front of a `BaseLlm` and pick a model
per call. M5 does not use it. Gemini CLI already owns the routing stack
(`ModelRouterService`, sequence-sticky model, `applyModelSelection`,
`ModelConfigService`, `ModelAvailabilityService`, fallback config), and that
behavior has to stay byte-for-byte the same through the deprecation window.
Bolting a second routing layer on top would not preserve behavior; it would
give us two places to keep in sync.

The integration is a custom ADK **request processor**, not a step inside
`BaseLlm`. ADK runs request processors at [`llm_agent.ts:731-743`](https://github.com/google/adk-js/blob/main/core/src/agents/llm_agent.ts#L731-L743) before
tool preprocessing ([`llm_agent.ts:746`](https://github.com/google/adk-js/blob/main/core/src/agents/llm_agent.ts#L746)) and before
`BaseLlm.generateContentAsync` ([`llm_agent.ts:1024`](https://github.com/google/adk-js/blob/main/core/src/agents/llm_agent.ts#L1024)). Selecting the model
inside `generateContentAsync` is too late — tool declarations and
generation config have already been materialized from whatever model was
on the `LlmRequest` when it arrived.

Per-call flow inside `GcliRoutingProcessor.runAsync(invocationContext, llmRequest)`:

1. Build a `RoutingContext` from the masked `llmRequest.contents` + `invocationContext.session` + `Config` + `abortSignal`. Same shape `GeminiClient.processTurn` constructs today.
2. If the current sequence model is set, keep using it for this tool-call sequence. Otherwise call `config.getModelRouterService().route(routingContext)`. Sequence-sticky state moves to `Config` (or its successor) in PR #14 with named reset points — today it lives on `GeminiClient` ([`client.ts:101`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/client.ts#L101), [`:339`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/client.ts#L339)).
3. Run the selection through the existing path: `applyModelSelection(...)`, `ModelConfigService`, `ModelAvailabilityService`. Active model, availability state, fallback config, and resolved generation config stay consistent with the legacy run loop. Set the current sequence model.
4. Rewrite `llmRequest.model`, `llmRequest.config` (system instructions, generation config), and the tool subset in place. ADK's tool preprocessing then sees the resolved model.

`GcliAgentModel.generateContentAsync` is the content-generator dispatcher plus the legacy-compatible fallback retry loop:

5. Check abort signal.
6. Map ADK `LlmRequest` → `GenerateContentParameters` and call `config.getContentGenerator().generateContentStream(...)`. Auth (login-with-Google, Gemini API key, Vertex, ADC/compute, gateway, fake responses, logging/recording wrappers) lives inside the content generator implementation — no header injection in this layer.
7. Stream the result back to ADK, propagating abort. On 429 / persistent quota errors, stay inside the local `retryWithBackoff` loop: call `handleFallback(...)`, let it apply the existing availability/fallback state transition, reset attempts when it returns a retry intent, and re-enter the content-generator call path. A thrown model error is terminal for this ADK iteration unless an ADK `onModelError` callback returns a replacement response; Runner does not automatically re-run request processors.

## Availability service integration

`ModelAvailabilityService` is a self-contained state machine — no Config in its constructor, no Config reads in its methods, just a `Map<ModelId, HealthState>` and the methods that mutate it ([`modelAvailabilityService.ts:41-137`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/availability/modelAvailabilityService.ts#L41-L137)). The class is reusable as-is under ADK. The integration *around* it is Config-driven, and that's what has to be ported.

What feeds the service: `handleFallback` reads the policy chain from Config (`resolvePolicyChain(config)`), takes the failed model as a parameter, and calls `availability.selectFirstAvailable(candidates)`. The failed model comes from [`client.ts:1080`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/client.ts#L1080): `const active = this.config.getActiveModel()`. The retry loop re-polls Config between attempts so any mid-loop fallback mutation is picked up cleanly.

What resets the service: two triggers, both outside the service. `reset()` fires from `config.setModel()` ([`config.ts:1813`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/config.ts#L1813)), itself triggered by `config.activateFallbackMode()` after a `retry_always` decision. `resetTurn()` fires at the turn boundary — call site not yet verified, probably `client.ts` or `GeminiChat`.

What `GcliAgentModel` has to do: replicate the [`client.ts:1072-1110`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/client.ts#L1072-L1110) retry pattern faithfully — pre-call read `config.getActiveModel()`, call `handleFallback(config, currentAttemptModel, authType, error)` on persistent 429, re-poll Config before the next attempt. The `resetTurn` trigger lands at whatever ADK boundary corresponds to "new turn started" — ADK doesn't know about it, so it's an explicit wire.

Subagent note: `AgentLoopContext.config` is shared by reference between parent and child, so parent and subagent share the same `ModelAvailabilityService.health` map and the same `_activeModel`. A subagent fallback mutates parent state. This is legacy behavior, not an ADK regression — flagging it as a documented property, not a Phase A task.

Open Questions: locate the `resetTurn` call site in legacy and map it to an ADK trigger.

## Tool output masking

Two mechanisms, only one is new under ADK:

**Per-call truncation (already done by the scheduler).** When a tool returns, [`tool-executor.ts:196-292`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/scheduler/tool-executor.ts#L196-L292) truncates content > 40k chars for shell and single-text-part MCP tools, writes the full output to `<projectTempDir>/.../<toolName>_<callId>_<random>.txt`, and returns a snippet + file path pointer. This rides for free in M5 because `toAdkTool` calls the scheduler.

**Per-turn batch masking (this is what's new).** Today [`client.ts:637`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/core/client.ts#L637) calls `tryMaskToolOutputs(getHistory())` inside `processTurn`, after compression and before the model call. `ToolOutputMaskingService.mask` walks the whole history, applies a 50k-protection + 30k-prunable-gate sliding window, writes full content to disk, replaces `functionResponse.response` with a `<tool_output_masked>...</tool_output_masked>` preview + pointer ([`toolOutputMaskingService.ts:70-272`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/context/toolOutputMaskingService.ts#L70-L272)). Then `setHistory` syncs to `ChatRecordingService.updateMessagesFromHistory` ([`chatRecordingService.ts:768`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts#L768)).

Under ADK this becomes a custom `RequestProcessor` (`ToolOutputMaskingProcessor`) registered with `LlmAgent` after ADK has built `llmRequest.contents` from `session.events` and before `GcliRoutingProcessor` reads those contents. The processor:

1. Reads `llmRequest.contents` (produced by ADK's `ContentRequestProcessor` from `session.events`).
2. Calls `ToolOutputMaskingService.mask(llmRequest.contents, config)`. The algorithm is unchanged.
3. Applies each masked `functionResponse` back to the matching live ADK `Session.events` part by stable event/part identity. Do not use `session.events[i]` ⇔ `llmRequest.contents[i]`; ADK filters, rearranges, and clone-deeps content while building the request ([`content_processor_utils.ts:72-84`](https://github.com/google/adk-js/blob/main/core/src/agents/processors/content_processor_utils.ts#L72-L84)).
4. Writes the masked `llmRequest.contents` back so the model call and downstream routing see the masked view.
5. Calls `ChatRecordingService.updateMessagesFromHistory(masked)` so the persisted transcript matches.

`isAlreadyMasked` keeps it idempotent across turns. The disk file path stays the same across runs once we drop the `Math.random()` suffix in the filename (also part of PR #21).

## GcliSessionService

`InMemorySessionService.getSession` does `cloneDeep(session)` ([`in_memory_session_service.ts:88-131`](https://github.com/google/adk-js/blob/main/core/src/sessions/in_memory_session_service.ts#L88-L131)), so the runner operates on a clone of the stored session. Any mutation to `invocationContext.session.events[i]` only persists for the duration of `runAsync`; the next turn fetches a fresh clone. Subclassing it is not enough: its `sessions` store is private ([`in_memory_session_service.ts:40`](https://github.com/google/adk-js/blob/main/core/src/sessions/in_memory_session_service.ts#L40)), and returning the stored reference from `getSession` would make inherited `appendEvent` push the same event twice ([`in_memory_session_service.ts:173-227`](https://github.com/google/adk-js/blob/main/core/src/sessions/in_memory_session_service.ts#L173-L227)).

`GcliSessionService` extends `BaseSessionService`, not `InMemorySessionService`. It owns an authoritative live-session map keyed by `appName/userId/sessionId`. Plugins and request processors that mutate session events (masking is the primary use case) get persistence across turns.

```ts
class GcliSessionService extends BaseSessionService {
  private readonly liveSessions = new Map<string, Session>();

  private key(appName: string, userId: string, sessionId: string): string {
    return `${appName}\0${userId}\0${sessionId}`;
  }

  override async createSession(req: CreateSessionRequest): Promise<Session> {
    const session = createSession({
      id: req.sessionId ?? randomUUID(),
      appName: req.appName,
      userId: req.userId,
      state: req.state ?? {},
      events: [],
      lastUpdateTime: Date.now(),
    });
    this.liveSessions.set(this.key(req.appName, req.userId, session.id), session);
    return session;
  }

  override async getSession(req: GetSessionRequest): Promise<Session | undefined> {
    const session = this.liveSessions.get(
      this.key(req.appName, req.userId, req.sessionId),
    );
    if (!session || !req.config) return session;
    // If a caller asks for a filtered view, return a copy so the caller cannot
    // mutate a truncated live session.
    return copyWithFilteredEvents(session, req.config);
  }

  override async appendEvent(req: AppendEventRequest): Promise<Event> {
    const event = await super.appendEvent(req); // pushes once, skips partials
    req.session.lastUpdateTime = event.timestamp;
    return event;
  }
}
```

`listSessions` and `deleteSession` operate on `liveSessions`; they do not delegate to an inner `InMemorySessionService` whose state would drift once `appendEvent` stops delegating. The runner calls `getSession` without `GetSessionConfig`, but preserving filtered-copy behavior for `numRecentEvents` / `afterTimestamp` keeps the service compatible with other ADK callers. If any M5 plugin uses ADK app/user state prefixes, PR #20 ports `InMemorySessionService`'s app-state/user-state handling too; otherwise the service intentionally supports only session-local state.

## PR seam summary

Seam names and acceptance criteria for the foundation PRs. Aside from the `GcliSessionService` code shape above, pseudo-code stubs are intentionally omitted because they drift from real code; the per-PR description owns the implementation specifics.

**PR #1 — Scaffold.** Add `packages/core/src/adk-agent/`. Export `AdkAgentProtocol` (skeleton implementing `AgentProtocol`), `GcliSessionService` (`BaseSessionService` implementation with live session storage), and named seam files for `GcliAgentModel`, `GcliRoutingProcessor`, `ToolOutputMaskingProcessor`, `HookBridgePlugin`, `LoopDetectionAdkPlugin`, `toAdkTool`. All bodies are TODO; compile green; no behavior change. Acceptance: module compiles, file structure matches the architectural sketch, all symbols importable.

**PR #2 — Flag + factory.** Add `experimental.adk.runtimeEnabled` to the settings schema. Implement the session factory: builds an `AdkAgentProtocol` when the runtime flag is on, otherwise the existing legacy implementation. Define precedence with `experimental.adk.agentSessionNoninteractiveEnabled` (the new flag is the runtime selector; the old one continues to gate the non-interactive code path). Acceptance: flag visible in settings, factory unit-tested with both flag states, no production caller wired yet.

**PR #3 — Event-type cleanup.** Delete unused `elicitation_request`, `elicitation_response`, and `elicitations` references that the protocol surface no longer uses.

(`/rewind` is intentionally NOT a foundation PR. It stays in the slash-command/runtime-adapter layer and is wired during Phase C — see Surface Phases above.)
