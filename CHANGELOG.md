# Changelog

## 3.9.0

- `Rig.report(def, { seconds, script })` and the `rig report <module>` command: a definition played without a screen and
  read back in text (what moved, what played, what never did), with an exit code. Made for a coding agent, which cannot
  see the animation, and for a test.
- `AGENTS.md`: the library for a coding agent, in one page.
- `examples/blob.rig.mjs`: the tutorial's character as a module of its own, with a script.

## 3.8.0

First public release.

- `Rig.create`: rest pose, clips, states and blends, a state machine, layers, one-shots, auto triggers, springs, a breath, a gaze.
- Events and reactions, varied takes, marks.
- Slots, skins and draw order.
- Constraints: two-bone IK with obstacle avoidance, aim, copy, path.
- Clip events with phase-synced handovers.
- A contract for a controller of your own: owned channels, signals, drives.
- Meshes bent by bones, with deform keys.
- `Rig.bones`, `Rig.audience`, `Rig.phys`, `Rig.mesh`, and the lab panel (`?rig`, `Rig.expose`, `Rig.lab`).
- One file for a script tag and CommonJS (`rig.js`), an ES module (`rig.mjs`), TypeScript declarations (`rig.d.ts`).
