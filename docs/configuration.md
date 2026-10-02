# Configuration, presets and client profiles

`agui-inspector` is a working name. This page describes the version-0 formats the inspector reads
and writes for agent configuration, presets and the client profile. All three are pre-stable: they
may change before 1.0.0, and every change that breaks an existing file is recorded under
[Migrations](#migrations). Version 1 and its published JSON Schemas wait for the stable release.

The code lives in `packages/inspector/src/core/config`, `core/presets` and `core/profiles`. These
modules are plain TypeScript with no React and no network access of their own.

## Configuration file

A configuration is JSON that lists agents. The embedded bundle reads `config.json` next to the page;
hosted mode reads a file or a permitted URL. A file without a `version` is the historical form and
reads as version 0. Any other version is rejected with an error that names it.

```json
{
  "version": 0,
  "agents": [
    {
      "id": "support",
      "name": "Support assistant",
      "url": "/agents/support/stream",
      "capabilities": "/agents/support/capabilities",
      "preset": {
        "variables": {
          "userId": { "default": "dev-{{uuid}}" },
          "seed": { "default": { "plan": "free" }, "type": "json" }
        },
        "forwardedProps": { "user_id": "{{userId}}", "seed": "{{seed}}" },
        "messages": "turn",
        "prepare": [
          {
            "method": "PUT",
            "path": "/agents/support/sessions/{{threadId}}",
            "body": { "user_id": "{{userId}}", "context": "{{seed}}" }
          }
        ],
        "quickMessages": ["/help"]
      }
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `agents[].id` | Required, nonempty, unique in the file. |
| `agents[].url` | Required. Relative to the page origin when embedded, absolute `http(s)` when hosted. No `user:password@`. |
| `agents[].name` | Optional string. |
| `agents[].capabilities` | Optional. Either an inline object with up to eleven groups, or a URL that returns one. |
| `agents[].preset` | Optional. See below. |

Unknown fields are errors. A field that could carry a credential (`headers`, `token`,
`authorization`, `auth`, `apiKey`, `cookie` and similar) gets a message saying credentials never live
in configuration. The inspector cannot see what you put inside a request body or a forwarded
property, so keep secrets out of those as well.

The loader does not fetch anything itself. `loadConfig` and `loadCapabilities` take a `fetchText`
callback, which the guarded transport supplies, so every request follows the startup allowlist. A
configuration never adds an allowed origin and the inspector never requests a route the file did not
name.

### Declared capabilities

The inspector shows an agent's capabilities in the eleven documented groups: `identity`,
`transport`, `tools`, `output`, `state`, `multiAgent`, `reasoning`, `multimodal`, `execution`,
`humanInTheLoop` and `custom`. A group the agent leaves out is shown as "Not declared". An inline
declaration needs no request; a URL is fetched once, through the callback. The shape is checked
against the protocol's `AgentCapabilitiesSchema`. The inspector does not discover capabilities and
does not compare them with observed events in 0.1.0.

## Presets

A preset holds what an application needs around a run. The core carries no server-specific routes or
message conventions; everything specific comes from here.

### Variables

`variables` maps a name to a `default` and a `type` of `text` (the default) or `json`. A text default
must be a string. Names use letters, digits and underscores and cannot start with a digit. `threadId`,
`runId` and `uuid` are built in and cannot be redefined.

- `threadId` and `runId` come from the runtime for the run being sent.
- `uuid` is generated with Web Crypto once per dispatch attempt and reused by every variable value,
  preparation request and forwarded property of that attempt. The next attempt gets a new one.
- A variable's own value may use the built-ins, as in `"dev-{{uuid}}"`. It cannot refer to another
  variable.
- The user can edit a variable in the settings. A JSON variable is edited as JSON; text that does not
  parse is shown as an error and the last valid value stays in use.

### Templates

`{{name}}` is replaced in string values of `forwardedProps`, preparation `path` and preparation
`body`. Keys are never templated and nothing is evaluated.

| Where the placeholder sits | Result |
| --- | --- |
| The whole string, `"{{seed}}"` | The variable's own JSON value. An object stays an object, a number stays a number. |
| Inside a longer string, text variable | The text as written. |
| Inside a longer string, JSON variable | The value serialized as JSON, so a string gains quotes. |

A placeholder that names no variable, or that is not a valid name, fails the dispatch with a message
that gives the name and where it was used, for example `prepare[0].body.x[0]: undefined variable
"ghost"`. The inspector never substitutes an empty string. Naming a variable the preset does not
declare in the user's values is an error as well.

### Forwarded properties and message mode

`forwardedProps` are merged into every conversation run, including continuations. `a2uiAction` is
reserved and cannot be set here.

`messages` is `full` (the default) or `turn`. `full` sends the whole transcript. `turn` sends only
what the turn adds: the new user message, the tool results, or nothing for a resume.

### Preparation requests

`prepare` is an ordered list of `{ method, path, body? }`. The runtime sends them in this order
before every conversation run and continuation, and records each as an exchange. A failed
preparation fails the run and the agent request is not sent. `preparePreset` returns the resolved
list; the runtime sends it (task T026).

### Quick messages

`quickMessages` is a list of strings the composer offers as one-click messages. They follow the
ordinary send path.

## Client profile

The profile is what the inspector declares and sends. It has seven settings and no others.

| Setting | Effect on the next run input |
| --- | --- |
| `protocolVersion` | Sent as `protocolVersion`. Must be nonempty. |
| `tools` | Sent as `tools`. Each tool needs a `name` and a `description`; `parameters` is its JSON Schema. Names are unique. |
| `context` | Sent as `context`. Each entry has a `description` and a string `value`. |
| `renderA2ui` | None. It chooses whether surfaces render or stay as JSON in the views. |
| `injectA2uiTool` | Adds the official `render_a2ui` tool from `@ag-ui/a2ui-middleware` to `tools`. A profile tool with the same name is replaced, so the name never appears twice. |
| `messageMode` | `full` or `turn`. When set, it overrides the preset's mode. When absent, the preset decides. |
| `forwardedProps` | Merged over the preset's properties; the profile wins for a name both define. `a2uiAction` is reserved. |

`composeRunInput` builds the input from the profile, the resolved preset and what the runtime hands
it: thread and run ids, the transcript and this turn's messages, the current state, the parent run,
resume answers and an A2UI action. The result is checked against the protocol's `RunAgentInput`
schema. An input that fails the check comes back as an error to show; it is not sent and it is not
repaired. This applies to ordinary runs only. The raw request editor sends what you typed.

An A2UI action travels as `forwardedProps.a2uiAction.userAction` with `name`, `surfaceId`,
`sourceComponentId`, `context` and `timestamp`, set after all other properties.

### Profile file and browser storage

The same envelope is exported as a file and kept in browser storage under the key
`agui-inspector.profile`:

```json
{
  "version": 0,
  "profile": {
    "protocolVersion": "1.0",
    "tools": [],
    "context": [],
    "renderA2ui": true,
    "injectA2uiTool": false,
    "messageMode": "turn",
    "forwardedProps": {}
  }
}
```

`messageMode` is omitted when the profile defers to the preset. The version must be exactly 0; a
missing or different version is an error. Import and load check the whole file. A bad file shows its
error and leaves the current profile as it was. A saved profile that cannot be read is reported and
the defaults stay in use.

## Credentials

Authentication credentials stay in memory. The token and its header name belong to the connection
state, which no profile, configuration or export type refers to. The profile has no field for
either; a field that looks like one is rejected on import, and export copies only the seven settings
even when handed an object with more. The token reaches the guarded transport and nothing else.

Keep secrets out of `forwardedProps`, `context` and tool schemas too: those values are saved in the
browser and written to exported profiles as you typed them.

## Wiring

The settings view takes its data and callbacks as props (`SettingsViewProps`) and holds no state that
matters. The host that assembles the page supplies:

- `agents` from `parseConfig` or `loadConfig`, and `selectedAgentId`.
- `profile` from `loadProfile`, saved with `saveProfile` on every `onChangeProfile`.
- `variables`, the values the user edited, passed to `preparePreset` as overrides.
- `onImportProfile`, which calls `importProfile` and shows `error` when it fails.
- `onExportProfile`, which downloads `exportProfile(profile)`.
- Optionally `capabilities`, the loaded state of a capabilities URL.

The view imports no stylesheet. The page loads `views/theme/index` and
`views/settings/settings.css` itself, so that building the app does not emit an extra asset until
the app assembly decides how to ship it.

## Migrations

No format has changed since version 0 was introduced, so there is nothing to migrate. A later change
that breaks an existing file will be listed here with the steps to update it. Until 1.0.0 such a
change may keep the version number; the entry is the record.
