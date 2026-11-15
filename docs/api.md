# API reference

Everything in `rig.js`, in the order you are likely to need it. Types for all of it are in [rig.d.ts](../rig.d.ts).

- [Rig.create](#rigcreate) · [The update, step by step](#the-update-step-by-step)
- Definition: [rest](#rest) · [clips](#clips) · [states and machine](#states-and-machine) · [layers](#layers) · [auto](#auto) · [alive](#alive) · [springs](#springs) · [look](#look) · [events and reactions](#events-and-reactions) · [varied takes](#varied-takes) · [slots and draw order](#slots-and-draw-order) · [constraints](#constraints) · [clip events](#clip-events) · [your own controller](#your-own-controller) · [cartoon acting](#cartoon-acting) · [meshes](#meshes)
- Beside the rig: [bones](#bones) · [an audience](#an-audience) · [a body that weighs](#a-body-that-weighs) · [without a screen](#without-a-screen) · [the lab](#the-lab)

Conventions: times are in seconds, angles in radians. Angles follow the canvas: 0 points along +x and positive turns
clockwise, because y points down. A character facing left mirrors its x when drawing.

## Rig.create

```js
const rig = Rig.create(def, seed);
```

`def` is the definition described below; every block of it is optional. `seed` (a number, default 1) seeds the rig's
own random generator, used for blink times, take choice, gaze jumps and the breath's phase. Give each character its
own seed. The rig never reads `Math.random`, so the same seed and the same `update(dt)` calls give the same pose.

The definition is read, never changed, so many rigs can share one.

### The instance

| Member | What it is |
|---|---|
| `rig.update(dt)` | Advance by `dt` seconds. Call once a frame. A negative `dt` or one above 1 s counts as 0. |
| `rig.v(channel)` | The channel's value this frame. |
| `rig.inputs` | An object of numbers your game writes. The machine and the blends read it. |
| `rig.state`, `rig.t` | The main machine's state, and the seconds spent in it. |
| `rig.go(state, fade)` | Go to a state now. `fade` is the crossfade (default 0.2). |
| `rig.fire(clip)` | Play a clip once, added on top. Firing a clip that is playing restarts it. |
| `rig.playing(clip)` | Is that one-shot playing? |
| `rig.kick(channel, velocity)` | Throw a spring. |
| `rig.lookAt(x, y)` | Look toward a direction, each axis -1..1. `rig.lookAt(null)` lets the gaze wander. |
| `rig.event(name, data)` | Run the reaction `def.on[name]`. |
| `rig.marks` | Marks to draw over the character: `[{ name, age, life, t }]`, `t` from 0 to 1. |
| `rig.slot(name)`, `rig.slots` | What each slot shows this frame. |
| `rig.events`, `rig.counts` | Clip events passed this frame, and their totals. |
| `rig.warnings` | Mistakes found in the definition. |
| `rig.log` | The last 24 things that happened: states (`'run'`), one-shots (`'!blink'`), events (`'@hit'`), skins (`'~king'`). |
| `rig.pose` | The whole pose as an object. `rig.v` is the safe way to read it (a channel not written yet reads as its rest value). |

The other members are described with the block they belong to.

### The update, step by step

`rig.update(dt)` builds the pose in a fixed order. Knowing it tells you who wins when two things move the same channel.

1. Inputs that drive blends ease toward their value (`smooth`).
2. The machines take at most one transition each.
3. `auto` one-shots fire when their time comes.
4. The pose starts at `rest`; the state's clip (or blend) writes its values, crossfaded from the previous state.
5. Layers add their offsets.
6. One-shots add their offsets.
7. Slots are resolved, clip events are collected, mesh deform keys are read.
8. `alive` adds the breath, `look` adds the gaze, `springs` add their motion.
9. Channels you own (`owns`) are replaced by what you `set()`.
10. Constraints run in their listed order.
11. `snap` holds, marks age, and the pose is published.

## Definition

### rest

```js
rest: { 'body.sy': 1, 'eye.x': 0 }
```

Channel names and their values at rest. A channel that is not listed rests at 0. Names are free; `part.property` is a
convention that the draw order and the mesh bones rely on (`<part>.z`, `<bone>.rot`).

### clips

```js
clips: {
  wave: {
    dur: 0.6,                          // length in seconds
    loop: false,                       // true for a cycle
    tracks: {
      'arm.rot': [[0, 0], [0.2, -1.2, 'out'], [0.6, 0, 'back']],   // [time, value, ease into this key]
      'slot:hand': [[0, 'open'], [0.5, 'fist']],                   // a slot track: names, always stepped
    },
    events: [[0.2, 'whoosh', { loud: 1 }]],                        // see "clip events"
  },
}
```

Easings: `'lin'`, `'io'` (ease in and out, the default), `'in'`, `'out'`, `'back'` (overshoots, then settles), `'hold'`
(keeps the previous value until the key, then steps).

A clip has no fixed role. How it is played decides how its numbers are read:

| Played as | Its track values are |
|---|---|
| a state's clip | the channel's **value** |
| a one-shot (`fire`, `auto`, a reaction) | an **offset** added to the pose |
| a layer's clip | an **offset from rest**, times the layer's weight |

So a blink written `[[0, 0], [0.07, -1], [0.16, 0]]` closes the eye from wherever it is. `Rig.sample(keys, t)` evaluates
a track by hand; `Rig.ease` holds the easing functions.

### states and machine

```js
states: {
  idle: 'breathe',                                               // a state plays a clip
  mood: { blend: 'fear', clips: [[0, 'calm'], [0.5, 'tense'], [1, 'scared']] },   // or blends clips along an input
},
initial: 'idle',                       // default: the first state listed
machine: [
  ['idle', 'run', (inputs, rig) => inputs.speed > 0.5, 0.2],     // from, to, condition, crossfade (default 0.2)
  ['*', 'fallen', (i) => i.down > 0],                            // '*' = from any state
],
smooth: { fear: 6 },                   // how fast a blend follows its input, per second (default 8)
sync: [['walk', 'run']],               // states that hand over their phase (see "clip events")
inputs: { speed: 0 },                  // start values of the inputs
```

Each update, the first transition whose `from` matches and whose condition holds is taken. `rig.go(state, fade)`
forces one. A state changed this way stays until a transition leaves it.

### layers

```js
layers: [
  { states: { quiet: 'none', talk: 'talking' },
    machine: [['*', 'talk', (i) => i.talking > 0.5, 0.1], ['talk', 'quiet', (i) => i.talking <= 0.5, 0.2]],
    weight: 1 },                       // a number, or the name of an input to follow
]
```

A layer is a second machine that runs beside the main one. Its clips add offsets from rest, so a face layer works over
any body state. `rig.layer(i)` gives its machine (`state`, `t`, `weight`).

### auto

```js
auto: { blink: [2, 5], glance: [4, 9] }    // clip: [min, max] seconds between two plays
```

### alive

```js
alive: { 'body.sy': [0.02, 3] }            // channel: [amplitude, period]
```

A breath: two sines at an irrational ratio, with a phase of its own per rig. It never loops exactly.

### springs

```js
springs: {
  'hat.rot': { k: 160, d: 8, gain: 1 },                    // rests at 0, moves when kicked
  'tail.rot': { k: 60, d: 5, input: 'speed', scale: 0.4 }, // follows an input, with lag and overshoot
}
```

A damped spring per channel, added to the pose. `k` is the stiffness, `d` the damping, `gain` scales the result.
`rig.kick(channel, velocity)` throws it. Use it for anything that should lag or wobble: a hat, a tail, antennae.

### look

```js
look: { x: 'eye.x', y: 'eye.y', head: 'head.rot', range: 3, head_gain: 0.25, saccade: [0.8, 2.5] }
```

`rig.lookAt(dx, dy)` gives the direction from the character to the target, each axis from -1 to 1. The eyes reach it
fast (`range` is their travel in the channel's unit), the head follows slower with `head_gain` of the horizontal
gaze, and small eye jumps happen every `saccade` seconds. With `rig.lookAt(null)` the gaze wanders now and then.
Any of `x`, `y`, `head` can be left out.

### Events and reactions

```js
on: {
  footstep: 'step',                                        // shorthand for { fire: 'step' }
  hit: { fire: 'ouch', kick: { 'hat.rot': 6 }, mark: ['stars', 0.9], gap: 0.3 },
  fall: { go: 'fallen', fade: 0.1, attach: { face: ['hurt', 0.5] } },
}
```

`rig.event(name, data)` runs the reaction and returns `true`, or `false` when there is none or it came within `gap`.

| Key | Effect |
|---|---|
| `fire` | Play that clip as a one-shot. |
| `go`, `fade` | Go to that state. |
| `take` | Play one of several one-shots (see below). |
| `kick` | `{ channel: velocity }` for springs. Multiplied by `data.scale` when the event has one. |
| `alt` | Flip the sign of the kicks each time (`rig.side` is 1 or -1): a lopsided reaction changes side. |
| `mark` | `'name'` or `['name', seconds]`: an entry in `rig.marks` for you to draw. Default life 0.8 s. |
| `attach` | `{ slot: 'name' }` or `{ slot: ['name', seconds] }`. |
| `gap` | Ignore the same event for that many seconds. |

`markStates: { teeter: ['sweat', 0.8] }` keeps a mark alive for as long as the rig is in a state.

### Varied takes

```js
on: { scare: { take: ['jolt', 'double', { clip: 'melt', when: (d) => d.big }, { clip: 'deadpan', w: 0.5 }] } }
```

One of the listed clips is fired: among those whose `when(data, rig)` holds, weighted by `w` (default 1), and never
the one this event played last unless it is the only one that fits. `rig.lastTake[event]` says which. The same
reaction twice in a row reads as a loop; this is the cheapest fix for it.

### Slots and draw order

```js
slots: { mouth: 'smile', hand: null, hat: 'cap' },         // each slot and what it wears at the start
skins: { king: { hat: 'crown', cape: 'red' } },
order: { cape: -2, armL: -1, body: 0, head: 1 },           // depth per part, or a list back to front
```

A slot holds the **name** of a drawing. Your code draws what `rig.slot('mouth')` names.

- `rig.attach(slot, name)` changes what a slot wears. `rig.attach(slot, name, seconds)` shows it for a moment over everything else.
- `rig.skin(name)` attaches a whole set.
- A clip keys a slot with a `'slot:<slot>'` track. Before its first key the track says nothing.
- Who wins, lowest to highest: your `attach`, the state's clip, layers weighing 0.5 or more, one-shots (the last fired), a timed attach.
- `rig.slotFrom[slot]` says who set it this frame: `'state:calm'`, `'layer0:talk'`, `'shot:sip'`, `'timed'`; absent means your own `attach`.

`rig.drawOrder()` returns the part names sorted back to front for this frame. A part's `'<part>.z'` channel adds to
its depth, so a clip can send an arm in front of the body and back (key it with ease `'hold'` for a clean swap).
`rig.depths()` returns `[[part, depth], ...]` so the parts of several characters can be sorted together.

### Constraints

```js
constraints: [
  { ik: 'armL', bones: ['armL.a1', 'armL.a2'], lens: [22, 20], root: [-13, -30], target: 'hand', bend: -1,
    avoid: [{ at: [0, -46], r: 13 }] },
  { aim: 'head.rot', root: [0, -44], target: 'hand', offset: -Math.PI / 2, limit: [-0.55, 0.55] },
  { copy: 'hair.rot', from: 'body.rot', scale: -1.4 },
  { path: 'bird', points: [[0, 0], [80, -40], [160, 0]], closed: true, at: 'fly.t' },
]
```

Constraints place parts from where things are, so your game never solves angles. They run in order, after everything
else has written the pose. A **target** or **root** is a point `[x, y]` in the character's own frame, a name set with
`rig.target(name, x, y)`, or a part that has `'<part>.x'` and `'<part>.y'` channels.

| Kind | What it writes |
|---|---|
| `ik` | Two bone angles so the limb's end reaches the target. `bones[0]` is the first bone's angle, `bones[1]` the second's relative to it. `bend` (1 or -1) picks the elbow side; `base` offsets the first angle. Out of reach the limb points at the target, and `rig.reach[name]` says how far (over 1 = out of reach). |
| `ik` with `avoid` | The limb keeps off those circles: it takes the elbow side that crosses less (swinging over `swing` seconds, default 0.15) and slides its end to a circle's edge by at most `dodge` px (default 8). `rig.elbow`, `rig.dodge`, `rig.cross` say what it did. |
| `aim` | A channel turns to face the target, minus `offset`, within `limit` around `center`. |
| `copy` | A channel follows another: `from * scale + offset`. |
| `path` | A point rides a smooth curve through `points` by length (`at` is 0..1, a number or a channel). Writes `'<name>.x'`, `'<name>.y'` and `'<name>.rot'` (the heading; `rot: false` skips it). |

Every constraint takes `mix`: a number, or a channel name so that a clip can let go. With `'armL.ik'` at rest 1, a
flail one-shot that keys it to -1 (one-shots add) frees the arm for its own keys, then gives it back.

To draw a limb from its two angles, use [`Rig.bones.chain`](#bones).

### Clip events

```js
clips: {
  walk: { dur: 0.8, loop: true, tracks: { /* ... */ }, events: [[0.2, 'step', { foot: 'L' }], [0.6, 'step', { foot: 'R' }]] },
  slash: { dur: 0.4, tracks: { /* ... */ }, events: [[0.15, 'hitOn'], [0.24, 'hitOff']] },
}
```

```js
rig.update(dt);
for (const e of rig.events) if (e.name === 'step') moveBy(stride);    // { name, data, clip, at, from }
```

A clip names its moments, so the game acts on the animation's keys and never on a timer of its own. Retime the clip
and the game follows.

- Each key the playhead passes fires once, in order, whatever the frame rate: a long frame that passes two keys fires both, a loop passed twice fires twice.
- `from` is `'state'`, `'layer<i>'` or `'shot'`. Layers weighing under 0.5 stay silent.
- A clip that takes over during a crossfade fires only what its own last frame passed.
- Two cycles that hand over, such as a walk and a run, should share a `sync` group: the new one starts at the old one's phase, so a left foot is never followed by a left foot.
- `rig.counts[name]` keeps the totals.

### Your own controller

When gameplay or physics code already moves part of the character (a walker's legs, a ragdoll, a vehicle), let it.
The controller owns the motion that decides the game; the rig expresses it.

```js
owns: ['leg.*', 'hip.y'],                                   // channels your code writes; the rig never moves them
sense: { fear: { from: 'balance', range: [1, 0] } },        // a signal mapped to an input: balance 1 -> fear 0
drive: { arms: { target: 'arm.swing', gain: 'arm.stiff' } },// what the rig asks of your code
```

```js
rig.feed({ balance: 0.3, speed: 2 });          // signals in; `sense` turns them into inputs
rig.set({ 'leg.l': a, 'leg.r': b });           // your channels, passed through to the pose untouched
rig.event('fall');                             // what happens once
const { arms } = rig.drives();                 // { target, gain }: requests you may honour
```

- A `sense` entry is a signal name, a `{ from, range }` map to 0..1, or a function of the signals.
- No clip, layer, spring, breath or constraint writes a channel listed in `owns`; `rig.warnings` lists the clips that try.
- `set()` on a channel that `owns` does not list is dropped, with a warning once per channel.
- The rig never writes your state. A game plays out the same with the rig on or off.

### Cartoon acting

```js
snap: { 'eye.size': 0.22, brow: 0.35 }, snapHold: 0.2, snapOver: 0.3,
hold: 12,
```

- `snap`: a change bigger than the channel's threshold jumps past its target by `snapOver` and holds for `snapHold` seconds, then eases. Small drifts ease as before. Faces read faster this way.
- `hold`: `rig.held` is the pose sampled that many times a second (animation "on twos"), while `rig.pose` stays live. Use it for faces and still poses; on a body that travels it reads as lag.

### Meshes

```js
meshes: {
  eel: Object.assign(Rig.mesh.grid(0, 0, 320, 56, 16, 2), {          // points and tris over a picture's rectangle
    bones: [{ name: 'b0', at: [0, 28], to: [64, 28] }, /* ... */],
  }),
}
```

One picture on a mesh of points, bent by bones, so a long or soft body bends as one skin.

- Each point follows its `k` nearest bones (default 2), weighted by distance (`falloff`, `soft`), unless you give `weights`.
- A bone moves by its channels: `'<bone>.x'`, `'.y'` (its root), `'.rot'` (radians added to its rest direction), `'.sx'`, `'.sy'` (stretch along and across). They rest at the bone's bind pose. Clips, springs or your own code drive them like any channel.
- A clip can also move points directly: `deform: { eel: [[t, { pointIndex: [dx, dy] }, ease], ...] }`.
- `rig.mesh('eel')` returns this frame's points as `[x0, y0, x1, y1, ...]`. `Rig.mesh.draw(ctx, image, rig, 'eel')` draws the picture on them with a 2D canvas; with another renderer, feed the points to your own textured triangles (`rig.meshDef('eel')` has `tris` and `uv`).

## Beside the rig

### Bones

Helpers for limbs, usable with or without a rig.

| Call | Returns |
|---|---|
| `Rig.bones.chain(root, [{ joint, len }, ...], pose, base)` | `{ pts, angles }`: forward kinematics. Each joint's angle is relative to its parent bone. |
| `Rig.bones.ik2(root, target, l1, l2, bend)` | `{ a1, a2, reach }`: the two-bone solver the `ik` constraint uses. |
| `Rig.bones.follower(joints)` | An object whose `step(targetPose, dt, stiff, maxSpeed)` eases a limb toward a pose with a speed cap and no overshoot. |
| `Rig.bones.mix(a, b, t)` | A blend of two poses. |
| `Rig.bones.along(points, t, closed)` | `[x, y, heading]`: a point along a smooth curve, by length. |

### An audience

```js
const crowd = Rig.audience({ speed: 650, look: 0.8, memory: { life: 20, full: 3, input: 'wary' } });
const seat = crowd.add(rig, x, y);            // one per watcher
crowd.react(x, y, 'gasp', { big: true });     // something happened there
crowd.update(dt);                             // each frame, before the rigs' own update
```

- `react` sends the event to each watcher after a delay that grows with its distance (`speed` in px per second, plus a little `jitter`), so a reaction travels as a ripple. The event's data gains `dx`, `dy` (the direction to it, -1..1 over `range` px, default 300) and `dist`, which a take's `when` can read.
- Each watcher turns its gaze to the spot for `look` seconds.
- Each watcher remembers what it saw, fading with a half-life of `memory.life` seconds: its input `memory.input` goes from 0 to 1 as it sees `memory.full` events. Use it for a state that backs away.
- `crowd.habit(key)` counts the player's own moves and says how this one reads now: `'new'` (too few moves yet), `'stale'` (over a quarter of the recent ones), `'fresh'` (under 6 %) or `'plain'`. A yawn for the stale move, a gasp for the fresh one.
- `crowd.move(seat, x, y)` when a watcher moves.

The audience only sends events, inputs and gazes to its rigs, and has its own seeded dice (`seed`).

### A body that weighs

```js
const body = Rig.phys.create({
  points: { shL: { at: [-13, -30], m: 1 }, shR: { at: [13, -30] }, hipL: { at: [-9, 0] }, hipR: { at: [9, 0] } },
  sticks: [['shL', 'shR'], ['hipL', 'hipR'], ['shL', 'hipL'], ['shR', 'hipR'], ['shL', 'hipR'], ['shR', 'hipL']],
  gravity: 900,
});
body.link('armL', 'shL', [x, y], { max: 41 });                              // a rope: a hand on a hold
body.link('legL', 'hipL', [x, y], { min: 20, rest: 44, soft: 0.25, pull: 0.04 });   // a strut: a foot on a step
body.step(dt);
const { x, y, rot } = body.frame('hipL', 'hipR', 'shL', 'shR');             // the pelvis and the spine's lean
```

A few weighted points held rigid by sticks and tied to the world by links. Gravity pulls and the pose follows from
what holds it: the body hangs and tilts under one hand, stands on feet under the hips, and a `launch(vx, vy)` flies a
true arc. Fixed 120 Hz steps, so the same inputs give the same motion.

| Call | What it does |
|---|---|
| `link(name, point, at, options)` | Tie a point to a place. `max` alone is a rope; `rest` with `min`/`max` is a strut that leans toward its rest length (`soft` when shorter, `pull` when longer). |
| `unlink(name)`, `move(name, at)` | Let go; move the place. |
| `load[name]` | The share of the body's weight the link carries (1 = all of it). |
| `com()`, `vel()` | Centre of mass and its velocity. |
| `launch(vx, vy)`, `place(dx, dy)` | Throw the body; shift it. |
| `frame(hipL, hipR, shL, shR)` | `{ x, y, rot }` for the character's frame. IK constraints then reach the holds from there. |

### Without a screen

```js
const r = Rig.report(def, { seconds: 6, script: [{ at: 1, event: 'poke' }, { at: 2, inputs: { fear: 1 } }] });
r.ok; // false when the definition has a mistake
console.log(r.text);
```

```sh
npx rig report examples/blob.rig.mjs --script examples/blob.script.json
```

```
blob: 6 s at 60 frames a second, seed 1, 4 script steps
pass    no mistake in the definition, every channel is a number on every frame
states  mood 6 s
played  calm (state), scared (state), jump x1, blink x2
moved   body.sx 1..1.1, body.sy 0.672..1.048, body.y -45.995..0, brow 0..1, eye.open 0.005..1, eye.x -1.821..8.756, eye.y -0.265..0.905, head.rot -0.036..0.175, tuft.rot -0.035..0.086
slots   mouth: smile / worry / open
note    Channels of the rest pose that nothing moved: body.x.
ok: 0 fails, 1 note
```

The definition is played in Node for a few seconds and read back: the time spent in each state, the clips that played
(as a state's clip, or how many times as a one-shot), the clip events, each channel's lowest and highest value, what
each slot showed. It is how a test, a CI job or a coding agent checks a character that nobody is looking at.

- **Fails** (`ok` is false, the command exits 1): everything in `rig.warnings`, a channel that is `NaN` or infinite
  on some frame, a script step that names an event, a clip or a state the rig does not have.
- **Notes** (never a failure): clips that never played, states never reached, reactions never sent, channels of the
  rest pose that nothing moved. Often a mistake, sometimes the design: a channel the game drives itself never moves here.
- **The script** is a list of steps, each at its time in seconds. A step may carry `event` (+ `data`), `inputs`,
  `fire`, `go` (+ `fade`), `look` (`[x, y]` or `null`), `feed`, `set`, `attach` (`[slot, name, seconds?]`), `skin`,
  `kick` (`{ channel: velocity }`).
- **Options**: `seconds` (6), `fps` (60), `seed` (1), `name` (the first line's label).
- **The result**: `{ ok, text, warnings, problems, notes, states, layers, played, never, channels, events, slots }`.
  `rig report --json` prints it without `text`.

The command needs the definition in a module of its own (`export default { ... }`, or `module.exports`; `--export
NAME` for a named export), with no page code around it. `--quiet` keeps the fails and the last line. It exits 0 when
the definition has no mistake, 1 when it has one, 2 when it could not run.

### The lab

```js
Rig.expose('hero', rig);      // name a rig for the lab; returns the rig
```

Open your page with `?rig` in the URL, or call `Rig.lab()`. A panel appears over the page with, for each exposed rig:
a slider per input (ranges from `def.ranges: { speed: [0, 3] }`, default 0..1), a button per state, one-shot and skin,
the live state, fed signals, drives and slots, and a checkbox that makes the gaze follow the pointer.

The panel has a close button; `Rig.lab.close()` does the same from code.

`Rig.lab(list)` shows rigs of your choice instead: an array of `{ name, rig }`, an object `{ name: rig }`, or a
function that returns the array.
