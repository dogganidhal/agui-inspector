# Data model: Protocol rule catalogue

No new stored entity and no new file. The session file keeps format version 0 and gains one optional field. The
types are in [contracts/finding-format.md](contracts/finding-format.md) and the rules in
[contracts/rule-catalogue.md](contracts/rule-catalogue.md).

## Rule

A row of the catalogue. It exists in code only and is never stored in a session.

| Field | Type | Rule |
| --- | --- | --- |
| id | `CatalogueRuleId` | Matches the id grammar. Unique. Never renamed, reused or removed. |
| family | one of the eight families | The part of the id before the dot. Equals the `kind` of every finding of the rule. |
| summary | string | The short description. May be reworded when the meaning stays. |

The catalogue has 39 rows. There is no `withdrawn` marker yet (clarification 5).

## Finding

An existing entity with one new field and two new kinds.

| Field | Type | Rule |
| --- | --- | --- |
| id | string | Unique in the session. Opaque. |
| kind | `FindingKind` | Gains `compat` and `capability`. Equals the family of `rule`. |
| rule | `RuleId` (string), optional | New. Present on every finding created by this version. Absent only on findings read from a 0.1.0 file. Checked by `checkRuleId` in the store and the importer. |
| message | string | Names fields and kinds of problem, never received values. |
| subject | frame, run or exchange | Must exist when the finding is added. |

A frame can have several findings. Order within a frame: JSON, then schema, then compat, then capability.

There is one finding for each rule that a frame breaks, except `schema.*`, which is at most one per frame, and
`sequence.*`, which is at most one per run.

## Declared capabilities

`AgentCapabilities` from `@ag-ui/core`, unchanged. It is the selected agent's `capabilities` object, or the object that
`loadCapabilities` parsed from its URL. It is held by the runtime in memory, set by the app, cleared when the target
changes, and read once by the frame reader when an exchange's stream starts. It is never stored, exported or sent.

| State | Capability findings |
| --- | --- |
| None declared, no agent, URL not loaded, URL failed | None |
| Flag omitted | None |
| Flag `true` | None |
| Flag `false` | One per contradicting frame, per rule |

## Compat upgrade

A pure function result, never stored: `{ value, applied }`. `value` is a copy of the parsed frame with the client's
upgrades. `applied` is a list of `{ rule, paths }`: the compat rule and the field paths or types it upgraded. When
nothing applies, `value` is the same object as the input and `applied` is empty. The frame record keeps the parsed value
as received.

## Transitions

None. Findings are added once and never change. The declared capabilities change when the agent or its loaded URL
change, and a stream in progress keeps what it read at its start.
