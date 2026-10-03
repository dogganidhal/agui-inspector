---
"agui-inspector-python": patch
---

Run ids and `frame #n` references in the conversation and state views now open the evidence they point at. Activating one selects the Inspection pane and the Frames view, opens the exchange and the frame, clears a filter that would hide it and moves focus to it. Under 960 px it also switches panes. Nothing is sent and the capture is unchanged, so it works on an imported recording.
