# Contract: declaring plugins

The `plugins` field, the helper arguments, the command option and how the page reads them. Format version stays 0.

## `config.json`

```json
{
  "version": 0,
  "agents": [{ "id": "support", "url": "/agent" }],
  "plugins": ["plugins/sign-requests.js", "/static/plugins/citations.js"]
}
```

| Rule | Value |
| --- | --- |
| Field | `plugins`, optional. A list of strings. Absent is the same as before. `[]` is valid and changes nothing. |
| Entry | A nonempty string. A path relative to the page, an absolute path, or a full URL on the page's own origin. A query or a fragment is allowed. |
| Resolved against | The page's own location (`baseUrl`), never the location of the configuration file. |
| Rejected before any request | Another origin, a scheme-relative address, any scheme other than `http` and `https` (`data:`, `blob:`, `file:`, `javascript:`), credentials in the URL, a backslash or a control character, a value that is not a string. |
| A bad entry | One "Configuration" warning (`plugins[<i>] ...`). The entry is dropped. Every other entry, the agents, the presets, the theme and the brand still apply. |
| Not a list | One warning. The field is ignored. |
| Repeated address | The later entry is dropped with a warning. |
| Order | Plugins are activated in the order written, which is also the order of their hooks and providers. |
| Compatibility | A file with `plugins` is read by 0.2.0 and later. Before 0.2.0 an unknown field was an error. |

The file that `hosting-config.json` names in `config` carries `plugins` in its place, as it carries `theme` and `brand`.
`hosting-config.json` is not read for plugins and is not changed.

## When the page loads them

```text
hosting-config.json -> policy and CSP -> runtime -> config.json -> profile -> plugins -> first render
```

Plugins load after the configuration, so the page knows the origin and the policy first, and before the first render, so
that no run can be sent before a hook exists. The page requests nothing for a plugin that was rejected.

## Python

```python
mount_inspector(app, agents=[...], enabled=True, plugins=["/static/plugins/sign.js"])
```

- `plugins: list[str] | None = None`. Written into `config.json` as given. Not set: the key is left out, and the file is
  byte for byte the one served before this feature.
- The helper does not check the values and does not serve a module. The host serves the file from one of its own routes
  (`StaticFiles` on Starlette and FastAPI), as it serves a logo.

## JavaScript helpers

```js
mountInspector(app, { agents: [...], enabled: true, plugins: ['/static/plugins/sign.js'] }); // Express and Hono
export const GET = inspectorRoute({ agents: [...], enabled: true, plugins: ['/static/plugins/sign.js'] }); // Next.js
```

- `InspectorOptions.plugins?: readonly string[]`. Written after `brand` in the `JSON.stringify` call that builds
  `config.json`, so an unset option leaves the bytes unchanged.
- No check, no route, no file served.

## Static assets and hosted deployments

The deployer puts the module on the page's own origin and lists it in the `config.json` beside the page. For a hosted
deployment, `allowedOrigins` and `allowVisitorTargets` do not change where a plugin may load from.

## The command (feature 005, when it has merged)

```text
agui-inspector --target <url> --plugin ./sign.js [--plugin ./other.js]
```

- `--plugin <file>`, repeatable. Without a value it is a usage error, as for the other options.
- At start, each file must exist and be a file that can be read. If not, the command stops before it listens, with exit
  code 2 and a message that names `--plugin`.
- The command serves the file at `/plugins/<n>.js` (`n` from 1, in the order given) for GET and HEAD, with a JavaScript
  content type and the same content security policy as its other files. It reads the file when the request arrives, so an
  edit shows after a reload. No other path serves a local file.
- The `config.json` it serves gains `"plugins": ["/plugins/1.js", ...]` and nothing else new.
- A header from a provider travels like any header from the page: the relay forwards it, and where the command line
  also set a header of that name, the page's value wins (feature 005).
- If feature 005 has not merged when this feature is implemented, this part moves to the next minor and nothing else
  changes.

## What nothing declares

A profile, a session file, the query string, a typed endpoint and the settings view cannot name a plugin. There is no
option to disable a plugin in the page. Removing a plugin means removing it from the configuration and reloading.
