# rig.js for coding agents

This file is for an AI coding agent asked to animate a character with rig.js, or to work on this repository. It is the
short version of [docs/api.md](docs/api.md): enough to integrate the library without reading the rest, and a way to
check your work without seeing the screen.

## What it is

- A character is **data**: a rest pose of named channels, keyframed clips, a state machine, reactions to events.
- `rig.update(dt)` computes the numbers; the game reads them with `rig.v('channel')` and draws. The rig draws nothing.
- One file, no dependency, runs in a browser, in Node and in a worker. Deterministic for a seed.

## You cannot see the animation: read it instead

`rig report` plays a definition for a few seconds in Node and prints what moved, what played and what never did. Run it
after every change to a definition. Exit code 0: no mistake; 1: a mistake (the `FAIL` lines say which); 2: the command
could not run.

```sh
npx rig report hero.rig.mjs --script hero.script.json          # text
npx rig report hero.rig.mjs --script hero.script.json --json   # the same as data
```

```
blob: 6 s at 60 frames a second, seed 1, 4 script steps
pass    no mistake in the definition, every channel is a number on every frame
states  mood 6 s
played  calm (state), scared (state), jump x1, blink x2
moved   body.sx 1..1.1, body.sy 0.672..1.048, body.y -45.995..0, brow 0..1, eye.open 0.005..1, ...
slots   mouth: smile / worry / open
note    Channels of the rest pose that nothing moved: body.x.
ok: 0 fails, 1 note
```

How to read it:

- `FAIL`: a name that points nowhere (a state plays a clip that does not exist, a reaction fires one, a transition goes
  to a missing state), a channel that became `NaN`, a script step the rig cannot run. Fix these first.
- `played`: the clips that ran. A clip listed under `note Never played` is unreachable in this run: add the input,
  event or state change that should reach it to the script, or the definition never plays it.
- `moved`: each channel's lowest and highest value. Use it to check a range against what the drawing expects (an eye
  that opens past 1, a body that squashes below 0.5, an angle in degrees where radians were meant).
- `note Channels of the rest pose that nothing moved`: declared, never animated. Either dead, or driven by the game.
- A note is not a failure. Decide whether it is what the design wants.

The script is JSON, a list of steps at their time in seconds. A step may carry any of: `event` (+ `data`), `inputs`,
`fire`, `go` (+ `fade`), `look` (`[x, y]` or `null`), `feed`, `set`, `attach` (`[slot, name, seconds?]`), `skin`,
`kick` (`{ channel: velocity }`).

```json
[
  { "at": 1, "look": [1, 0] },
  { "at": 2, "inputs": { "fear": 1 } },
  { "at": 3, "event": "poke" },
  { "at": 4, "inputs": { "fear": 0 }, "look": null }
]
```

In code, `Rig.report(def, { seconds, fps, seed, name, script })` returns the same thing:
`{ ok, text, warnings, problems, notes, states, layers, played, never: { clips, states, reactions, still }, channels: { name: { rest, min, max, moved } }, events, slots }`.
Use it in a test: `assert(Rig.report(def, { script }).ok)`.

For this to work, **keep each definition in a module of its own**, with no page code around it:

```js
// hero.rig.mjs
export default { rest: { ... }, clips: { ... }, states: { ... }, on: { ... } };
```

## Integrate it

```sh
npm install github:Kodoque1/rig        # or copy rig.js next to the page: <script src="rig.js"></script> gives window.Rig
```

```js
import Rig from '@kodoque1/rig';
import def from './hero.rig.mjs';

const rig = Rig.create(def, seed); // one rig per character, each with its own seed

function frame(dt) {
  // dt in seconds
  rig.inputs.speed = player.speed; // 1. what the game knows, as numbers
  rig.lookAt(dx, dy); //    a direction, each axis -1..1 (null: the gaze wanders)
  rig.update(dt); // 2. once a frame
  draw(rig); // 3. read rig.v('body.sy'), rig.slot('mouth'), rig.marks and draw
}
// where something happens once:
rig.event('hit', { scale: 1.5 }); // runs def.on.hit; returns false when there is no such reaction
```

## The definition, block by block

Every block is optional. Times in seconds, angles in radians (canvas frame: positive is clockwise).

