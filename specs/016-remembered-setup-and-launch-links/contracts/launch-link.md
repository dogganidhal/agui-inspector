# Contract: launch link, version 0

A launch link is the inspector page's URL with launch values in the fragment. This is the format spec 018 and any
other link builder writes. A version-0 link keeps opening the same way in later releases.

## Shape

```text
<page URL>#<key>=<value>&<key>=<value>...
```

- The page URL is wherever the inspector is served: the hosted page, a helper's mount path (`/inspector/`), the
  command's `http://127.0.0.1:<port>/`, or the public demo.
- Keys and values are percent-encoded as `application/x-www-form-urlencoded`, which `URLSearchParams` writes. A space
  may be `+` or `%20`.
- Every key is optional. Order does not matter. A key may appear once.

## Keys

| Key | Value | Effect |
| --- | --- | --- |
| `v` | `0` | Format version. Absent means 0. Another value ignores the whole link with one warning. |
| `agent` | agent id | Selects that configured agent. |
| `endpoint` | URL or path | Uses this endpoint as if typed and applied. Same policy as a typed endpoint. |
| `var.<name>` | text | Sets preset variable `<name>` of the selected agent. A `json` variable reads the text as JSON. |
| `context` | JSON list of `{ "description", "value" }` | Replaces the profile's context. |
| `forwardedProps` | JSON object | Replaces the profile's forwarded properties. `a2uiAction` is reserved. |
| `message` | text | Fills the composer. Never sent by the page itself. |

## Refusals

Each one is a "Link" warning that names the key and never its value. The rest of the link applies.

- An unknown key, a repeated key, `agent` together with `endpoint`.
- A credential key: `token`, `auth`, `authorization`, `header`, `headers`, or one that starts with `header.`.
- An `agent` that is not configured, an `endpoint` the policy refuses or with a user name or password.
- A `var.<name>` the selected agent does not declare, or any `var.*` with an endpoint.
- JSON that does not parse, or that fails the profile's checks.
- A fragment over 65,536 characters ignores the whole link with one warning.

## Guarantees

- The page sends nothing because of a link. The developer presses send.
- A link never widens the request policy, never names the configuration file and never loads code.
- Values the link applies are saved as hand edits are. The message is not saved.
- After start the fragment is removed from the address bar. A new fragment in the same tab restarts the page.

## Example

The reference agent's `support` agent, served by the command on port 4100:

```text
http://127.0.0.1:4100/#agent=support&var.userId=42&context=%5B%7B%22description%22%3A%22locale%22%2C%22value%22%3A%22fr-FR%22%7D%5D&forwardedProps=%7B%22tenant%22%3A%22acme%22%7D&message=Book+a+table+for+two
```

Built with the platform:

```js
const params = new URLSearchParams({
  agent: 'support',
  'var.userId': '42',
  context: JSON.stringify([{ description: 'locale', value: 'fr-FR' }]),
  forwardedProps: JSON.stringify({ tenant: 'acme' }),
  message: 'Book a table for two',
});
const link = `http://127.0.0.1:4100/#${params}`;
```
