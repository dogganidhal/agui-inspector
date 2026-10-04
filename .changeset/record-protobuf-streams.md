---
"agui-inspector": minor
"agui-inspector-python": minor
---

The inspector can now ask a server for the AG-UI protobuf encoding, record its binary frames as received and show each one decoded. An Encoding control in the client profile offers Preset default, Server-sent events and Protobuf, and a preset can set `encoding` as the default for one agent. The profile wins, and server-sent events stay the default. Runs, continuations, surface actions and raw submissions then ask for protobuf in the `Accept` header. Each frame keeps its bytes, order and timing, and its detail shows the first 4,096 bytes as hexadecimal text next to the decoded event. Bytes that cannot be decoded, events from a later protocol, frames over 10 MB and streams cut inside a frame are all kept, with a finding. The rule catalogue gains a `binary` family with three rules. A session export keeps each frame's bytes as base64 and import checks them against the decoded event. The new `encoding` and `bytes` fields are optional and the formats stay at version 0, so files from 0.1.0 still load, but 0.1.0 rejects a file that uses them. Resuming runs with `connectAgent` is not part of this release.