| block                     | shape                                                                                                | what it does                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `rest`                    | `{ 'body.sy': 1 }`                                                                                   | Channels and their value at rest. Unlisted channels rest at 0.                                            |
| `clips`                   | `{ name: { dur, loop, tracks: { channel: [[t, value, ease?], ...] }, events: [[t, name, data?]] } }` | Keyframes. Eases: `lin`, `io` (default), `in`, `out`, `back`, `hold`. A `'slot:<slot>'` track keys names. |
| `states`                  | `{ idle: 'breathe', mood: { blend: 'fear', clips: [[0, 'calm'], [1, 'scared']] } }`                  | What plays now: a clip, or clips blended along an input.                                                  |
| `machine`                 | `[[from, to, (inputs, rig) => bool, fade?]]`                                                         | Transitions; `'*'` is any state. First match wins, one a frame.                                           |
| `inputs`, `smooth`        | `{ speed: 0 }`, `{ fear: 6 }`                                                                        | Start values; how fast a blend follows its input (per second).                                            |
| `layers`                  | `[{ states, machine, weight }]`                                                                      | A second machine added on top (a face over a body).                                                       |
| `auto`                    | `{ blink: [1.5, 4] }`                                                                                | A clip fired every min..max seconds.                                                                      |
| `alive`                   | `{ 'body.sy': [0.02, 3] }`                                                                           | A breath: `[amplitude, period]`, never loops the same.                                                    |
| `springs`                 | `{ 'hat.rot': { k, d, gain } }`                                                                      | Lag and wobble. `rig.kick(channel, velocity)` or a reaction's `kick` throws it.                           |
| `look`                    | `{ x: 'eye.x', y: 'eye.y', head: 'head.rot', range }`                                                | Where `rig.lookAt` writes the gaze.                                                                       |
| `on`                      | `{ hit: { fire, go, take, kick, mark, attach, gap } }`                                               | What an event does. `'clip'` is short for `{ fire: 'clip' }`.                                             |
| `slots`, `skins`, `order` | `{ mouth: 'smile' }`                                                                                 | Whole drawings swapped by name; draw order by part.                                                       |
| `constraints`             | `[{ ik }, { aim }, { copy }, { path }]`                                                              | Two-bone IK (with `avoid`), aim, copy, follow a path.                                                     |
| `owns`, `sense`, `drive`  | `['leg.*']`                                                                                          | Channels the game writes itself with `rig.set()`; the rig never moves them.                               |
| `meshes`                  | `Rig.mesh.grid(...)` + `bones`                                                                       | One picture bent by bones.                                                                                |

How a clip's numbers are read depends on how it is played:

| played as                               | its track values are                              |
| --------------------------------------- | ------------------------------------------------- |
| a state's clip                          | the channel's **value**                           |
| a one-shot (`fire`, `auto`, a reaction) | an **offset** added to the pose                   |
| a layer's clip                          | an **offset from rest**, times the layer's weight |

## The instance

`update(dt)`, `v(channel)`, `inputs`, `state`, `t`, `go(state, fade)`, `fire(clip)`, `playing(clip)`,
`kick(channel, velocity)`, `lookAt(x, y)`, `event(name, data)`, `marks`, `slot(name)`, `attach(slot, name, seconds?)`,
`skin(name)`, `drawOrder()`, `events` (clip events passed this frame), `counts`, `warnings`, `log`, `feed(signals)`,
`set(channels)`, `drives()`, `target(name, x, y)`, `mesh(name)`. Beside the rig: `Rig.bones`, `Rig.audience`,
`Rig.phys`, `Rig.mesh`, `Rig.expose` / `Rig.lab`, `Rig.sample`, `Rig.ease`. Types: [rig.d.ts](rig.d.ts).

## Mistakes that cost a round

- **A blink written as values.** A one-shot adds to the pose: a blink is `[[0, 0], [0.07, -1], [0.16, 0]]` (close by
  1 from wherever the eye is), never `[[0, 1], [0.07, 0], [0.16, 1]]`.
- **A state clip written as offsets.** A state's clip gives the value itself: a body at rest 1 is keyed around 1.
- **Timers in game code.** No `setTimeout` for a blink, a footstep or a hit window: use `auto`, clip `events`, `gap`.
- **Game code writing a channel the rig animates.** Declare it in `owns` and write it with `rig.set()`, or the two
  fight. `rig.warnings` lists a clip that keys an owned channel.
- **`Math.random` for variety.** The rig has its own seeded dice. Give each character its own seed instead.
- **Degrees.** Every angle is in radians.
- **Reading `rig.pose[ch]` directly.** A channel not written yet is `undefined` there; `rig.v(ch)` gives its rest value.
- **The rig as game state.** The rig only writes its own pose. Outcomes are decided by the game; a clip `events` key
  is the one place where the animation tells the game when (a footstep, a hit window).
- **One reaction on a loop.** The same clip for every hit reads as a loop: give `take` two or three.

## Paste this into the project's agent instructions

```md
## Character animation (rig.js)

- Characters are animated with @kodoque1/rig. Read node_modules/@kodoque1/rig/AGENTS.md before touching one.
- Each character's definition is a module of its own (`<name>.rig.mjs`, `export default { ... }`), with no page code,
  next to a script of what happens to it (`<name>.script.json`).
- After any change to a definition, run `npx rig report <name>.rig.mjs --script <name>.script.json`. Fix every FAIL.
  Read the notes: a clip that never played or a channel that never moved is usually a mistake.
- The game sets `rig.inputs`, sends `rig.event(...)`, calls `rig.update(dt)` once a frame and reads `rig.v(...)`.
  It never writes a channel the rig animates, and never times an animation with a timer of its own.
```

## Working on this repository

- `rig.js` is the source. `rig.mjs` is generated: run `npm run build` after an edit, never edit it.
- `npm test` runs every check in plain Node (no dependency). `npm run test:types` compiles the declarations.
- A new feature needs: a check in `test/rig.test.js`, its types in `rig.d.ts`, its section in `docs/api.md`, a line in
  `CHANGELOG.md`.
- Formatting: Prettier, with the settings in `.prettierrc`.
