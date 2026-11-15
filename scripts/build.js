#!/usr/bin/env node
// Writes rig.mjs (the ES module) from rig.js (the source): the same code, exported instead of attached to the page.
// `npm run build` after an edit of rig.js; `npm test` fails when the two are out of step.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = fs.readFileSync(path.join(root, 'rig.js'), 'utf8');
const open = "})(typeof globalThis !== 'undefined' ? globalThis : this, function () {\n", a = src.indexOf(open), b = src.lastIndexOf('});');
if (a < 0 || b < 0) throw new Error('rig.js: the wrapper changed, update scripts/build.js');
const banner = src.slice(0, src.indexOf('*/') + 2).replace('<script src="rig.js"> gives window.Rig; require(\'./rig.js\') and import Rig from \'./rig.mjs\' work too.', 'This file is the ES module, generated from rig.js by `npm run build`: edit rig.js.');
const names = ['create', 'audience', 'ease', 'sample', 'bones', 'phys', 'mesh', 'lab', 'expose', 'report', 'version'];
const out = `${banner}\nconst Rig = (function () {\n${src.slice(a + open.length, b)}})();\nexport default Rig;\nexport const { ${names.join(', ')} } = Rig;\n`;
const file = path.join(root, 'rig.mjs');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== out) { console.error('rig.mjs is out of step with rig.js: run `npm run build`'); process.exit(1); }
  console.log('  ok   rig.mjs matches rig.js');
} else { fs.writeFileSync(file, out); console.log('rig.mjs written (' + out.length + ' bytes)'); }
