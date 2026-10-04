---
"agui-inspector": patch
"agui-inspector-python": patch
---

The time axes of the subagent timeline and the run waterfall no longer draw a tick label on top of the end label. On a 6.82 s run, the "6 s" tick ran into "6.82 s" and read "6s82 s". A tick whose label would touch the end label is now left out.
