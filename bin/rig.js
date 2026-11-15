#!/usr/bin/env node
// rig report: a definition read back without a screen. It plays the definition for a few seconds in Node and says what moved,
// what played and what never did; it exits 1 when the definition has a mistake.
'use strict';
const fs = require('fs'),
  path = require('path'),
  { pathToFileURL } = require('url');
const Rig = require('../rig.js');

const HELP = `rig ${Rig.version}: a small animation rig for 2D characters that react.

  rig report <module> [options]   play a definition for a few seconds and read it back in text

  <module>          a file that exports the definition: export default { rest, clips, ... } (or module.exports)
  --export NAME     a named export instead of the default one
  --script FILE     what happens during the run, as JSON: [{ "at": 1, "event": "hit" }, { "at": 2, "inputs": { "fear": 1 } }]
                    a step may carry: event (+ data), inputs, fire, go, look ([x, y] or null), feed, set, attach, skin, kick
  --seconds 6       how long to play          --fps 60          --seed 1
  --json            the whole report as JSON (states, clips played, each channel's range, notes)
  --quiet           only the fails and the last line

Exit code: 0 when the definition has no mistake, 1 when it has one, 2 when the command could not run.
Docs: docs/api.md ("Without a screen"), AGENTS.md`;

const argv = process.argv.slice(2),
  FLAGS = new Set(['json', 'quiet', 'help', 'version']),
  opts = {},
  rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) {
    rest.push(a);
    continue;
  }
  const eq = a.indexOf('='),
    k = a.slice(2, eq < 0 ? undefined : eq);
  if (eq >= 0) opts[k] = a.slice(eq + 1);
  else if (FLAGS.has(k) || i + 1 >= argv.length) opts[k] = true;
  else opts[k] = argv[++i];
}
const fail = (msg) => {
  console.error('rig: ' + msg);
  process.exit(2);
};

(async () => {
  if (opts.version || rest[0] === 'version') return console.log(Rig.version);
  if (opts.help || !rest.length || rest[0] === 'help') return console.log(HELP);
  if (rest[0] !== 'report') fail(`no command "${rest[0]}"\n\n${HELP}`);
  if (!rest[1]) fail('rig report <module>: give the file that exports the definition');
  const file = path.resolve(rest[1]);
  if (!fs.existsSync(file)) fail(`no file at ${rest[1]}`);
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (e) {
    fail(
      `${rest[1]} could not be loaded in Node: ${e.message}\n` +
        'Keep the definition in a module of its own, with no page code around it (no document, no canvas).',
    );
  }
  const name = typeof opts.export === 'string' ? opts.export : null,
    def = name ? mod[name] : mod.default !== undefined ? mod.default : mod.def;
  if (!def || typeof def !== 'object')
    fail(
      name
        ? `${rest[1]} has no export named ${name}`
        : `${rest[1]} has no default export: write "export default { rest, clips, ... }", or pass --export NAME`,
    );
  let script = [];
  if (typeof opts.script === 'string') {
    try {
      script = JSON.parse(fs.readFileSync(path.resolve(opts.script), 'utf8'));
    } catch (e) {
      fail(`${opts.script} does not read as JSON: ${e.message}`);
    }
    if (!Array.isArray(script)) fail(`${opts.script} must be a list of steps: [{ "at": 1, "event": "hit" }]`);
  }
  const num = (k) => (opts[k] != null && opts[k] !== true && isFinite(+opts[k]) ? +opts[k] : undefined);
  const r = Rig.report(def, {
    name: path.basename(file).replace(/(\.rig)?\.[cm]?js$/, ''),
    seconds: num('seconds'),
    fps: num('fps'),
    seed: num('seed'),
    script,
  });
  if (opts.json) {
    const { text, ...data } = r;
    console.log(JSON.stringify(data, null, 1));
  } else if (opts.quiet) {
    const lines = r.text.split('\n');
    console.log(lines.filter((l, i) => l.startsWith('FAIL') || i === lines.length - 1).join('\n'));
  } else console.log(r.text);
  process.exitCode = r.ok ? 0 : 1; // never process.exit here: a long report written to a pipe would be cut
})().catch((e) => fail(e.message));
