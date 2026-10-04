# Contract: the listener and the proxy

What the listener answers and what it relays. Everything here is checked by a test.

## Address

The listener binds `127.0.0.1` on the chosen port and opens no other listener. It has no option for another address.

## Routes (listener at `http://127.0.0.1:4747`)

| Request | Response |
| --- | --- |
| `GET /` | The page (`index.html`), from the core. |
| `GET /<packaged file>` | The file, from the core. Includes `hosting-config.json`. |
| `GET /config.json` | The configuration of the data model, from the core. |
| other path that is not a proxy path | 404 from the core. |
| other method than GET and HEAD on those | 405 with `Allow: GET, HEAD`. |
| `<any method but CONNECT> /proxy/<n>/<rest>?<query>` | The relay to target `n`. |
| `/proxy/<n>` | The relay with path `/`. |
| `/proxy/<other>/...` | 403, no outbound connection. |

Every response of the core carries `Content-Security-Policy: script-src 'self'; object-src 'none'; base-uri 'none'`.
Responses the relay writes itself (403, 502) are plain text.

## Refusals (403, no outbound connection)

| Request | Why |
| --- | --- |
| Request target that is not an absolute path (`GET http://other.example/`, `OPTIONS *`) | The proxy never takes a destination from the request line. |
| `Host` other than `127.0.0.1:<port>` or `localhost:<port>`, on any path | DNS rebinding. |
| Proxy path with an `Origin` other than `http://127.0.0.1:<port>` or `http://localhost:<port>` | A page on another origin. |
| Proxy path with `Sec-Fetch-Site` other than `same-origin` or `none` | A cross-site or same-site request from a browser. |
| Proxy path whose number names no target, or is written with a sign, a leading zero or an encoding | Not one of the configured targets. |

`CONNECT` and upgrade requests are refused with 403 by explicit `connect` and `upgrade` listeners, which end the socket
after the reply. (Without an `upgrade` listener, Node serves an upgrade request as an ordinary request.) The target sees
nothing.

## What the relay sends to the target

| Part | Rule |
| --- | --- |
| Connection | `host` and `port` of target `n` (scheme `https` means TLS with Node's default checks). Never taken from the path. One connection per request. |
| Method, path, query | The request's method, then `/<rest>?<query>` as received. Nothing is decoded, normalized or resolved. |
| Body | The request body, streamed unchanged. |
| Headers | The page's headers, without hop-by-hop headers (`Connection`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`, and any name `Connection` lists) and without `Host`, `Cookie`, `Origin` and `Referer`. `Host` is the target's own. |
| Held headers | Each held header of target `n` whose name the page's request did not already carry. |

## What the relay sends back to the page

| Part | Rule |
| --- | --- |
| Status | The target's status code and message. |
| Headers | The target's headers in their order and case, without hop-by-hop headers and without `Set-Cookie`. Nothing is rewritten, `Location` included. A redirect is not followed. |
| Body | The target's response body, streamed unchanged, as it arrives. Not decoded, not decompressed. |
| Cut stream | If the target's connection fails after the headers, the page's connection is destroyed, so the page sees a failed stream. |
| Page abort | If the page closes or aborts its request, the connection to the target is destroyed. |

## When the target cannot be reached

Before the target answers (no connection, name not found, certificate not trusted, connection closed early), the page gets:

```text
HTTP/1.1 502 Bad Gateway
content-type: text/plain; charset=utf-8

agui-inspector could not reach http://127.0.0.1:8787 (ECONNREFUSED)
```

The body names the target's origin and Node's error code. The command logs the same text with the `agui-inspector:` prefix on
standard error. A request that fails Node's own path checks gets 400.

## Guarantees the tests check

1. The only hosts the command connects to are the origins of the targets given on the command line.
2. No bytes of a request or response body are added, removed, decoded or reordered.
3. A chunk the target writes reaches the page before the target writes the next one, when they are written at least
   100 ms apart.
4. A header value from the command line is sent only to its target and is in no response of the command, no served file
   and no output.
5. The command opens no connection of its own besides the relays.
