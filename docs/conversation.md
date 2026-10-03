# Connecting and driving runs

`agui-inspector` is the approved package name. Nothing is published yet (see [distribution](distribution.md)).
This page describes how the inspector reaches an agent, sends
conversation runs, and handles the two things a finished run can wait for: answers to interrupts and
results for client tool calls. It also covers the controls around a run (Stop, New thread, quick
messages) and what the next run carries. How the events a run streams back appear in the transcript is
in [event-views.md](event-views.md).

The code is in `packages/inspector/src/core/runtime` (plain TypeScript, no React) and
`packages/inspector/src/views/connection`.

## Where requests go

Every request the page makes to a target goes through one guarded transport. That covers the
configuration and capabilities files, preparation requests, conversation runs and raw submissions.

| Rule | What happens |
| --- | --- |
| Destinations | The page's own origin, plus the origins the deployment allowed when the page started. A configuration file or a typed endpoint cannot add one. Anything else is refused before a request is made, and the message names the origin. |
| Embedded | A relative endpoint resolves against the page origin. Requests to that origin use the host's same-origin credentials, so the host's own authentication applies. |
| Hosted | Endpoints must be absolute `http` or `https` URLs. Requests carry no cookies, not even to the page's own origin. |
| URLs with credentials | `https://user:password@host/` is refused, and the message does not repeat what was typed. Use the token field instead. |
| Redirects | Never followed. A redirect answer is an error you can read ("The target answered with a redirect"), and no second request is made. |
| Browser blocks | CORS, private-network access, mixed content or an unreachable server all reach the page as one failed fetch. The error names those causes and the target's origin. The inspector has no proxy and no bypass; fix the target's headers or the allowlist instead. |
| Request headers | The transport sets `Content-Type` and `Accept` itself, and sends no referrer. The only other header is the token. |

A refused or failed request is still an exchange in the inspection session, with its error.

## The token

The token lives in the runtime's connection state and nowhere else. You choose the header name, which
defaults to `Authorization`. The value is sent as-is, so type `Bearer …` if the target wants it.

- It is read in one place: the call to the guarded transport. The recorder never receives it, and no
  request or response header is recorded or exported.
- It is not written to browser storage, configuration, a profile, a session file or a log. Reloading
  the page clears it.
- Changing the agent or the endpoint clears it before anything is sent to the new target. The call
  that changes the target returns `true` when it cleared a token, so the page can say so.
- A header name the browser owns (`Cookie`, `Host`, `Content-Length`) or the transport sets
  (`Content-Type`, `Accept`) is refused, so a token cannot stand in for a cookie.

Don't put the token in the endpoint URL, forwarded properties, context or tool schemas. Those are
recorded and exported.

