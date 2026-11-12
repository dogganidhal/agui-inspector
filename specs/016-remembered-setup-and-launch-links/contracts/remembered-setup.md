# Contract: remembered setup, version 0

Browser storage key `agui-inspector.setup`, next to `agui-inspector.profile` and `agui-inspector.theme`. It is internal
to the page: no file imports or exports it, and other tools should not write it. It is documented so a developer knows
what the page keeps.

```json
{ "version": 0, "setup": { "agent": "support", "variables": { "userId": "42" } } }
```

or

```json
{ "version": 0, "setup": { "endpoint": "https://agent.example/run" } }
```

- `agent` and `endpoint` are exclusive. `variables` only goes with `agent`.
- No other field is read or written. In particular there is never a token, a header, a thread id, a message or a
  recording.
- Reading or writing never throws. Blocked or full storage means the setup is not remembered.
- A value that no longer fits (agent removed, endpoint now refused, variable undeclared or of the wrong kind) is dropped
  at start with one Configuration warning; the rest applies.
- To forget it, clear the site's data in the browser. The docs page says so.
