# Contract: the v0.8 reference story

**Spec**: FR-019 | **Research**: R10

| | |
| --- | --- |
| Agent | The reference agent's A2UI agent (`__demo__/agent/a2ui` in the demo, the A2UI route of the fixture server) |
| Quick message | `Review an expense report (v0.8)`, between `Probe the sandbox` and `Show the order form` |
| Activity | `a2ui-surface`, message id `a2ui-expense-v08` for the first run and for each action's run, so a later run changes the surface in place |
| Operations | v0.8 only. No `version` key anywhere. No address that resolves |

First run, as one `ACTIVITY_SNAPSHOT` with `replace: true`:

| Position | Message |
| --- | --- |
| 0 | `surfaceUpdate` for `expense`: `Column` (title `Text` h2, amount `TextField`, category `MultipleChoice`, `CheckBox`, `Slider`, `Tabs` of two notes, `Button` "Submit expense") |
| 1 | `dataModelUpdate` for `expense` with the starting values |
| 2 | `beginRendering` for `expense` with no `catalogId` |
| 3 | `surfaceUpdate` for `status`: `Column` of a `Text` bound to `/status` and a `Button` "Withdraw" whose action `withdraw_expense` binds `{ status }` to `/status` |
| 4 | `dataModelUpdate` for `status`: `status = "Waiting for review"` |
| 5 | `beginRendering` for `status` with `catalogId` = the v0.8 standard id |

Action `submit_expense`, context `{ amount, category, receipt, urgency }` bound to the data paths. The run input carries
the five fields. The answer is the first list plus:

| Position | Message |
| --- | --- |
| 6 | `dataModelUpdate` for `status`: `status = "Submitted <amount> for <category>"` |
| 7 | `surfaceUpdate` for `expense`: adds a `Text` "Received submit_expense from submit: <context as JSON>" and the column's `explicitList` that lists it |

Action `withdraw_expense`, context `{ status }`. The answer is the first list plus:

| Position | Message |
| --- | --- |
| 6 | `deleteSurface` for `expense` (no `version`) |
| 7 | `dataModelUpdate` for `status`: `status = "Withdrawn"` |

So the status line and the echo prove that the renderer resolved the bindings and that the agent saw them, and the
second action proves a v0.8 `deleteSurface` round trip. The continuation is a pure function of the action: nothing is
remembered between runs (as for every showcase story).

Unit tests assert: every message passes the strict v0.8 schema; no `version` key; no address outside `.invalid`; both
surfaces become visible in a real v0.8 processor; both continuations keep the first six messages as they were, and after `withdraw_expense` only `status` is visible.
