# Contract: `agui-inspector/testing`

A library entry of the npm package, `"./testing"` in `exports`, pointing at `lib/headless/index.js` and its
declarations. Node 24 or newer. Pre-stable, like the session file format. Types are in [data-model.md](../data-model.md).

## Opening and loading

```ts
openSession(options: SessionOptions): Promise<Session>
loadSession(file: string): Promise<ReadonlySession>
```

`SessionOptions`:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `target` | `string` | required | Absolute http or https URL, no credentials, query or fragment (feature 005 rules). Refused with the same messages. |
| `headers` | `Record<string, string>` | `{}` | Sent with every request to the target. Never stored, returned or printed. Names `Host`, `Content-Length`, `Transfer-Encoding`, `Connection` refused, as in feature 005. |
| `profile` | `ClientProfile` or a file path | default profile | Automatic replies, their limit, and the encoding (features 004 and 013). |
| `timeoutMs` | `number` | `60000` | Applies to every step. |
| `clock` | `{ now(): number; epoch(): number }` | real clock | For identical files across runs. |
| `ids` | `() => string` | `crypto.randomUUID` | For identical files across runs. |

`loadSession` reads a version-0 session file with the page's import checks and returns a session that has the read
methods only. A file that fails a check rejects with the page's `Import failed:` message.

## Steps

Each step resolves with a `Step` when the session is idle or the time limit passed. A step never rejects because of
what the target sent; it rejects only for a wrong argument (unknown interrupt id, closed session).

```ts
session.send(text: string): Promise<Step>
session.sendRaw(json: string): Promise<Step>            // sent unchanged, valid or not
session.answerInterrupt(id: string, status: 'resolved' | 'cancelled', payload?: JsonValue): Promise<Step>
session.submitToolResult(toolCallId: string, result: string): Promise<Step>
session.a2ui.set(surfaceId: string, path: string, value: JsonValue): void   // data model only, no request
session.a2ui.fire(surfaceId: string, componentId: string): Promise<Step>     // the component's action, as the renderer builds it
session.stop(): void
session.close(): void                                     // stops capture, forgets headers
```

When several interrupts or tool calls are pending, the continuation is sent after the last answer, as in the page; the
earlier calls resolve with `Step.waitingFor` listing what is still unanswered.

## Reads

All reads return copies; mutating them changes nothing.

```ts
session.frames(): readonly RawFrame[]                 // exactly as recorded, arrival order
session.exchanges(): readonly Exchange[]
session.findings(): readonly Finding[]
session.conversation(): ConversationModel             // the page's projection: messages, tool calls, interrupts, activities, subagents
session.state(): JsonValue | undefined
session.pending(): Pending
session.surfaces(): readonly SurfaceView[]            // A2UI v0.9 only
session.save(file: string, options?: { overwrite?: boolean }): Promise<void>  // refuses an existing file unless overwrite
session.toJSON(): SessionEnvelope                     // the session file as an object
```

## Assertions

Plain functions. Each throws `AssertionError` from `node:assert` with `expected` and `actual` set, so every test runner
reports it. Patterns are strings (exact) or regular expressions.

```ts
assertMessage(session, { role?: 'assistant' | 'user' | 'tool' | 'system', text?: string | RegExp })
assertNoMessage(session, { role?, text? })
assertPendingInterrupt(session, { reason?: string | RegExp })
assertPendingToolCall(session, { name: string | RegExp })
assertFinding(session, ruleId: string)
assertNoFinding(session, ruleId?: string)              // no ruleId: no finding at all
assertSurface(session, { surfaceId?: string, component: { type: string, props?: Record<string, JsonValue | RegExp> } })
assertState(session, partial: JsonValue)              // deep partial match
```

On failure, when the environment variable `AGUI_INSPECTOR_SAVE_ON_FAILURE` names a directory, the session file is saved
there under a name built from the assertion and a counter, and the message gives the path.

## Guarantees

- Frames and findings equal what the page records for the same run (FR-009).
- No header value reaches a frame, an exchange, a finding, a file, an error message or a log.
- The library opens no listening socket and requests only `target`.
