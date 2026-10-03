# agui-inspector-python

## 0.0.1

### Patch Changes

- b925a8b: The export confirmation and the authentication popover no longer say a token can never be in a recording. Headers are still not captured or exported, but a payload can hold a credential the target echoed back, and the file keeps it exactly as received.
- 8d3b7a3: On a FastAPI app, `mount_inspector` now registers API routes, so the app's own `FastAPI(dependencies=[...])` guards run for the page, `config.json`, the assets and the slash redirect. The redirect keeps the ASGI `root_path`, so an inspector under `outer.mount("/api", app)` redirects to `/api/agui-inspector/`.
- 6441c6f: Keep Stop available while a response is still being recorded. A raw request whose response never finishes, and a run the protocol client rejected while its response stays open, can now be stopped, and nothing the server sends after Stop is kept.
- 0467b3f: Event streams that end their lines with CRLF or a bare CR now leave the same transcript, state and outcome as LF streams, so the next request carries the assistant reply and the updated state. The recorded bytes are unchanged.
- 6a8ac2f: Frame references and offsets in the conversation view now reach 4.5:1 contrast against their background in the default light and dark themes.
- 41cfe55: Importing a recording now refuses a frame labelled `valid` whose event fails the AG-UI schema, and shows an import error instead of a blank inspector. A pane that cannot render a recording shows its own error, and the previous capture comes back on screen and stays exportable.
- 003f930: Run ids and `frame #n` references in the conversation and state views now open the evidence they point at. Activating one selects the Inspection pane and the Frames view, opens the exchange and the frame, clears a filter that would hide it and moves focus to it. Under 960 px it also switches panes. Nothing is sent and the capture is unchanged, so it works on an imported recording.
