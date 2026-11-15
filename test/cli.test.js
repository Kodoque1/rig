#!/usr/bin/env node
// The rig command, run as a user runs it: its output and its exit codes.
'use strict';
const { spawnSync } = require('child_process'),
  fs = require('fs'),
  os = require('os'),
  path = require('path');
const root = path.join(__dirname, '..'),
  bin = path.join(root, 'bin', 'rig.js');
const run = (...args) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
let bad = 0,
  n = 0;
const check = (name, ok, detail) => {
  n++;
  if (!ok) bad++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${!ok && detail ? ' - ' + detail : ''}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-cli-'));

const plain = run('report', 'examples/blob.rig.mjs');
check(
  'rig report: the example alone exits 0 and says what never played',
  plain.code === 0 && /^blob: 6 s/.test(plain.out) && /Never played in this run: scared, jump/.test(plain.out),
  plain.out + plain.err,
);
const scripted = run('report', 'examples/blob.rig.mjs', '--script', 'examples/blob.script.json');
check(
  'rig report --script: the poke plays the jump once, the input brings the scared clip in, one note is left',
  scripted.code === 0 &&
    /jump x1/.test(scripted.out) &&
    /scared \(state\)/.test(scripted.out) &&
    /ok: 0 fails, 1 note/.test(scripted.out),
  scripted.out,
);
const json = run(
  'report',
  'examples/blob.rig.mjs',
  '--script',
  'examples/blob.script.json',
  '--json',
  '--seconds',
  '5',
);
let data = null;
try {
  data = JSON.parse(json.out);
} catch (e) {
  /* reported below */
}
check(
  'rig report --json: the report as data, with the options read',
  json.code === 0 &&
    data &&
    data.ok === true &&
    data.seconds === 5 &&
    data.played.jump.shots === 1 &&
    !('text' in data),
  json.out.slice(0, 300),
);
fs.writeFileSync(
  path.join(tmp, 'broken.rig.cjs'),
  "module.exports = { clips: { a: { dur: 1, tracks: {} } }, states: { idle: 'nope' }, on: { hit: 'ouch' } };\n",
);
const broken = run('report', path.join(tmp, 'broken.rig.cjs'), '--quiet');
check(
  'rig report: a definition with names that point nowhere exits 1, and --quiet keeps the fails and the last line',
  broken.code === 1 &&
    broken.out.trim().split('\n').length === 3 &&
    /^FAIL/.test(broken.out) &&
    /not ok: 2 fails/.test(broken.out),
  broken.out,
);
fs.writeFileSync(path.join(tmp, 'named.mjs'), 'export const hero = { rest: { a: 1 }, alive: { a: [0.1, 2] } };\n');
const named = run('report', path.join(tmp, 'named.mjs'), '--export', 'hero'),
  missing = run('report', path.join(tmp, 'named.mjs')),
  none = run('report', 'nope.mjs'),
  help = run();
check(
  'rig report: a named export with --export, and exit 2 with a sentence for no default export, no file, no such command',
  named.code === 0 &&
    /a 0\.\d+\.\.1\.\d+/.test(named.out) &&
    missing.code === 2 &&
    /no default export/.test(missing.err) &&
    none.code === 2 &&
    /no file at nope\.mjs/.test(none.err) &&
    help.code === 0 &&
    /rig report <module>/.test(help.out) &&
    run('dance').code === 2,
  named.out + missing.err + none.err,
);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `${bad} of ${n} checks FAILED` : `${n} checks pass`);
process.exit(bad ? 1 : 0);
