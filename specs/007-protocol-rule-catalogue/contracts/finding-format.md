# Contract: findings and the session file

What changes in the shared types and in the version 0 session file. Nothing else in `contracts.ts` changes.

## Types

```ts
export type FindingKind =
  | 'json' | 'schema' | 'sequence' | 'terminal' | 'transport' | 'capture' | 'projection'
  | 'compat' | 'capability';            // new

/** `<family>.<problem>`. Grammar and catalogue: contracts/rule-catalogue.md. */
export type RuleId = string;

export interface Finding {
  readonly id: FindingId;
  readonly kind: FindingKind;
  readonly rule?: RuleId;               // new. Absent only in findings read from a 0.1.0 file.
  readonly message: string;
  readonly subject: FindingSubject;
}
```

Code that creates a finding takes a `CatalogueRuleId`, the union of the ids in `RULES`, so every finding the inspector
creates has a rule that the catalogue knows. `Finding.rule` stays a plain `string` so that a file from a newer version,
with a rule this version does not know, can be read.

`kind` always equals the family of `rule`. `projection` has no rule.

`FrameReaderOptions` gains `declared?: () => AgentCapabilities | undefined`. `Runtime` gains
`setDeclaredCapabilities(capabilities: AgentCapabilities | undefined): void`. `LoadedCapabilities` gains
`declared: AgentCapabilities`. `Finding` in `views/theme/primitives.tsx` gains `rule?: string`.

## Store

`addFinding` checks, before changing anything, in this order: the id is new, the subject exists, and, when `rule` is
present, `checkRuleId(kind, rule)` returns nothing. A failing call throws, and the caller reports it as a capture
finding, as for the other store checks.

`checkRuleId(kind, rule)` returns a text when `rule` does not match the grammar, or when its family is not `kind`.

## Session file

A finding in `session.findings`:

```json
{
  "id": "exchange-1:frame-3:finding-2",
  "kind": "capability",
  "rule": "capability.reasoning-unsupported",
  "message": "REASONING_START came from an agent that declares reasoning.supported: false",
  "subject": { "type": "frame", "id": "exchange-1:frame-3" }
}
```

| Case | Import result |
| --- | --- |
| No `rule` (a 0.1.0 file) | Accepted. The finding has no rule. |
| `rule` well formed, family equals `kind`, known to the catalogue | Accepted. |
| `rule` well formed, family equals `kind`, unknown to the catalogue | Accepted, shown as it is. |
| `rule` not well formed | Rejected: `findings[n]: rule must be <family>.<problem>`. |
| `rule` family differs from `kind` | Rejected: `findings[n]: rule family must match kind`. |
| `kind` is `compat` or `capability` | Accepted. |
| Any other unknown field | Rejected, as in 0.1.0. |

Export writes `rule` for every finding that has one, and the key order `id`, `kind`, `rule`, `message`, `subject`.
The format version stays 0. A 0.1.0 reader rejects a file with a `rule` field or a `compat` or `capability` kind, so
files from this version are not promised to open in 0.1.0.

## Finding ids

| Source | Id |
| --- | --- |
| Frame reader, first finding of a frame | `<frame id>:finding` |
| Frame reader, later findings of the same frame | `<frame id>:finding-2`, `<frame id>:finding-3` |
| Frame reader, missing terminal event | `<exchange id>:terminal` |
| Runtime, finding on a run | `<run record id>:finding-<n>` |
| Recorder, finding on an exchange | `finding-<n>` |

Ids are opaque. Nothing reads meaning out of them.

## Messages

A message names the event type, the field path or the capability path, and the kind of problem. It never repeats a
received value, as in 0.1.0. The sequence message keeps the client's own text, clipped to 300 characters.

| Rule family | Message form |
| --- | --- |
| `compat.retired-event-type` | `THINKING_START is a retired event type. The protocol client reads it as REASONING_START.` |
| `compat.null-optional-field` | `RUN_FINISHED.result is null. The protocol client reads it as absent.` With several fields, the paths are listed. |
| `compat.legacy-binary-content` | `MESSAGES_SNAPSHOT.messages[0].content[1] is a binary content part. The protocol client converts it to a media part.` |
| `compat.protocol-version-newer` | `RUN_STARTED declares a protocol version newer than 1.0, which is the version the protocol client speaks.` |
| `compat.protocol-version-unreadable` | `RUN_STARTED declares a protocol version that is not written as major.minor.` |
| `capability.*` | `REASONING_START came from an agent that declares reasoning.supported: false` |

A test checks that these messages repeat no received value. The sequence message is the exception that 0.1.0 already
had: it keeps the client's own words, which can name an id.
