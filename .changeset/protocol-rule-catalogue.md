---
"agui-inspector": minor
"agui-inspector-python": minor
---

Every finding now names a stable rule id, such as `sequence.text-message-not-open`, and the docs list all 39 rules. A frame that contradicts a declared capability gets a finding: a reasoning event when `reasoning.supported` is false, an interrupt outcome when `humanInTheLoop.interrupts` is false, and a state delta or snapshot when `state.deltas` or `state.snapshots` is false. A frame in an older shape that the protocol client still accepts, such as a `THINKING_START` event, gets a `compat` finding instead of a schema finding. Session files carry the id in an optional `rule` field. Files from 0.1.0 still open. A file from this version may not open in 0.1.0.
