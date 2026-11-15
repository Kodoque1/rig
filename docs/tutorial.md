# Tutorial: a character that reacts

You will build the character in [examples/02-character.html](../examples/02-character.html): a blob that breathes,
blinks, gets nervous when the pointer comes close, watches it, and jumps when poked. It takes seven short steps. Each
one adds a block to the definition and, at most, a line or two to your game code.

You need a page with a canvas and `rig.js`:

```html
<canvas id="c" width="480" height="360"></canvas>
<script src="rig.js"></script>
<script>
  // the code below goes here
</script>
```

## 1. A pose and a drawing

A rig is a set of **channels**: named numbers. You choose the names; `part.property` is a convention, not a rule.
The definition's `rest` block says what each one is worth when nothing is happening.

```js
const def = {
  rest: { 'body.sx': 1, 'body.sy': 1, 'eye.open': 1 },
};
const rig = Rig.create(def);
```

The rig never draws. Your code reads the pose with `rig.v(channel)` and draws:

```js
const ctx = document.getElementById('c').getContext('2d');

function draw(r) {
  const v = r.v;
  ctx.save();
  ctx.translate(240, 300);                         // the feet
  ctx.scale(v('body.sx'), v('body.sy'));           // squash and stretch from the feet
  ctx.fillStyle = '#f4b740';
  ctx.beginPath(); ctx.ellipse(0, -70, 80, 70, 0, 0, 7); ctx.fill();
  for (const x of [-28, 28]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(x, -90, 16, 16 * Math.max(0.08, v('eye.open')), 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#0f1c29';
    ctx.beginPath(); ctx.arc(x, -90, 6.5, 0, 7); ctx.fill();
  }
  ctx.restore();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  rig.update(dt);                                  // advance the rig
  ctx.clearRect(0, 0, 480, 360);
  draw(rig);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

You see a still blob. Everything from here on is added to `def`; the loop does not change.

## 2. A breath

```js
alive: { 'body.sy': [0.02, 2.8] },     // channel: [amplitude, period in seconds]
```

`alive` adds a slow wave to a channel. It is two sines at an irrational ratio with a random phase per rig, so it never
loops exactly and two characters never breathe in step.

## 3. A blink

A **clip** is keyframes on channels. Each key is `[time, value]`, with an optional third item for the easing into
that key (`'lin'`, `'io'` by default, `'in'`, `'out'`, `'back'` for an overshoot, `'hold'` for a step).

```js
clips: {
  blink: { dur: 0.16, tracks: { 'eye.open': [[0, 0], [0.07, -1], [0.16, 0]] } },
},
auto: { blink: [1.5, 4] },             // play it by itself every 1.5 to 4 seconds
```

`blink` is played as a **one-shot**: its values are offsets added on top of the pose. That is why the track goes
`0, -1, 0` rather than `1, 0, 1`: it closes the eye from wherever it is, then gives it back. You can fire any clip the
same way yourself with `rig.fire('blink')`.

## 4. A mood that follows the game

**Inputs** are how your game talks to the rig: plain numbers on `rig.inputs`. **States** say what plays for which
input. The simplest state is a clip name. A state can also be a blend of clips along an input:

```js
clips: {
  // ...
  calm:   { dur: 2, loop: true, tracks: { 'body.sy': [[0, 1], [1, 1.02], [2, 1]] } },
  scared: { dur: 0.4, loop: true, tracks: {
    'body.sy': [[0, 0.88], [0.2, 0.84], [0.4, 0.88]],
    'body.sx': [[0, 1.1], [0.4, 1.1]],
    brow:      [[0, 1], [0.4, 1]] } },
},
states: { mood: { blend: 'fear', clips: [[0, 'calm'], [1, 'scared']] } },
smooth: { fear: 6 },                   // how fast the blend follows its input, per second
```

A state's clip gives **values** (the body is 0.88 tall), unlike a one-shot's offsets. Add `brow: 0` to `rest`, draw
two brow lines when `v('brow')` is above zero, and drive the input from the game:

```js
// in frame(), before rig.update(dt)
const d = Math.hypot(pointer.x - 240, pointer.y - 220);
rig.inputs.fear = Math.max(0, Math.min(1, (170 - d) / 90));   // close pointer: fear goes to 1
```

The blob now tenses as the pointer approaches and relaxes as it leaves, with no step in between: `smooth` eases the
blend, and the breath and the blink keep playing on top.

When moods are distinct rather than a slider, use several states and a `machine` of transitions instead:

```js
states: { idle: 'calm', panic: 'scared' },
machine: [
  ['*', 'panic', (i) => i.fear > 0.6, 0.15],     // from any state, to panic, when, crossfade seconds
  ['panic', 'idle', (i) => i.fear < 0.3, 0.4],
],
```

## 5. Eyes that look

```js
rest: { /* ... */ 'eye.x': 0, 'eye.y': 0, 'head.rot': 0 },
look: { x: 'eye.x', y: 'eye.y', head: 'head.rot', range: 6, head_gain: 0.12 },
```

```js
rig.lookAt(dx / 200, dy / 200);        // direction to the target, each axis from -1 to 1
rig.lookAt(null);                      // no target: the gaze wanders by itself
```

Offset the pupils by `v('eye.x')`, `v('eye.y')` and rotate the face by `v('head.rot')`. The eyes reach the target
fast, the head follows slower, and small jumps of the eye keep it from looking glued.

## 6. A reaction

Something happened in the game. Tell the rig **what**, and let the definition say what that looks like:

```js
rest: { /* ... */ 'body.y': 0, 'tuft.rot': 0 },
clips: {
  // ...
  jump: { dur: 0.5, tracks: {
    'body.y':  [[0, 0], [0.18, -46, 'out'], [0.5, 0, 'in']],
    'body.sy': [[0, 0], [0.08, -0.2], [0.2, 0.15], [0.5, 0, 'back']] } },
},
springs: { 'tuft.rot': { k: 120, d: 6, gain: 0.1 } },
on: { poke: { fire: 'jump', kick: { 'tuft.rot': 14 }, mark: ['bang', 0.6] } },
```

```js
canvas.addEventListener('pointerdown', () => rig.event('poke'));
```

One call, three things:

- `fire` plays the `jump` one-shot (anticipation, hop, landing with an overshoot).
- `kick` throws a **spring**. A spring is secondary motion: the tuft wobbles and settles by itself. `k` is the
  stiffness, `d` the damping.
- `mark` adds an entry to `rig.marks` for 0.6 s. Marks are yours to draw (an "!", sweat drops, stars): each has a
  `name` and a `t` going from 0 to 1 over its life.

The game code says `poke`. How a poke looks lives in one place, and changing it never touches the game.

## 7. A mouth that changes

Some things are not numbers: a mouth shape, a held item, a damaged sprite. Those are **slots**, swapped by name.

```js
slots: { mouth: 'smile' },             // each slot and what it shows at the start
```

A clip can key a slot with a `slot:<name>` track. Add one to `scared` and one to `jump`:

```js
scared: { /* ... */ tracks: { /* ... */ 'slot:mouth': [[0, 'worry']] } },
jump:   { /* ... */ tracks: { /* ... */ 'slot:mouth': [[0, 'open']] } },
```

```js
const mouth = rig.slot('mouth');       // 'smile', 'worry' or 'open': draw that one
```

The mouth follows the mood, opens during a jump, and goes back by itself. Your game can also set it directly
(`rig.attach('mouth', 'smile')`), or for a moment over everything else (`rig.attach('mouth', 'ouch', 0.5)`).

## See it from the inside

Give the rig a name and open the page with `?rig` at the end of the URL:

```js
const rig = Rig.expose('blob', Rig.create(def));
```

The lab panel shows a slider for each input, a button for each state and one-shot, and what each slot shows and why.
It is the fastest way to tune a character: change a number in the definition, reload, drag the slider.

Mistakes in a definition do not fail silently either. After `Rig.create`, look at `rig.warnings`: a state that names
a clip that does not exist, a transition to an unknown state, a clip that keys an undeclared slot are all listed.

## Check it without looking

Move the definition to a file of its own and it can be played with no page at all:

```js
// blob.rig.mjs
export default { rest: { /* ... */ }, clips: { /* ... */ }, states: { /* ... */ } };
```

```sh
npx rig report blob.rig.mjs
```

```
blob: 6 s at 60 frames a second, seed 1, 0 script steps
pass    no mistake in the definition, every channel is a number on every frame
states  mood 6 s
played  calm (state), blink x2
moved   body.sy 0.981..1.037, eye.open 0.005..1, eye.x -1.821..2.756, eye.y -0.265..1.615, head.rot -0.036..0.055
slots   mouth: smile
note    Never played in this run: scared, jump (no state, input, event or script step played them).
note    Reactions never sent: poke (add { at, event } steps to the script to see them).
note    Channels of the rest pose that nothing moved: body.sx, body.x, body.y, brow, tuft.rot.
ok: 0 fails, 3 notes
```

Left alone for six seconds, the character breathed and blinked twice; nobody scared it or poked it, and the report says
so. A script says what happens during the run (`--script blob.script.json`):

```json
[
  { "at": 2, "inputs": { "fear": 1 } },
  { "at": 3, "event": "poke" }
]
```

Now `scared` and `jump` play, and the notes go. The command exits 1 when the definition has a mistake, so it fits a
test or a CI job, and it is how a coding agent, which cannot see the character, checks its own work:
[AGENTS.md](../AGENTS.md).

## Where to go next

- A second machine over the first one, such as a talking face over a walking body: [layers](api.md#layers).
- An arm that reaches a target without crossing the face: [constraints](api.md#constraints) and
  [examples/03-reach.html](../examples/03-reach.html).
- Footsteps and hit windows keyed in the animation: [clip events](api.md#clip-events) and
  [examples/04-walk.html](../examples/04-walk.html).
- Physics or gameplay code that owns the legs while the rig does the rest: [your own controller](api.md#your-own-controller).
- A crowd: [an audience](api.md#an-audience) and [examples/05-audience.html](../examples/05-audience.html).
- A long soft body from one picture: [meshes](api.md#meshes) and [examples/06-mesh.html](../examples/06-mesh.html).
