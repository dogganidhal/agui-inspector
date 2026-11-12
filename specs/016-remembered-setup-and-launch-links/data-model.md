# Data model: Remembered setup and launch links

## Remembered setup (browser storage)

Key: `agui-inspector.setup`. Value: JSON text.

```json
{ "version": 0, "setup": { "agent": "support", "variables": { "user_id": "42" } } }
```

| Field | Type | Rule |
| --- | --- | --- |
| `version` | `0` | Any other value: not used, one Configuration warning. |
| `setup.agent` | string | A configured agent id. Exclusive with `endpoint`. |
| `setup.endpoint` | string | An endpoint the developer applied, as typed. Must pass `resolveTarget` with the current policy. |
| `setup.variables` | object | Only with `agent`. Name to JSON value. A text variable's value must be a string. |

Unknown fields make the envelope unusable (strict, like the profile). Nothing else is stored: no token, header,
thread id, conversation, draft or view state.

Written when the developer selects an agent (`{ agent }`), applies an endpoint that the runtime accepts
(`{ endpoint }`), edits a variable (`{ agent, variables }`), and once at start when a link changed any of these.

## Launch values (from the fragment)

| Key | Value | Becomes |
| --- | --- | --- |
| `v` | `0` | Format version. Absent means 0. |
| `agent` | text | The selected agent, by id. |
| `endpoint` | text | The target, as if typed. No agent. |
| `var.<name>` | text | The value of preset variable `<name>`. A `json` variable parses the text as JSON. |
| `context` | JSON list | The profile's `context`, replaced as a whole. |
| `forwardedProps` | JSON object | The profile's `forwardedProps`, replaced as a whole. |
| `message` | text | The composer's starting text. Never stored. |

Refused keys (warning, value dropped and never shown): any other key, a repeated key, `agent` with `endpoint`, and the
credential names `token`, `auth`, `authorization`, `header`, `headers`, `header.*`.

## Resolution

```text
selection  = link.agent | link.endpoint | saved.agent | saved.endpoint | first configured agent | none
variables  = link var.* over (saved.variables if selection is saved.agent, else {}); undeclared names dropped
profile    = saved profile with link context and forwardedProps replacing their fields
message    = link.message
```

Each step that drops a value adds one warning naming the key or variable. Values that survive are saved
(selection and variables to the setup, context and forwarded properties to the profile).

## Started (startup result)

`Started` gains `launch?: { message?: string; keys: string[]; warnings: string[] }`, present when the page was opened
with a fragment. `selectedAgentId` becomes the resolved agent. Saved-setup warnings join `warnings`.
