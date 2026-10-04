# Quickstart: validating protobuf streams

Run from the repository root. Node 24 or newer. Every scenario uses the reference agent, never a model or an outside
service. Contracts: [binary frames](./contracts/binary-frames.md), [recording format](./contracts/recording-format.md),
[settings](./contracts/settings.md).

## Setup

```sh
npm ci --ignore-scripts
npx playwright install chromium   # once, for the end-to-end tests
```

## 1. The wire, by hand (user story 1, FR-004, FR-019)

```sh
node examples/reference-agent/server.ts --port 8787 &
curl -si -X POST http://127.0.0.1:8787/agent \
  -H 'content-type: application/json' -H 'accept: application/vnd.ag-ui.event+proto' \
  -d '{"threadId":"t1","runId":"r1","messages":[],"state":{},"tools":[],"context":[],"forwardedProps":{}}' | xxd | head
```

Expected: `content-type: application/vnd.ag-ui.event+proto` and a body that starts with a four-byte length (`0000 00`
and one more byte), then the first message. Without the `accept` header the same request answers `text/event-stream`.
Stop the server with `kill %1`.

## 2. Unit tests, by area

```sh
npm run test:unit -- packages/inspector/tests/frames        # binary reader, framing, decode outcomes, every cut
npm run test:unit -- packages/inspector/tests/recorder      # protobuf exchanges, no header read, error bodies
npm run test:unit -- packages/inspector/tests/runtime       # Accept per request, client bytes unchanged, profile over preset
npm run test:unit -- packages/inspector/tests/config        # profile and preset encoding
npm run test:unit -- packages/inspector/tests/inspection    # export and import, views model
npm run test:unit -- packages/inspector/tests/conversation  # decoded frames feed the same conversation
npm run test:unit -- packages/inspector/tests/foundation    # reference agent, upstream pins, dependency rows
```

Expected: all pass. `tests/foundation` includes the pins that fail first when `@ag-ui/client` or `@ag-ui/proto`
changes the framing, the 10 MB limit or an error message the inspector copies.

## 3. End to end (SC-001, SC-002, SC-005, SC-006)

```sh
npm run build
npm run test:e2e -- tests/e2e/inspection --workers=2
npm run test:e2e -- tests/e2e/runtime --workers=2
npm run test:e2e -- tests/e2e/config --workers=2
npm run test:e2e -- tests/e2e/hosted/protobuf.spec.ts --workers=2
```

Expected: the protobuf specs show one frame per message the agent sent, with their bytes equal to what it wrote; a
round trip through export and import keeps every frame's bytes; each damaged stream keeps every byte with its finding.

## 4. By eye (user stories 1, 2 and 5)

1. Build, then serve `packages/inspector/dist` on `http://127.0.0.1:4173` and start
   `node examples/reference-agent/server.ts --port 8787 --allow-origin http://127.0.0.1:4173`.
2. Open the page, type `http://127.0.0.1:8787/agent` and press Use endpoint.
3. Open Settings, set Encoding to Protobuf, return to the conversation and send `hello`.
4. In Inspection, the exchange has a `protobuf` tag and one frame per message. Expand a frame: the decoded event is
   formatted JSON, and the bytes are hexadecimal text that starts with the four length bytes.
5. Export the session, reload, import the file. The frames show the same bytes.
6. Set Encoding back to Server-sent events, send again. The new exchange has no `protobuf` tag.

## 5. Gate

```sh
npm run check:ci
```

Expected: pass, including the bundle budget (1,227,500 bytes minified and 308,758 gzipped before this change, limits
2,000,000 and 600,000).