A target can echo the token back in a response body. That case is settled by
[G-07](../specs/001-inspector-mvp/plan.md#open-decision-and-approval-gates), resolved in constitution 1.0.3:
the inspector never writes the token it holds, and it keeps received frames exactly as they arrived, with
no redaction. If a server echoes your token, it will be in that frame. The export warning about sensitive
payloads applies. [Recordings](recordings.md#a-token-you-entered-and-a-server-that-repeats-it) has the detail.

## Sending a run

A message, a continuation and a surface action all become one ordinary run, in this order:

1. The preset is resolved for this attempt: variables, the built-in `threadId`, `runId` and `uuid`,
   templates, forwarded properties. A variable that does not exist stops here with a message.
2. The run input is built from the profile, the preset and the conversation so far, and checked
   against the protocol's input schema. An input that fails is shown and not sent.
3. The preparation requests are sent in declared order, each as its own recorded exchange.
4. The run request is sent through the protocol client, whose `fetch` is the recorder.

A failure at any step stops everything after it. If a preparation fails, by status or by connection,
the run request is not sent. The preparation exchanges stay in the session, the
error says which request failed, and the message you typed stays in the box so you can send it again.

Preparations run again before every continuation, not just the first run of a thread.

### What the input carries

| Field | Value |
| --- | --- |
| `threadId` | The current thread. A new thread gets a new UUID. |
| `runId` | A new UUID for every attempt. |
| `parentRunId` | Set on a continuation (interrupt answers or tool results) to the run it continues. Not set on an ordinary message or a surface action. |
| `protocolVersion`, `tools`, `context` | From the client profile. |
| `forwardedProps` | The preset's properties, then the profile's over them. A surface action adds `a2uiAction`. |
| `state` | The client's current state: the last snapshot with every delta applied. `{}` on a new thread. |
| `messages` | Full mode: the whole transcript the client built, including assistant messages and the tool calls it saw, plus this turn's messages. Turn mode: only this turn's messages (the new user message, the tool results, or nothing for a resume). |
| `resume` | The answers to the interrupts that ended the previous run. Absent otherwise. |

The body that is recorded in the exchange is the exact text that was sent, and the run record in the
session holds the same input. A message that failed before it was sent is not added to the transcript.

### Stop, New thread, quick messages

- Stop ends every connection that is still open: the active run, a preparation in flight, a raw
  submission whose answer is still streaming, and a run's answer that the recorder is still reading
  after the protocol client rejected it. It stays available as long as one of them is open, which can
  be after the run itself has ended. Each exchange is recorded as stopped by the user and keeps the
  frames received so far. Anything the server sends afterwards is not kept, and
  no terminal event is made up: the run's outcome stays unknown and the missing `RUN_FINISHED` or
  `RUN_ERROR` is reported as a finding on the run. Stop is a transport control. It does not answer
  an interrupt.
- New thread stops every open connection the same way, then starts a new thread: new `threadId`, empty transcript, empty
  state, nothing waiting. The exchanges and frames already recorded are not touched. The conversation
  and State views switch to the new thread at once, before it has a run; the Inspection pane keeps
  every exchange. Selecting another agent or endpoint starts a new thread the same way.
- Quick messages are the preset's one-click messages. They go through the same path as typing the
  message, preparations included.

### What the client reports

The protocol client checks the stream while the recorder keeps every byte. When the client rejects
the stream, it stops processing, but the recording carries on to the end of the response:

| The client reports | You see |
| --- | --- |
| A sequence violation (for example `TEXT_MESSAGE_CONTENT` before `TEXT_MESSAGE_START`) | A `sequence` finding on the run. |
| A frame it cannot parse as JSON | A `json` finding on the run, and the frame's own finding. |
| A frame that fails the event schema | A `schema` finding on the run, and the frame's own finding. |
| A connection or HTTP error | The exchange's status or transport error, and a message beside the composer. |

After the client rejects a stream, the run is over and a new message can be sent. The response is
still being recorded, so the exchange stays live and Stop stays available until the response ends or
you press it.

The observed outcome of a run (`success` with its result and pending tool calls, `interrupt`,
`cancelled`, `error`) is what a valid terminal event said. A stream that ends without one has the
outcome `unknown`.

## Replies

A finished run can wait for something. The inspector never answers for you.

### Interrupts

When a run ends with an `interrupt` outcome, every interrupt gets a card with its prompt, a JSON
editor for the answer and two buttons. Resolve sends the editor's content as the payload.
Cancel interrupt sends a cancellation with no payload. These are the protocol's `resolved` and
`cancelled` resume entries, built by the client library.

- The editor starts from the interrupt's response schema: a `default`, `const` or first `enum` value
  where the schema names one, otherwise the empty value of each declared type.
- Text that is not JSON cannot be sent, and Resolve is disabled until it is.
- An answer that misses the schema (a wrong type, a missing required field) shows a warning that says
  what the schema requires. It does not block Resolve: the protocol carries the schema opaquely, and
  sending a wrong answer on purpose is a fair way to test a server.
- An answer is final once given.

The next run starts when the last interrupt has an answer, and not before. Answering a subset sends
nothing, and not even the preparations run. The continuation carries all the answers in the order the
run reported the interrupts.

### Client tool calls

When a run finishes with client tool calls it did not get results for, each call gets a card showing
its name and arguments (parsed once complete, otherwise the text as streamed, with the parse error)
and an editor for the result. Submit result marks it answered. When every pending call has a
result, the next run starts and carries one tool message per call, with the text exactly as typed.
The transcript card for the call shows the result as entered by you.

### While something is waiting

- The message box, Send and the quick messages are disabled, and the notice says how many answers are
  missing. A surface action is refused the same way.
- If every answer is in but the continuation did not go out (a failed preparation, for instance), the
  cards show their answers and a button sends the continuation again. The answers are kept.
- New thread is the way out: it discards what was waiting.

### Surface actions

A rendered A2UI surface hands the runtime an action. It becomes a new run whose
`forwardedProps.a2uiAction.userAction` holds `name`, `surfaceId`, `sourceComponentId`, `context` and
`timestamp` exactly as the renderer gave them. The timestamp is the renderer's; the inspector does not
replace it. An action with a field missing is refused with a message. The run goes through the
preparations like any other, and adds no user message.

## Raw submissions

`runtime.sendRaw(text)` is what the raw request editor calls. The text must be valid JSON, otherwise
it is not sent and the error says so. Any valid JSON is sent exactly as typed, to the current target,
as its own exchange. There is no preset, profile, preparation or conversation update, and no schema
check beyond what the editor shows. The server's answer, an error answer included, is kept on the
exchange. An answer that streams is recorded until it ends or you press Stop.

## Wiring it into a page

The runtime holds the state; the views take it as props.

```ts
const runtime = createRuntime({ store, policy, settings: () => ({ profile, variables }) });
const state = useSyncExternalStore(runtime.subscribe, runtime.getState);
```

| Where | Call |
| --- | --- |
| Agent picker, top bar or Settings: select an agent | `runtime.selectAgent(agent)` |
| Connection: endpoint typed by the user | `runtime.setTarget(url)` |
| Connection: token | `runtime.setAuth({ headerName, token })`, or `undefined` to clear |
| Composer: Send, chips, Stop, New thread | `runtime.send(text)`, `runtime.stop()`, `runtime.newThread()` |
| Replies | `draftInterrupt`, `answerInterrupt`, `draftToolResult`, `submitToolResult`, `continueRun` |
| Surface | `runtime.sendA2uiAction(action)` |
| Raw editor | `runtime.sendRaw(text)` |
| Loading configuration and capabilities | `loadConfig(url, guardedFetchText(runtime.transport))` |

`policy` is the startup `TransportPolicy`: the mode, the page origin and the allowlist. It is fixed
when the page starts.

`ConnectionView` is the frozen entry export and shows the endpoint controls and the composer
together. An assembly that wants them in different places uses `TargetControls` for the top bar and
`Composer` under the transcript, and puts `RepliesView` below the transcript. It takes the same props
as `ConversationView`, so one props object serves both. The conversation view does not draw reply
controls itself.

Pass `threadId: state.threadId` to `ConversationView` and `StateView`. They then show that thread, so
New thread empties them straight away. Without it they show the thread of the latest conversation
exchange, which is what an imported recording needs.

The views import no stylesheet. The page loads `views/theme/index` and
`views/connection/connection.css`, as it does for the other views.

## Limits

- One run at a time. Starting another while one streams is refused with a message.
- Preparation responses are recorded but not read: nothing in a response feeds a later request.
- HTTP and SSE only. There is no reconnection or resume of a dropped stream.
- The inspector does not answer an interrupt, run a tool or retry on its own.
