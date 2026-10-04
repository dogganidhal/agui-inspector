# Quickstart: validate the command line inspector

Run from the repository root. Node.js 24 or newer. Nothing here publishes or releases anything. The steps assume
feature 006 (the shared serving core) is on the branch.

## 1. Install and build

```sh
npm ci --ignore-scripts
npm run build
```

`npm run build` writes `packages/inspector/dist` (the page) and `packages/inspector/lib` (the Node code, `lib/cli` included).
It fails when the `bin` target is missing from `lib`.

## 2. Unit tests

```sh
npm run typecheck
npm run test:unit -- packages/inspector/tests/cli
```

They use a stand-in directory for the page, so they run without step 1. They cover the options and their messages, the
relay (bytes, chunk timing, headers, cookies, errors, aborts), the guards, the refused request spellings, the routes, the
bound address and the exit codes of `run()`.

## 3. Shipped command and browser tests

```sh
npm run test:e2e -- tests/e2e/cli --workers=2
```

`command.spec.ts` runs `lib/cli/main.js` as a child process: `--help`, `--version`, each error with its exit code, a port in
use, `SIGTERM`, the loopback bind, an HTTPS target (with `openssl`), and a search for a unique header value in every
output, served file and response. `browser.spec.ts` opens the printed address in Chromium, sees the agent, runs the scripted
reference agent through the command, exports the session and checks that no request left the page's own origin.

## 4. By hand

Start the reference agent. It sends no CORS header, so the hosted page could not reach it:

```sh
node examples/reference-agent/server.ts --port 8787
```

In a second terminal, start the command against it, with a header:

```sh
node packages/inspector/lib/cli/main.js --target http://127.0.0.1:8787/agent --header "X-Api-Key: demo-123"
```

It prints:

```text
agui-inspector listening on http://127.0.0.1:4747/
  /proxy/1 -> http://127.0.0.1:8787 (headers: X-Api-Key)
```

Open `http://127.0.0.1:4747/`. The agent list shows `http://127.0.0.1:8787/agent`. Send `Hello`. The reply is "Hello from the
reference agent." and the Inspection tab shows one exchange with its frames. In the browser's network panel every request
goes to `127.0.0.1:4747`.

Check the guards with `curl`:

```sh
curl -i http://127.0.0.1:4747/config.json                              # 200, no header value in it
curl -i -H 'Host: other.example' http://127.0.0.1:4747/config.json     # 403
curl -i -H 'Origin: https://other.example' -X POST http://127.0.0.1:4747/proxy/1/agent   # 403
curl -i http://127.0.0.1:4747/proxy/2/agent                            # 403, no such target
curl -i --request-target 'http://other.example/' http://127.0.0.1:4747/ # 403
```

Stop the command with Ctrl+C. It exits with 0.

## 5. Docs

Open `website/content/docs/cli.mdx` in the docs site (`npm run dev` in `website`, see the development page). It covers the
command, every option, the proxy paths, the headers, the guards, the limits and troubleshooting.

## Result of the run

Run on 2026-10-04 on macOS with Node.js 26.9, and the CLI tests again on Node.js 24.11 (the version CI uses). All of it
passed.

- `npm run check:ci` passed every step: type check, 1157 unit tests, build, bundle budget, demo build, 351 end-to-end
  tests and the Python tests.
- Step 4 by hand: the reference agent on port 18787 and `node packages/inspector/lib/cli/main.js --target
  http://127.0.0.1:18787/agent --header "X-Api-Key: demo-123" --port 14747`. The command printed the address and
  `/proxy/1 -> http://127.0.0.1:18787 (headers: X-Api-Key)`. `curl` got `config.json` with the policy header and no
  header value, a POST to `/proxy/1/agent` returned the five frames of the reference run, and a request with
  `Host: other.example` got a 403. In Chromium the agent list showed the target, `/proxy/1/agent` was the endpoint, and one
  run recorded five frames.
- The docs site builds with the new page (`cd website && npm ci --ignore-scripts && npm run build`).
- On this machine a connection to the non-loopback IPv4 address times out instead of being refused. A host firewall
  drops it. The tests accept either outcome, and the spec says so.
