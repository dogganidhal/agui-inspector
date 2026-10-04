---
"agui-inspector": minor
"agui-inspector-python": minor
---

The client profile can now answer interrupts and client tool calls for you. `interruptReply` resolves or cancels every interrupt of a run, `interruptPayloads` gives Resolve a JSON payload for each interrupt reason, and `toolResults` gives each client tool a scripted result. The inspector then sends the continuation your own replies would send. It stops after 10 automatic continuations in a row, so an agent that asks again on every run cannot start a loop, and Stop ends the chain. The conversation, the reply cards and an exported session show which replies were automatic. By hand stays the default. The three settings are optional, so profile and session files from 0.1.0 still load, but 0.1.0 rejects a file that uses them.
