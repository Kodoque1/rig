// The ES module gives the same rig as the script: default export, named exports, same numbers.
import Rig, { create, bones, version } from '../rig.mjs';
import { createRequire } from 'node:module';
const cjs = createRequire(import.meta.url)('../rig.js');
const def = { rest: { 'a.x': 0 }, clips: { go: { dur: 1, loop: true, tracks: { 'a.x': [[0, 0], [0.5, 8], [1, 0]] } } }, states: { go: 'go' }, alive: { 'a.x': [0.5, 2] } };
const a = create(def, 3), b = cjs.create(def, 3);
for (let i = 0; i < 90; i++) { a.update(1 / 60); b.update(1 / 60); }
const ok = Rig.create === create && version === cjs.version && typeof bones.ik2 === 'function' && a.v('a.x') === b.v('a.x') && a.v('a.x') !== 0;
console.log(`${ok ? '  ok  ' : ' FAIL '} rig.mjs: default and named exports, the same pose as rig.js after 1.5 s (${a.v('a.x').toFixed(3)})`);
process.exit(ok ? 0 : 1);
