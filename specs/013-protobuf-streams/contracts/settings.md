# Contract: choosing the encoding

Where the choice is made, how it is validated and what it changes. Code: `core/profiles`, `core/presets`,
`core/runtime`, `views/settings`.

## Client profile

```json
{
  "version": 0,
  "profile": {
    "protocolVersion": "1.0",
    "tools": [],
    "context": [],
    "renderA2ui": true,
    "injectA2uiTool": false,
    "encoding": "protobuf",
    "forwardedProps": {}
  }
}
```

- `encoding` is optional. It is written to a saved or exported profile only when set. Without it, the preset's default
  applies, and without that, `sse`.
- A value other than `"sse"` or `"protobuf"` is an error that names the field: `profile.encoding must be "sse" or
  "protobuf"`. The previous profile stays in use, as for any invalid profile.
- A 0.1.0 profile file imports unchanged.

## Preset

```json
{ "agents": [{ "id": "support", "url": "/agents/support", "preset": { "encoding": "protobuf" } }] }
```

- `preset.encoding` is optional and takes the same two values. Anything else is reported like any other invalid preset
  field (the agent's configuration problem, with the field named).
- The profile's value wins when it is set, as `messageMode` does for `messages`.

## What the choice changes

| Request | `ResponseKind` | Accept |
| --- | --- | --- |
| Conversation run, continuation, surface action | the encoding | the encoding's media type |
| Raw submission | the encoding | the encoding's media type |
| Preparation, configuration, capabilities | `response` | unchanged |

- The body of every request is unchanged. Raw submissions send the typed text as it is, and use only this one setting
  from the profile and the preset.
- A change applies to the next request. The thread, its messages and its state continue. Earlier exchanges keep their
  `encoding`.
- The token goes on the request through the guarded transport and nowhere else, as for any request.

## Settings view

An `Encoding` row in the client profile group, a segmented control labelled `Encoding` with `Preset default`,
`Server-sent events` and `Protobuf`. The hint shows the preset's default for the selected agent. Choosing `Preset
default` removes the field from the profile, as it does for the message mode.
