# Data model: JavaScript server helpers

The helpers keep no stored data. They hold the arguments of one call, build one configuration text from them and serve
files that already exist. This page lists the shapes and the rules that tests check.

## Helper arguments

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `agents` | list of agent entries | yes | Each entry has a nonempty `id` that no other entry has, and a nonempty `url`. |
| `enabled` | boolean | no, default `false` | Only `true` mounts. Any other value, a string included, is a disabled helper. |
| `path` | string | no, default `/agui-inspector` | Starts with `/` and is not `/` alone. Trailing `/` is dropped. Express and Hono only. |
| `theme` | `{ light?, dark? }` | no | Each map goes from a `--agui-*` name to a CSS value. Passed through unchecked. |
| `brand` | `{ name?, logo?, logoDark? }` | no | The adopter's name and logos, added by issue #73 to the Python helper as `Brand`. Passed through unchecked. The helper serves no logo file. |
| `assetsDir` | string | no, internal | The directory with the built page. Default `staticAssetsPath`. Not in the declarations. |

Checks run only when `enabled` is `true`, in this order: `path`, then `agents`, then that the page exists in the files
directory. Each failure throws an `Error` that names the problem, and nothing is mounted. A disabled call checks and
reads nothing.

## Agent entry

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | yes |
| `url` | string | yes |
| `name` | string | no |
| `capabilities` | object or string | no |
| `preset` | object | no |

The page validates `capabilities` and `preset`. The helper copies what it gets.

## Inspector configuration (`config.json`)

The version 0 format of the configuration file, with no new field:

```json
{ "version": 0, "agents": [ { "id": "support", "url": "/agents/support/stream" } ], "theme": { "light": { "--agui-accent": "#2563eb" } }, "brand": { "name": "Acme Console" } }
```

It is built once, when the handler is created, with `JSON.stringify`. A field with the value `undefined` is left out,
which gives the same file as the Python helper (a `None` field is left out too). `theme` and `brand` are present only when
given, and `brand: {}` is written as an empty object, as `Brand()` is. The key order is `version`, `agents`, `theme`,
`brand`.

## Mount

| Field | Meaning |
| --- | --- |
| `mount` | The normalized path (`path` without trailing `/`). |
| `handle` | The core handler for this configuration. |

`resolveMount` returns `null` for a disabled helper. There is no other state, except one flag in the Next.js helper:
`warned`, false until the first request, which logs the warning and sets it. It lives in the closure of one
`inspectorRoute` call.

## Response rules

| Request | Response |
| --- | --- |
| method other than `GET` and `HEAD` | 405, `Allow: GET, HEAD` |
| bare mount path | 307, `Location: <last segment>/index.html<query>` |
| `asset` is `''` and the path ends in `/` | the page (`index.html`) |
| `config.json` | the configuration text, `application/json` |
| a packaged file | its bytes, with a content type by extension |
| anything else, any unsafe `asset` | 404, `text/plain` |

Every row carries `Content-Security-Policy: script-src 'self'; object-src 'none'; base-uri 'none'`. `HEAD` gets the
headers of `GET`, including `Content-Length`, and no body. An `asset` is unsafe when a segment is empty, `.` or `..`, or
contains `\` or a null character. The resolved file must also lie inside the files directory. A directory is not found.
Content types: `html`, `js`, `css` and `json`, which is what the page is made of; any other extension is
`application/octet-stream`.
