# Research: Clear the recording

## R1. Where the clear happens

- Decision: a `clear()` method on the session store, called by the page with `runtime.newThread()`.
- Rationale: the store owns the records and the invariant checks. Emptying it in place keeps every subscriber (views, chunk expansion publisher, recorder sink) attached to the same object, so nothing has to be re-wired. A new store per clear would mean replacing the store the runtime and recorder hold.
- Alternatives: a new store object (needs a runtime and recorder rebuild, which also drops the token); a runtime `clear()` that wraps both (one more method for two calls the page already has).

## R2. Ids after a clear

- Decision: ids keep counting. Exchange ids come from the recorder (`exchange-N`), run ids and their finding ids from the runtime (`run-N`, `run-N:finding-M`). Neither counter is reset.
- Rationale: a cleared id never comes back, so a stale view selection or an open row keyed by an old id cannot attach to a new record. The store's own sets are emptied, so a reused id would also be accepted; that is the same rule as on a new store.
- Alternatives: resetting the counters (new records would reuse ids a view may still hold in local state).

## R3. When the button is available

- Decision: disabled while `RuntimeState.capturing` is true, with the reason; disabled when no recording is open and the live capture has no exchange; the page re-checks `capturing` when the button is pressed.
- Rationale: `capturing` is true from the moment a request is about to be sent until its recording has ended, including a stream the protocol client gave up on. It is the exact window in which frames can still arrive, so it is the window principle I protects. Every exchange is created inside that window, and its end emits a runtime change that re-renders the page, so reading the live snapshot's exchange count during render is current whenever it matters, and the page root needs no store subscription.
- Alternatives: stop then clear in one press (needs to wait for each recording's end; more code for one saved click); `running` (ends before the recorder does, so a rejected stream could be cut).

## R4. When to confirm

- Decision: confirm when the live capture is non-empty and its exchange and frame counts differ from those at its last export. Clearing forgets the marker.
- Rationale: after a capture ends, any new activity adds an exchange, and frames only arrive while capturing. Counts therefore tell "changed since export" without hashing. Derived chunk expansions, added a moment after a run, are recomputable and are ignored, so they do not cause a confirmation.
- Alternatives: snapshot identity (changes when expansions are added after an export); always confirm; never confirm.

## R5. Imported recording

- Decision: the button closes it and clears the live capture; the page then sends again. The notice and banner name Clear session instead of a reload.
- Rationale: the recording is a file the developer already has, and leaving it needed a reload, which is the pain this feature removes.
