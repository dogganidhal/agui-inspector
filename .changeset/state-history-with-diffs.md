---
"agui-inspector": minor
"agui-inspector-python": minor
---

The State tab now shows a history of every state snapshot and delta, with a diff for each change and the state at any past point. Select a point with the pointer or with the arrow keys, Home and End. A banner marks a past state, and "Back to latest" returns to the current one. The history follows a live run, keeps a selected past point while new changes arrive, and works on an imported recording. It reads the capture and sends nothing, and recordings from 0.1.0 show their history without any change to the file.
