// Compiled by `npm run test:types` (needs TypeScript): the declarations accept the README's quickstart.
import Rig, { create, RigDef } from '../rig';
const def: RigDef = {
  rest: { 'body.sy': 1, 'eye.open': 1 },
  clips: { blink: { dur: 0.16, tracks: { 'eye.open': [[0, 0], [0.07, -1], [0.16, 0]] } } },
  auto: { blink: [1.5, 4] },
  alive: { 'body.sy': [0.03, 2.8] },
  on: { poke: { fire: 'blink', kick: { 'tuft.rot': 12 }, mark: ['bang', 0.6] } },
  constraints: [{ ik: 'arm', bones: ['arm.a1', 'arm.a2'], lens: [20, 20], root: [0, 0], target: 'hand' }],
};
const r = create(def, 2);
r.update(1 / 60).lookAt(0.5, 0);
const n: number = r.v('body.sy');
Rig.expose('hero', r).event('poke', { scale: 2 });
const rep = Rig.report(def, { seconds: 2, script: [{ at: 1, event: 'poke' }, { at: 1.5, look: null }] });
const fine: boolean = rep.ok && rep.channels['body.sy'].moved && rep.never.clips.length === 0;
export { n, fine };
