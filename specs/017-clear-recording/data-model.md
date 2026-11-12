# Data model: Clear the recording

No new entity. The feature empties existing ones.

## Live capture (the session store)

| Record | After clear |
| --- | --- |
| Exchanges | none |
| Raw frames | none |
| Runs | none |
| Findings | none |
| Derived entries (chunk expansions) | none |
| Session id | unchanged |

Invariants after a clear are those of a new store: unique ids, frame indices in arrival order per exchange, offsets that never go backwards, references that exist.

## Thread (runtime)

Replaced as by New thread: new `threadId`, empty transcript and state, no waiting interrupt or tool result, no automatic reply streak or pause, no error.

## Kept

Selected agent, endpoint, token (memory only), client profile, preset variables, declared capabilities, composer text, raw request editor text, theme.

## Export marker (page memory only)

The live capture's exchange and frame counts at its last export. Set on export of the live capture, forgotten on clear. Never stored.

## Clear control states

| Condition | Control |
| --- | --- |
| Anything being sent or recorded | disabled, "Stop the run first: a response is still being recorded" |
| No recording open, live capture empty | disabled, "Nothing to clear" |
| Live capture unchanged since its export, or empty with a recording open | enabled, clears at once |
| Otherwise | enabled, asks to confirm |
