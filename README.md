# rig.js

A small animation rig for 2D characters that react. One file, no dependency, any renderer.

**[Try it in the playground](https://kodoque1.github.io/rig/)**: the definition on one side, the character on the other.

**Made to be used by a coding agent** as much as by a person: a character is plain data an agent can write, and
`rig report` plays it without a screen and reads it back in text, so an agent that cannot see the animation can still
check it. Point your agent at [AGENTS.md](AGENTS.md).

You describe a character as data: a rest pose, a few keyframed clips, and what makes it change. The rig computes the
numbers each frame. You draw them with whatever you already draw with: canvas, SVG, WebGL, Pixi, the DOM.

```js
const rig = Rig.create({
  rest:  { 'body.sy': 1, 'eye.open': 1 },                                  // named channels: any name, any number
  clips: { blink: { dur: 0.16, tracks: { 'eye.open': [[0, 0], [0.07, -1], [0.16, 0]] } } },
  auto:  { blink: [1.5, 4] },                                              // blink every 1.5 to 4 s
  alive: { 'body.sy': [0.03, 2.8] },                                       // a breath that never loops the same
});

function frame(dt) {
  rig.update(dt);                       // 1. advance the rig (dt in seconds)
  drawBody(rig.v('body.sy'));           // 2. read the pose and draw
  drawEyes(rig.v('eye.open'));
}
```

That is a character that breathes and blinks, with no timer in your code. Run it: [examples/01-hello.html](examples/01-hello.html).

## Why

Most of what makes a game character feel alive is small and reactive: it flinches before the hit, looks at what
matters, wobbles after a jump, never blinks in step with its neighbour. Writing that by hand means timers and flags
spread through the game code. Tools like Spine and Rive solve it with an editor, a file format and a runtime.

rig.js sits in between: the ideas of those tools (state machines, blends, additive one-shots, slots, IK, clip events,
meshes) as plain data in your source, in one readable file (30 KB minified, 12 KB gzipped). There is no editor and no file format. The
drawing stays in your code, so your art style is untouched.

It fits when your characters are drawn in code or assembled from a few sprites. It is not a replacement for a
full skeletal pipeline with an artist-facing editor.

## Install

Copy one file, or install from GitHub.

```html
<script src="rig.js"></script>          <!-- gives window.Rig -->
```

```sh
npm install github:Kodoque1/rig
```

```js
import Rig from '@kodoque1/rig';        // ES module (rig.mjs), with types
const Rig = require('@kodoque1/rig');   // CommonJS (rig.js)
```

It runs anywhere JavaScript runs. The rig touches no DOM (only the optional lab panel does), so it also runs in Node
and in a worker, which is how its tests run.

## The five ideas

| Idea | In the definition | What it gives |
|---|---|---|
| Channels | `rest: { 'body.sy': 1 }` | The pose: named numbers you read with `rig.v(name)`. |
| Clips | `clips: { blink: { dur, tracks } }` | Keyframes on channels. |
| States | `states`, `machine`, `inputs` | What plays now. Your game sets inputs; states crossfade or blend. |
| One-shots | `rig.fire('blink')`, `auto`, `on` | Clips played once, added on top of whatever is playing. |
| Motion for free | `alive`, `springs`, `look` | A breath, parts that wobble, eyes that follow a target. |

The [tutorial](docs/tutorial.md) builds one character through all five in about 60 lines.

## What else is in the file

Each line links to its section in the [API reference](docs/api.md).

- [Events and reactions](docs/api.md#events-and-reactions): `rig.event('hit')` runs what the definition says a hit does: a one-shot, a spring kick, a mark to draw, a state change.
- [Varied takes](docs/api.md#varied-takes): one of several reactions, never the same twice in a row.
- [Layers](docs/api.md#layers): a second state machine added on top, such as a face over a body.
- [Slots and draw order](docs/api.md#slots-and-draw-order): whole drawings swapped by name (a mouth shape, a held item), and parts that pass in front of each other.
- [Constraints](docs/api.md#constraints): two-bone IK with obstacle avoidance, aim, copy, and follow-a-path. See [examples/03-reach.html](examples/03-reach.html).
- [Clip events](docs/api.md#clip-events): a footstep or a hit window keyed in the clip, fired exactly once at any frame rate. See [examples/04-walk.html](examples/04-walk.html).
- [Your own controller](docs/api.md#your-own-controller): when physics or gameplay code owns some channels, the rig expresses the rest and never fights it.
- [An audience](docs/api.md#an-audience): a crowd that reacts in a ripple, looks at what happened and remembers it. See [examples/05-audience.html](examples/05-audience.html).
- [Meshes](docs/api.md#meshes): one picture bent by bones. See [examples/06-mesh.html](examples/06-mesh.html).
- [A body that weighs](docs/api.md#a-body-that-weighs): a small solver that poses a body from gravity and what holds it.
- [Without a screen](docs/api.md#without-a-screen): `Rig.report` and `rig report` play a definition in Node and read it back in text.
- [The lab](docs/api.md#the-lab): add `?rig` to your page's URL for a live panel with every input, state and one-shot.

## With a coding agent

An agent can write a definition, but it cannot watch the result. `rig report` is its eyes: it plays the definition in
Node and says what moved, what played and what never did, with an exit code.

```sh
npx rig report hero.rig.mjs --script hero.script.json     # add --json for data
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

[AGENTS.md](AGENTS.md) is the library in one page for an agent: the loop above, the definition block by block, the
mistakes that cost a round, and five lines to paste into your project's own agent instructions. It ships in the
package (`node_modules/@kodoque1/rig/AGENTS.md`). The same report works in a test: `Rig.report(def, { script }).ok`.

## Examples and playground

[The playground](https://kodoque1.github.io/rig/) is the tutorial as a live editor: the definition on one side, the
character on the other, and every channel the rig outputs traced underneath. It is
[playground/index.html](playground/index.html) in this repository, and opens from disk too.

The files in `examples/` are live as well
([hello](https://kodoque1.github.io/rig/examples/01-hello.html),
[character](https://kodoque1.github.io/rig/examples/02-character.html),
[reach](https://kodoque1.github.io/rig/examples/03-reach.html),
[walk](https://kodoque1.github.io/rig/examples/04-walk.html),
[audience](https://kodoque1.github.io/rig/examples/05-audience.html),
[mesh](https://kodoque1.github.io/rig/examples/06-mesh.html)) and open straight from disk. Each is one self-contained
page.

| File | Shows |
|---|---|
| [01-hello.html](examples/01-hello.html) | The quickstart above: a breath and a blink. |
| [02-character.html](examples/02-character.html) | The tutorial's result: mood blend, gaze, a poke reaction, a spring, a mouth slot. |
| [03-reach.html](examples/03-reach.html) | Two arms reaching a target with IK, avoiding the head. |
| [04-walk.html](examples/04-walk.html) | Footsteps as clip events, a walk that hands over to a run. |
| [05-audience.html](examples/05-audience.html) | 28 watchers, varied takes, memory. |
| [06-mesh.html](examples/06-mesh.html) | A picture on a mesh, bent by five bones. |

## Good to know

- **Deterministic.** A rig's randomness (blink times, take choice, gaze jumps) comes from its own seeded generator: `Rig.create(def, seed)`. The same seed and the same `update(dt)` calls give the same pose. It never touches `Math.random`.
- **Read-only toward your game.** The rig only writes its own pose. Turning it off cannot change a game's outcome.
- **Typos are reported.** `rig.warnings` lists a state that names a missing clip, a transition to a state that does not exist, a clip that keys an undeclared slot.
- **Any frame rate.** Springs and the gaze use fixed sub-steps; clip events fire once each however long the frame.

## Develop

```sh
npm test            # the checks, in plain Node, no dependency (the library, the module, the command)
npm run build       # regenerate rig.mjs after editing rig.js
```

`rig.js` is the source. `rig.mjs` is generated from it and checked by the tests.

## Licence

MIT. See [LICENSE](LICENSE).
