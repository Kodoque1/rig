#!/usr/bin/env node
// rig.js's checks: `npm test` (plain Node, no dependency). Each check builds a small rig, plays it and measures the result;
// it prints "ok" or "FAIL" with what it measured, and the run exits 1 when one fails.
'use strict';
const path = require('path');
const Rig = (global.Rig = require(process.env.RIG_FILE ? path.resolve(process.env.RIG_FILE) : '../rig.js'));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${!ok && detail ? ' - ' + detail : ''}`);
  return ok;
}
const page = { evaluate: async (fn) => fn() };   // each block below is self-contained: it only reads Rig
const warn = console.warn, warned = [];
console.warn = (...a) => warned.push(a.join(' '));   // the rig warns once on purpose in one check: keep the output readable
(async () => {
    const r = await page.evaluate(() => {
      const def = { rest: { 'a.x': 0, 'b.y': 1 }, clips: { idle: { dur: 1, loop: true, tracks: { 'a.x': [[0, 0], [1, 0]] } }, run: { dur: 1, loop: true, tracks: { 'a.x': [[0, 10], [1, 10]] } },
        blink: { dur: .2, tracks: { 'b.y': [[0, 0], [.1, -1], [.2, 0]] } } }, states: { idle: 'idle', run: 'run' }, machine: [['*', 'run', i => i.go > .5, .2]], springs: { 's.r': { k: 160, d: 8, gain: 1 } } };
      const R = Rig.create(def, 1), o = {};
      R.inputs.go = 1; R.update(.1); o.mid = R.v('a.x'); R.update(.3); o.end = R.v('a.x'); o.state = R.state;
      R.fire('blink'); R.update(.1); o.blinkMid = R.v('b.y'); R.update(.2); o.blinkEnd = R.v('b.y'); o.blinking = R.playing('blink');
      R.kick('s.r', 4); let peak = 0; for (let i = 0; i < 180; i++) { R.update(1 / 60); peak = Math.max(peak, Math.abs(R.v('s.r'))); } o.peak = peak; o.rest = Math.abs(R.v('s.r'));
      o.log = R.log.join(',');
      const first = seed => { const x = Rig.create(Object.assign({}, def, { auto: { blink: [.5, 2] } }), seed); for (let t = 0; t < 3; t += 1 / 60) { x.update(1 / 60); if (x.log.includes('!blink')) return +t.toFixed(2); } return null; };
      o.blinkAt = [first(1), first(2)];
      const B = Rig.bones, fk = B.chain([0, 0], [{ joint: 'a', len: 10 }, { joint: 'b', len: 10 }], { a: 0, b: Math.PI / 2 }).pts[2];
      const F = B.follower(['a']); F.step({ a: 0 }, 0); let prev = 0, mono = true, fast = 0;
      for (let i = 0; i < 120; i++) { const x = F.step({ a: 1 }, 1 / 60, 16, 3).a; if (x < prev - 1e-9 || x > 1 + 1e-6) mono = false; fast = Math.max(fast, (x - prev) * 60); prev = x; }
      o.bones = { end: fk.map(v => +v.toFixed(6)), settled: +prev.toFixed(4), mono, fast: +fast.toFixed(2), mix: B.mix({ a: 0 }, { a: 2 }, .25).a };
      return o;
    });
    check(`the state machine crossfades (${r.mid.toFixed(1)} halfway, ${r.end} at the end), a one-shot plays and ends, a spring settles, the log records both`,
      r.mid > 0 && r.mid < 10 && Math.abs(r.end - 10) < 1e-6 && r.state === 'run' && Math.abs(r.blinkMid) < .05 && Math.abs(r.blinkEnd - 1) < 1e-6 && !r.blinking && r.peak > .01 && r.rest < .01 && /run/.test(r.log) && /!blink/.test(r.log), JSON.stringify(r));
    check('two characters with different seeds do not blink in step', r.blinkAt[0] != null && r.blinkAt[1] != null && r.blinkAt[0] !== r.blinkAt[1], JSON.stringify(r.blinkAt));
    const b = r.bones;
    check('bones: the chain puts each joint at the end of its parent bone, the follower reaches its pose without overshoot or snapping (speed cap kept), poses blend',
      b.end[0] === 10 && b.end[1] === 10 && Math.abs(b.settled - 1) < .01 && b.mono && b.fast <= 3 + 1e-6 && Math.abs(b.mix - .5) < 1e-9, JSON.stringify(b));
    const a = await page.evaluate(() => {   // 2.6: the alive layer
      const o = {}, def = { rest: { 'a.x': 0, 'f.y': 0, 'b.s': 1, 'e.x': 0, 'h.r': 0 },
        clips: { calm: { dur: 1, loop: true, tracks: { 'a.x': [[0, 0], [1, 0]] } }, scared: { dur: 1, loop: true, tracks: { 'a.x': [[0, 10], [1, 10]] } },
          smile: { dur: 1, loop: true, tracks: { 'f.y': [[0, 2], [1, 2]] } }, none: { dur: 1, loop: true, tracks: {} } },
        states: { mood: { blend: 'fear', clips: [[0, 'calm'], [1, 'scared']] } }, smooth: { fear: 1000 },
        layers: [{ states: { none: 'none', smile: 'smile' }, machine: [['*', 'smile', i => i.happy > .5, 0]], weight: 1 }],
        alive: { 'b.s': [.03, 3] }, look: { x: 'e.x', head: 'h.r', range: 4, head_gain: .5, saccade: [100, 200] } };
      const R = Rig.create(def, 3);
      R.inputs.fear = .5; R.update(.05); o.blendHalf = +R.v('a.x').toFixed(3);
      R.inputs.happy = 1; R.update(.05); o.layered = [+R.v('a.x').toFixed(3), +R.v('f.y').toFixed(3)];
      const breath = []; for (let i = 0; i < 400; i++) { R.update(.025); breath.push(R.v('b.s')); }
      o.breathMoves = Math.max(...breath) - Math.min(...breath) > .02; o.breathNoLoop = Math.abs(breath[399] - breath[279]) > 1e-4;   // 3 s apart: never the same
      const G = Rig.create(def, 4); G.lookAt(1, 0); let eye30 = 0, head30 = 0;
      for (let i = 0; i < 60; i++) { G.update(1 / 60); if (i === 9) { eye30 = G.v('e.x'); head30 = G.v('h.r') / .5; } }
      o.look = { eyeAt150ms: +(eye30 / 4).toFixed(2), headAt150ms: +head30.toFixed(2), eyeEnd: +(G.v('e.x') / 4).toFixed(2), headEnd: +(G.v('h.r') / .5).toFixed(2) };
      return o;
    });
    check(`alive: a blend follows its input (${a.blendHalf} at fear .5), a layer adds on top (${a.layered.join(', ')}), the breath moves and never loops the same`,
      Math.abs(a.blendHalf - 5) < .01 && Math.abs(a.layered[0] - 5) < .01 && Math.abs(a.layered[1] - 2) < .01 && a.breathMoves && a.breathNoLoop, JSON.stringify(a));
    check(`gaze: the eyes reach the target fast and the head follows slower (150 ms: eyes ${a.look.eyeAt150ms}, head ${a.look.headAt150ms}; 1 s: ${a.look.eyeEnd}, ${a.look.headEnd})`,
      a.look.eyeAt150ms > .8 && a.look.headAt150ms < a.look.eyeAt150ms && a.look.eyeEnd > .95 && a.look.headEnd > .9, JSON.stringify(a.look));
    const ct = await page.evaluate(() => {   // 3.0: a controller under the rig, through the contract (feed/sense, events/on, owns/set, drive)
      const def = { rest: { 'leg.l': 0, 'arm.swing': 0, 'arm.stiff': 40, 'brow': 0, 'hat.rot': 0 }, inputs: { fear: 0 },
        clips: { calm: { dur: 1, loop: true, tracks: { 'brow': [[0, 0]], 'arm.stiff': [[0, 40]] } }, tense: { dur: 1, loop: true, tracks: { 'brow': [[0, 1]], 'arm.stiff': [[0, 200]] } },
          fallen: { dur: 1, loop: true, tracks: { 'arm.stiff': [[0, 0]] } }, startle: { dur: .3, tracks: { 'brow': [[0, 0], [.1, 1], [.3, 0]] } },
          stomp: { dur: .5, tracks: { 'leg.l': [[0, 0], [.25, 2], [.5, 0]] } } },
        states: { walk: { blend: 'fear', clips: [[0, 'calm'], [1, 'tense']] }, fallen: 'fallen' }, machine: [], smooth: { fear: 1000 },
        sense: { fear: { from: 'balance', range: [1, 0] } }, on: { fall: { go: 'fallen', fire: 'startle', fade: 0 }, bump: { kick: { 'hat.rot': 5 }, gap: .5 } },
        springs: { 'hat.rot': { k: 120, d: 6 }, 'leg.l': { k: 50, d: 2 } }, alive: { 'leg.l': [.3, 2] }, owns: ['leg.*'], drive: { arms: { target: 'arm.swing', gain: 'arm.stiff' } } };
      const R = Rig.create(def, 3), o = {};
      R.feed({ balance: .25, speed: 1 }); R.update(1 / 60); R.update(1 / 60); o.fear = +R.inputs.fear.toFixed(2); o.gain = +R.drives().arms.gain.toFixed(1);
      R.set({ 'leg.l': .7, 'brow': 9 }); R.fire('stomp'); let leg = []; for (let i = 0; i < 20; i++) { R.update(1 / 60); leg.push(R.v('leg.l')); }
      o.leg = [...new Set(leg)]; o.brow = R.v('brow') !== 9; R.set({ brow: 8 }); o.warnings = R.warnings.length; o.loud = R.warnings.filter(w => /^set\(brow\)/.test(w)).length === 1;
      o.bump = [R.event('bump'), R.event('bump')]; R.update(.2); o.hat = Math.abs(R.v('hat.rot')) > .01; o.unknown = R.event('nothing');
      o.fall = R.event('fall'); R.update(1 / 60); o.state = R.state; o.limp = R.drives().arms.gain; o.log = R.log.slice(-4).join(',');
      return o;
    });
    check(`controller contract: a fed signal drives an input (balance .25 -> fear ${ct.fear}, arm stiffness ${ct.gain} asked of the controller), the controller's own channels pass through untouched (${ct.leg.join(', ')}) whatever the clips, springs and breath, a set on a channel it does not own is dropped and warned once, events start reactions once per gap, and the rig never writes back`,
      ct.fear === .75 && ct.gain > 150 && ct.gain < 170 && ct.leg.length === 1 && ct.leg[0] === .7 && ct.brow && ct.warnings === 3 && ct.loud && ct.bump[0] && !ct.bump[1] && ct.hat && !ct.unknown && ct.fall && ct.state === 'fallen' && ct.limp === 0 && /@fall/.test(ct.log), JSON.stringify(ct));
    const ca = await page.evaluate(() => {   // 3.1 cartoon acting: snap and hold, alternating kicks, marks, held poses (skin-agnostic)
      const def = { rest: { brow: 0, 'face.asym': 0, leg: 0 }, owns: ['leg'], inputs: { fear: 0 },
        clips: { calm: { dur: 1, loop: true, tracks: { brow: [[0, 0]] } }, scared: { dur: 1, loop: true, tracks: { brow: [[0, 1]] } } },
        states: { walk: { blend: 'fear', clips: [[0, 'calm'], [1, 'scared']] }, teeter: 'scared' }, smooth: { fear: 200 },
        snap: { brow: .3, leg: .1 }, springs: { 'face.asym': { k: 40, d: 5 } }, hold: 10, markStates: { teeter: ['sweat', .5] },
        on: { scare: { kick: { 'face.asym': 5 }, alt: true, mark: ['bang', .4] }, edge: { go: 'teeter' } } };
      const R = Rig.create(def, 3), o = {}, run = n => { for (let i = 0; i < n; i++) R.update(1 / 60); };
      run(1); R.inputs.fear = 1; run(2); o.past = R.pose.brow > 1; run(6); o.hold = R.pose.brow > 1.05; run(60); o.settle = Math.abs(R.pose.brow - 1) < .02;
      R.event('scare'); R.update(.05); const a1 = R.pose['face.asym']; run(120); R.event('scare'); R.update(.05); const a2 = R.pose['face.asym'];
      o.alt = Math.abs(a1) > .05 && Math.sign(a1) === -Math.sign(a2); o.mark = R.marks.some(m => m.name === 'bang'); run(40); o.markGone = !R.marks.some(m => m.name === 'bang');
      R.event('edge'); run(61); o.sweat = R.marks.some(m => m.name === 'sweat');
      const h0 = R.held; R.update(1 / 60); o.heldKept = R.held === h0; run(6); o.heldNew = R.held !== h0;
      R.set({ leg: .4 }); R.update(1 / 60); o.leg = R.pose.leg; return o;
    });
    check('cartoon acting: a big change snaps past its target and holds before settling, alt kicks change side, marks live their life and a state keeps its own, held poses refresh at their rate, and snap never touches the controller\'s channels',
      ca.past && ca.hold && ca.settle && ca.alt && ca.mark && ca.markGone && ca.sweat && ca.heldKept && ca.heldNew && ca.leg === .4, JSON.stringify(ca));
    const ta = await page.evaluate(() => {   // 3.2: varied takes, an audience that ripples, looks, remembers, and reads the player's habit
      const shot = dur => ({ dur, tracks: { brow: [[0, 0], [dur / 2, 1], [dur, 0]] } });
      const def = { rest: { brow: 0 }, clips: { idle: { dur: 1, loop: true, tracks: {} }, jolt: shot(.2), double: shot(.2), melt: shot(.2), deadpan: shot(.2), pointL: shot(.2), pointR: shot(.2) },
        states: { idle: 'idle' }, look: { x: 'eye.x' },
        on: { hit: { take: ['jolt', 'double', { clip: 'melt', when: d => d.big }, 'deadpan'] }, gasp: { take: [{ clip: 'pointL', when: d => d.dx < 0 }, { clip: 'pointR', when: d => d.dx > 0 }] } } };
      const o = {}, R = Rig.create(def, 5), seq = [];
      for (let i = 0; i < 40; i++) { R.event('hit', { big: i % 2 }); seq.push(R.lastTake.hit); R.update(.3); }
      o.repeats = seq.filter((t, i) => i && t === seq[i - 1]).length; o.kinds = [...new Set(seq)].sort().join(','); o.meltOnlyBig = seq.every((t, i) => t !== 'melt' || i % 2);
      o.fired = R.log.some(l => /^!(jolt|double|melt|deadpan)$/.test(l));
      const A = Rig.audience({ speed: 100, jitter: 0, look: .5 }), near = Rig.create(def, 1), far = Rig.create(def, 2);
      const mover = Rig.create(def, 3); A.add(near, 10, 0); A.add(far, -300, 0); const mm = A.add(mover, 100, 0); A.react(0, 0, 'gasp'); A.move(mm, -100, 0);
      const at = {}; for (let t = 0; t < 4; t += .05) { A.update(.05); [near, far].forEach((r, i) => { r.update(.05); if (at[i] == null && r.log.some(l => l === '@gasp')) at[i] = +t.toFixed(2); }); }
      o.ripple = [at[0], at[1]]; o.points = [near.lastTake.gasp, far.lastTake.gasp, mover.lastTake.gasp];
      o.wary = +near.inputs.wary.toFixed(2); for (let i = 0; i < 400; i++) A.update(.25); o.waryLater = +near.inputs.wary.toFixed(3); o.lookFreed = !near.look.on;
      const H = Rig.audience({ habitLife: 40 }), reads = []; for (let i = 0; i < 12; i++) { H.update(1); reads.push(H.habit('left')); }
      for (let i = 0; i < 60; i++) { H.update(1); H.habit(['up', 'down', 'right'][i % 3]); } reads.push(H.habit('rare'));
      o.habit = [reads[0], reads[11], reads[12]];
      return o;
    });
    check(`takes and audience: a varied take never repeats in a row (${ta.kinds}) and follows its context, the audience reacts in a ripple (near ${ta.ripple[0]} s, far ${ta.ripple[1]} s) pointing the right way from where each watcher stands when it hears, remembers (wary ${ta.wary}, ${ta.waryLater} later) and reads the player's habit (${ta.habit.join(', ')})`,
      ta.repeats === 0 && ta.kinds === 'deadpan,double,jolt,melt' && ta.meltOnlyBig && ta.fired && ta.ripple[0] < .3 && ta.ripple[1] > 2.5 && ta.points[0] === 'pointL' && ta.points[1] === 'pointR' && ta.points[2] === 'pointR' && ta.wary > .2 && ta.waryLater < .05 && ta.lookFreed && ta.habit.join() === 'new,stale,fresh', JSON.stringify(ta));
    const sl = await page.evaluate(() => {   // 3.3: slots and attachments (who wins, timed, skins, hand-offs) and draw order by depth
      const def = { rest: { 'armL.z': 0 }, slots: { mouth: 'smile', hand: null, hat: 'cap', brow: 'flat' }, skins: { king: { hat: 'crown' } },
        order: { armL: -1, armR: -1, body: 0, head: 1 },
        clips: { calm: { dur: 1, loop: true, tracks: { 'slot:brow': [[0, 'flat']] } }, glad: { dur: 1, loop: true, tracks: { 'slot:brow': [[0, 'up']] } },
          talk: { dur: .4, loop: true, tracks: { 'slot:mouth': [[0, 'a'], [.2, 'b']] } }, quiet: { dur: 1, loop: true, tracks: {} },
          eat: { dur: .6, tracks: { 'armL.z': [[0, 0], [.05, 2.5, 'hold'], [.55, 0, 'hold']], 'slot:hand': [[0, 'apple'], [.3, 'core'], [.5, null]], 'slot:mouth': [[0, 'chomp']] } },
          gasp: { dur: .3, tracks: { 'slot:mouth': [[0, 'o']] } }, bad: { dur: .2, tracks: { 'slot:nose': [[0, 'x']] } } },
        states: { mood: { blend: 'joy', clips: [[0, 'calm'], [1, 'glad']] } }, smooth: { joy: 1e4 },
        layers: [{ states: { quiet: 'quiet', talk: 'talk' }, machine: [['quiet', 'talk', i => i.talk > .5, 0], ['talk', 'quiet', i => i.talk < .5, 0]], weight: 1 }],
        on: { hit: { attach: { mouth: ['ouch', .3] } } } };
      const R = Rig.create(def, 1), o = {}, run = n => { for (let i = 0; i < n; i++) R.update(1 / 60); };
      o.warn = R.warnings.some(w => /slot:nose/.test(w)); run(1); o.start = [R.slot('mouth'), R.slot('hand'), R.slot('hat')].join(',');
      R.inputs.talk = 1; run(2); o.layer = R.slot('mouth') + ' ' + R.slotFrom.mouth; run(14); o.stepped = R.slot('mouth');
      R.fire('eat'); run(4); o.shot = R.slot('mouth') + ' ' + R.slot('hand') + ' ' + R.slotFrom.hand; o.armFront = R.drawOrder().join(',');
      const kept = R.slots; R.attach('hand', 'cup'); o.underClip = R.slot('hand'); o.snapshotKept = kept.hand === 'apple';
      run(16); o.keyed = R.slot('hand'); R.fire('gasp'); run(1); o.lastFired = R.slot('mouth'); R.event('hit'); run(1); o.timed = R.slot('mouth') + ' ' + R.slotFrom.mouth;
      R.inputs.talk = 0; R.attach('mouth', 'grin'); run(1); o.timedKept = R.slot('mouth'); run(30); o.after = R.slot('hand') + ' ' + R.slot('mouth'); o.armBack = R.drawOrder().join(',');
      R.skin('king'); run(1); o.skin = R.slot('hat'); o.depth = R.depths().map(d => d[0] + d[1]).join(',');
      let flips = 0, prev = null; for (let i = 0; i < 120; i++) { R.inputs.joy = .5 + (i % 2 ? .04 : -.04); run(1); if (prev && R.slot('brow') !== prev) flips++; prev = R.slot('brow'); }
      o.midFlips = flips; R.inputs.joy = 1; run(2); o.glad = R.slot('brow'); return o;
    });
    check(`slots and draw order: a clip keys a slot in steps, the game's attach < the state < a layer < one-shots (last fired) < a timed attach that ends by itself, an attach under a keyed clip waits for the clip, skins swap a set, a blend at its midpoint does not flicker (${sl.midFlips} flips), and a z key brings an arm in front (${sl.armFront})`,
      sl.warn && sl.start === 'smile,,cap' && sl.layer === 'a layer0:talk' && sl.stepped === 'b' && sl.shot === 'chomp apple shot:eat' && sl.armFront === 'armR,body,head,armL' &&
      sl.underClip === 'apple' && sl.snapshotKept && sl.keyed === 'core' && sl.lastFired === 'o' && sl.timed === 'ouch timed' && sl.timedKept === 'ouch' && sl.after === 'cup grin' &&
      sl.armBack === 'armL,armR,body,head' && sl.skin === 'crown' && sl.depth === 'armL-1,armR-1,body0,head1' && sl.midFlips === 0 && sl.glad === 'up', JSON.stringify(sl));
    const cs = await page.evaluate(() => {   // 3.4: constraints (ik, aim, copy, path), an ik's mix channel letting go, and repulsion
      const o = {}, B = Rig.bones, end = (R, a, b, l) => B.chain([0, 0], [{ joint: 'a', len: l[0] }, { joint: 'b', len: l[1] }], { a: R.v(a), b: R.v(b) }).pts[2];
      const pts = [[0, 0], [100, 0], [100, 100], [0, 100]];
      const R = Rig.create({ rest: { a1: 0, a2: 0, h: 0, hair: 0, 'body.rot': .3, ikm: 1, held: .7 }, owns: ['held'], clips: { i: { dur: 1, loop: true, tracks: {} }, off: { dur: .5, tracks: { ikm: [[0, 0], [.05, -1], [.5, -1]] } } }, states: { i: 'i' },
        constraints: [{ ik: 'arm', bones: ['a1', 'a2'], lens: [36, 32], root: [0, 0], target: 'hand', mix: 'ikm' }, { aim: 'h', root: [0, -50], target: 'look', limit: [-.5, .5] },
          { copy: 'hair', from: 'body.rot', scale: -.5 }, { path: 'bird', points: pts, closed: true, at: .25 }, { copy: 'held', from: 'body.rot' }] }, 1);
      R.target('hand', 40, 10); R.target('look', 0, -150); R.set({ held: .7 }); R.update(1 / 60);
      const q = end(R, 'a1', 'a2', [36, 32]); o.ikErr = +Math.hypot(q[0] - 40, q[1] - 10).toFixed(3); o.aim = +R.v('h').toFixed(2); o.copy = +R.v('hair').toFixed(2);
      o.path = [R.v('bird.x'), R.v('bird.y')].map(v => Math.round(v)).join(','); o.owned = R.v('held');
      R.target('hand', 200, 0); R.update(1 / 60); o.far = R.reach.arm > 1 && Math.abs(R.v('a1')) < .01 && Math.abs(R.v('a2')) < .01;
      R.fire('off'); for (let i = 0; i < 10; i++) R.update(1 / 60); const before = R.v('a1'); R.target('hand', 0, 60); R.update(1 / 60); R.update(1 / 60); o.letGo = Math.abs(R.v('a1') - before) < 1e-6;
      // repulsion: a circle on the elbow sends it to the other side over a swing, the end still on its target; a dodge is capped
      const mk = (av, dodge) => Rig.create({ rest: { a1: 0, a2: 0 }, clips: { i: { dur: 1, loop: true, tracks: {} } }, states: { i: 'i' },
        constraints: [{ ik: 'arm', bones: ['a1', 'a2'], lens: [20, 20], root: [0, 0], target: 'hand', bend: 1, avoid: av, dodge }] }, 1);
      const elbowY = A => Math.sin(A.v('a1')) * 20;
      const A0 = mk(null); A0.target('hand', 30, 0); A0.update(1 / 60); const e0 = [Math.cos(A0.v('a1')) * 20, elbowY(A0)];
      const A = mk([{ at: e0, r: 8 }]); A.target('hand', 30, 0); const ys = []; for (let i = 0; i < 20; i++) { A.update(1 / 60); ys.push(elbowY(A)); }
      const qa = end(A, 'a1', 'a2', [20, 20]); o.side = A.elbow.arm; o.swing = ys.filter(y => Math.abs(y) < Math.abs(e0[1]) - 1).length; o.settled = +Math.hypot(qa[0] - 30, qa[1]).toFixed(3);
      o.crossBefore = +(e0[1] < 0) && 1; o.crossAfter = +A.cross.arm.toFixed(2);
      const D = mk([{ at: [30, 0], r: 10 }], 6); D.target('hand', 32, 0); for (let i = 0; i < 5; i++) D.update(1 / 60); o.dodge = +D.dodge.arm.toFixed(2);
      const Hh = mk([{ at: [15, 0], r: 3 }]); let flips = 0, last = null; for (let i = 0; i < 120; i++) { Hh.target('hand', 30, Math.sin(i / 5) * .5); Hh.update(1 / 60); if (last != null && Hh.elbow.arm !== last) flips++; last = Hh.elbow.arm; }
      o.flips = flips;
      // a target on a circle's centre still slides off it; a half-mixed path heading crossing ±π blends the short way round
      const Cc = mk([{ at: [30, 0], r: 10 }], 6); Cc.target('hand', 30, 0); for (let i = 0; i < 5; i++) Cc.update(1 / 60); const qc = end(Cc, 'a1', 'a2', [20, 20]); o.centre = +Math.hypot(qc[0] - 30, qc[1]).toFixed(2);
      const Pp = Rig.create({ rest: { u: .49 }, owns: ['u'], clips: { i: { dur: 1, loop: true, tracks: {} } }, states: { i: 'i' }, constraints: [{ path: 'b', points: [[100, 1], [0, 0], [-100, 1]], at: 'u', mix: .5 }] }, 1);
      let jump = 0, prevRot = null; for (let i = 0; i <= 20; i++) { Pp.set({ u: .49 + i * .001 }); Pp.update(1 / 60); const r = Pp.v('b.rot'); if (prevRot != null) jump = Math.max(jump, Math.abs(r - prevRot)); prevRot = r; }
      o.headJump = +jump.toFixed(2); o.version = Rig.version; return o;
    });
    check(`constraints: an ik reaches its target (${cs.ikErr} px off) and points at one out of reach, its mix channel keyed to 0 lets the limb go, an aim stays in its limits, a copy scales, a path rides its curve, an owned channel is never written; with avoid, the elbow swings to the side off the circle (${cs.swing} frames) with the hand back on its target (${cs.settled} px), a dodge stops at its cap and a borderline circle never flips the elbow (${cs.flips} flips), a target on a circle's centre slides off (${cs.centre} px) and a half-mixed path heading turns the short way (${cs.headJump} rad a frame at most)`,
      parseFloat(cs.version) >= 3.4 && cs.ikErr < .01 && cs.far && cs.letGo && cs.aim === -.5 && cs.copy === -.15 && cs.path === '100,0' && cs.owned === .7 &&
      cs.side === -1 && cs.swing >= 4 && cs.settled < .01 && cs.crossAfter === 0 && cs.dodge === 6 && cs.flips === 0 && cs.centre >= 5.9 && cs.headJump < .3, JSON.stringify(cs));
    const ph = await page.evaluate(() => {   // 3.5: a body that weighs (Rig.phys): weight shares, a tilt under one hand, a true arc, fixed steps
      const o = {}, mk = () => Rig.phys.create({ points: { shL: { at: [-13, -30], m: 1 }, shR: { at: [13, -30], m: 1 }, hipL: { at: [-7, 0], m: 1.4 }, hipR: { at: [7, 0], m: 1.4 } },
        sticks: [['shL', 'shR'], ['hipL', 'hipR'], ['shL', 'hipL'], ['shR', 'hipR'], ['shL', 'hipR'], ['shR', 'hipL']], gravity: 900 });
      const run = (W, s, dt) => { for (let i = 0; i < s / (dt || 1 / 60); i++) W.step(dt || 1 / 60); return W; };
      let W = run(mk().link('armL', 'shL', [-20, -80], { max: 41 }).link('armR', 'shR', [20, -80], { max: 41 }), 3);
      o.two = [W.load.armL, W.load.armR].map(v => +v.toFixed(2)).join(','); W.unlink('armR'); run(W, 3);
      const f = W.frame('hipL', 'hipR', 'shL', 'shR'); o.one = +W.load.armL.toFixed(2); o.tilt = +f.rot.toFixed(2); o.under = +(f.x - -20).toFixed(1);
      W = run(mk().link('armL', 'shL', [-20, -70], { max: 41 }).link('armR', 'shR', [20, -70], { max: 41 }).link('legL', 'hipL', [-12, 30], { min: 9, rest: 44, soft: .03 }).link('legR', 'hipR', [12, 30], { min: 9, rest: 44, soft: .03 }), 3);
      o.feet = +(W.load.legL + W.load.legR).toFixed(2);
      W = run(Rig.phys.create({ points: { p: { at: [0, 0], m: 1 } }, gravity: 900 }).link('foot', 'p', [0, 44], { min: 10, max: 44, rest: 44, soft: .25 }), 2); o.oneFoot = +W.load.foot.toFixed(2);
      W = mk().launch(100, -400); const ys = []; for (let i = 0; i < 30; i++) { W.step(1 / 60); ys.push(W.com()[1]); }
      o.acc = Math.round((ys[20] - 2 * ys[15] + ys[10]) / ((5 / 60) ** 2)); o.vx = +W.vel()[0].toFixed(1);
      const A = run(mk().link('armL', 'shL', [-20, -80], { max: 41 }), 2, 1 / 60), B = run(mk().link('armL', 'shL', [-20, -80], { max: 41 }), 2, 1 / 30);
      o.sameSteps = Object.keys(A.p).every(k => Math.abs(A.p[k].x - B.p[k].x) < 1e-9 && Math.abs(A.p[k].y - B.p[k].y) < 1e-9); return o;
    });
    check(`a body that weighs: two hands share its weight (${ph.two}), one hand holds it all (${ph.one}) and the body tilts under it (${ph.tilt} rad), feet under the hips take it (${ph.feet}), one foot alone all of it (${ph.oneFoot}), a launch flies a true arc (${ph.acc} px/s² for gravity 900, x speed kept at ${ph.vx}) and 60 or 30 Hz frames give the same motion`,
      ph.two === '0.5,0.5' && ph.one === 1 && Math.abs(ph.tilt) > .3 && ph.feet > .9 && ph.oneFoot > .99 && Math.abs(ph.acc - 900) < 10 && Math.abs(ph.vx - 100) < .5 && ph.sameSteps, JSON.stringify(ph));
    const ev = await page.evaluate(() => {   // 3.6: events in clips: once per key at any frame rate, no double step across a synced handover
      const def = () => ({ rest: { x: 0 }, clips: {
        walk: { dur: 1, loop: true, tracks: { x: [[0, 0], [1, 0]] }, events: [[.25, 'stepL'], [.75, 'stepR']] },
        run: { dur: .6, loop: true, tracks: { x: [[0, 0], [.6, 0]] }, events: [[.15, 'stepL'], [.45, 'stepR']] },
        swing: { dur: .5, tracks: { x: [[0, 0], [.5, 0]] }, events: [[0, 'whoosh'], [.2, 'hitOn'], [.3, 'hitOff'], [.5, 'done']] } },
        states: { walk: 'walk', run: 'run' }, sync: [['walk', 'run']], machine: [['walk', 'run', i => i.fast > .5, .3], ['run', 'walk', i => i.fast < .5, .3]] });
      const go = (R, secs, dt, L) => { for (let t = 0; t < secs - 1e-9; t += dt) { R.update(dt); for (const e of R.events) L.push(e.name); } return L; };
      const o = { walk: [] }; for (const dt of [1 / 60, .25, .7]) { const L = go(Rig.create(def(), 1), 10.5, dt, []); o.walk.push(L.length + (L.every((n, i) => !i || n !== L[i - 1]) ? '' : '!')); }
      o.walk = o.walk.join(',');
      let L = []; const R = Rig.create(def(), 1); go(R, 2.1, 1 / 60, L); R.inputs.fast = 1; go(R, 2, 1 / 60, L); R.inputs.fast = 0; go(R, 2, 1 / 60, L);
      o.doubles = L.filter((n, i) => i && n === L[i - 1]).length;
      const S = Rig.create(def(), 1); S.update(1 / 60); S.fire('swing'); o.slow = go(S, 1, .4, []).filter(n => !n.startsWith('step')).join(',');
      let bad = 0, seed = 7; for (let k = 0; k < 300; k++) { const A = Rig.create(def(), k + 1); A.update(1 / 60); A.fire('swing'); const c = {};
        for (let i = 0; i < 60; i++) { seed = (seed * 9301 + 49297) % 233280; A.update([1 / 60, 1 / 30, .05, .1, .15][Math.floor(seed / 233280 * 5)]); for (const e of A.events) if (e.from === 'shot') c[e.name] = (c[e.name] || 0) + 1; }
        if (c.whoosh !== 1 || c.hitOn !== 1 || c.hitOff !== 1 || c.done !== 1) bad++; }
      o.bad = bad; o.counted = S.counts.hitOn;
      const Z2 = Rig.create(def(), 1); Z2.update(1 / 60); Z2.fire('swing'); let w = 0; for (const dt of [0, 0, .1]) { Z2.update(dt); w += Z2.events.filter(e => e.name === 'whoosh').length; } o.zero = w;
      const U = Rig.create(Object.assign(def(), { sync: [] }), 1); for (let i = 0; i < 24; i++) U.update(1 / 60); U.go('run', 0); U.update(.2); o.fresh = U.events.map(e => e.name).join(',');
      const B = Rig.create(def(), 1); L = []; B.update(.25); L.push(...B.events.map(e => e.name)); B.go('run', 0); B.update(.25); L.push(...B.events.map(e => e.name)); o.edge = L.join(',');
      o.version = Rig.version; return o;
    });
    check(`events in clips: a walk fires its steps once and alternating at 60, 4 and 1.4 frames a second (${ev.walk} in 10.5 s), a synced walk-run-walk handover doubles no step (${ev.doubles}), a one-shot at 2.5 frames a second fires every key in order (${ev.slow}), 300 one-shots at uneven frames miss or double none (${ev.bad}), an update(0) never fires a key twice (whoosh ${ev.zero}x), a state outside the sync group starts afresh (${ev.fresh}) and a handover on a key's boundary fires it once (${ev.edge})`,
      parseFloat(ev.version) >= 3.6 && ev.walk === '21,21,21' && ev.doubles === 0 && ev.slow === 'whoosh,hitOn,hitOff,done' && ev.bad === 0 && ev.counted === 1 && ev.zero === 1 && ev.fresh === 'stepL' && ev.edge === 'stepL', JSON.stringify(ev));
    const ms = await page.evaluate(() => {   // 3.7: meshes: the rest pose maps exactly, a bone carries its points, deform keys move a point, sx stretches
      const g = Rig.mesh.grid(0, -10, 100, 20, 10, 1), o = {};
      const def = { rest: {}, owns: ['b.*'], clips: { i: { dur: 1, loop: true, tracks: {} }, gulp: { dur: .4, tracks: {}, deform: { m: [[0, {}], [.2, { 10: [0, -8] }], [.4, {}]] } } }, states: { i: 'i' },
        meshes: { m: { points: g.points, tris: g.tris, bones: [{ name: 'a', at: [0, 0], to: [50, 0] }, { name: 'b', at: [50, 0], to: [100, 0] }] } } };
      const R = Rig.create(def, 1); R.update(1 / 60); let P = R.mesh('m'), err = 0; g.points.forEach((p, i) => err = Math.max(err, Math.hypot(P[2 * i] - p[0], P[2 * i + 1] - p[1]))); o.rest = +err.toFixed(6);
      R.set({ 'b.rot': Math.PI / 2 }); R.update(1 / 60); P = R.mesh('m'); o.tip = [P[20], P[21]].map(v => Math.round(v)).join(',');   // point 10: (100, -10) turns about (50, 0)
      R.set({ 'b.rot': 0, 'b.sx': 2 }); R.update(1 / 60); P = R.mesh('m'); o.stretch = Math.round(P[20]);
      R.set({ 'b.sx': 1 }); R.fire('gulp'); let dy = 0; for (let i = 0; i < 30; i++) { R.update(1 / 60); const Q = R.mesh('m'); dy = Math.min(dy, Q[21] + 10); } o.deform = +dy.toFixed(2);
      o.tris = g.tris.length; o.cached = R.mesh('m') === R.mesh('m'); o.version = Rig.version;
      const F = Rig.create({ rest: {}, clips: { i: { dur: 1, loop: true, tracks: {} }, big: { dur: 1, loop: true, tracks: { 'a.sx': [[0, 2], [1, 2]] } } }, states: { i: 'i', big: 'big' }, meshes: def.meshes }, 1);
      F.update(1 / 60); F.go('big', 1); F.update(.25); o.fade = +F.mesh('m')[2].toFixed(1);   // a crossfade blends from the bind pose: x 10 grows, never shrinks
      const Dd = Rig.create(Object.assign({}, def, { clips: Object.assign({ end: { dur: .4, tracks: {}, deform: { m: [[0, {}], [.4, { 10: [0, -8] }]] } } }, def.clips) }), 1);
      Dd.update(1 / 60); Dd.fire('end'); Dd.update(.2); Dd.update(.2); o.ends = +(Dd.mesh('m')[21] + 10).toFixed(2);   // a shot's last deform shows on its last frame
      const Z0 = Rig.create({ rest: {}, clips: { i: { dur: 1, loop: true, tracks: {} } }, states: { i: 'i' }, meshes: { m: { points: [[0, 0], [25, 0]], tris: [], bones: def.meshes.m.bones, soft: 0 } } }, 1); Z0.update(1 / 60); o.soft0 = Array.from(Z0.mesh('m')).join(',');
      const calls = { clip: 0, draw: 0 }, x = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() { calls.clip++; }, transform() {}, drawImage() { calls.draw++; } };
      Rig.mesh.draw(x, { width: 8, height: 8 }, R, 'm'); o.drawn = calls.draw === R.meshDef('m').tris.length && calls.clip === calls.draw; return o;
    });
    check(`meshes: the rest pose maps every point exactly (${ms.rest} px off), a bone turned 90 degrees carries its points (tip at ${ms.tip}), its sx stretches them (tip x ${ms.stretch}), deform keys move a point by their offset (${ms.deform} px) and a one-shot's last deform shows (${ms.ends} px), a crossfade blends bone channels from the bind pose (x 10 to ${ms.fade}), a point on a bone with soft 0 stays finite (${ms.soft0}), the points are computed once a frame and Rig.mesh.draw paints the picture on the mesh (${ms.tris} triangles)`,
      parseFloat(ms.version) >= 3.7 && ms.rest < 1e-6 && ms.tip === '60,50' && ms.stretch >= 145 && ms.deform === -8 && ms.cached && ms.drawn && ms.fade > 10 && ms.ends === -8 && ms.soft0 === '0,0,25,0', JSON.stringify(ms));
  console.warn = warn;
  {
    const r = Rig.create({ rest: { a: 1 }, alive: { a: [0.1, 2] } }), e = Rig.create({});
    r.update(0.016); e.update(0.016);
    const q = Rig.create({ clips: { a: { dur: 1, tracks: {} } }, states: { idle: 'nope' }, machine: [['*', 'gone', () => false]], auto: { blnk: [1, 2] }, on: { hit: 'ouch' } });
    check('every block of a definition is optional (a rest pose and a breath is a rig, so is {}), and names that point nowhere are listed in r.warnings',
      r.v('a') !== 1 && e.state === null && r.warnings.length === 0 && q.warnings.length === 4, JSON.stringify(q.warnings));
  }
  {
    const def = { rest: { 'b.sy': 1, 'e.open': 1, 'hat.rot': 0, brow: 0, still: 2 },
      clips: { calm: { dur: 2, loop: true, tracks: { 'b.sy': [[0, 1], [1, 1.04], [2, 1]] } }, scared: { dur: 0.4, loop: true, tracks: { brow: [[0, 1], [0.4, 1]] } },
        blink: { dur: 0.16, tracks: { 'e.open': [[0, 0], [0.07, -1], [0.16, 0]] } }, ouch: { dur: 0.5, tracks: { 'b.sy': [[0, 0], [0.1, -0.2], [0.5, 0]], 'slot:mouth': [[0, 'o']] }, events: [[0.1, 'thud']] }, wave: { dur: 1, tracks: {} } },
      states: { mood: { blend: 'fear', clips: [[0, 'calm'], [1, 'scared']] }, down: 'calm' }, machine: [['*', 'down', (i) => i.hp < 0]],
      auto: { blink: [1.5, 4] }, springs: { 'hat.rot': { k: 160, d: 8 } }, slots: { mouth: 'smile' }, on: { hit: { fire: 'ouch', kick: { 'hat.rot': 6 } }, cheer: 'wave' } };
    const quiet = Rig.report(def), full = Rig.report(def, { name: 'pip', script: [{ at: 1, event: 'hit' }, { at: 2, inputs: { fear: 1 } }, { at: 3, go: 'down' }] }), again = Rig.report(def, { name: 'pip', script: [{ at: 1, event: 'hit' }, { at: 2, inputs: { fear: 1 } }, { at: 3, go: 'down' }] });
    check(`Rig.report plays a definition without a screen: left alone it says what never played (${quiet.never.clips.join(', ')}) and what never moved (${quiet.never.still.join(', ')}); with a script the hit plays its clip once, fires its clip event, moves the spring, swaps the slot, the input brings the blend's second clip in, and the same call gives the same report`,
      quiet.ok && quiet.never.clips.join() === 'scared,ouch,wave' && quiet.never.reactions.join() === 'hit,cheer' && quiet.never.states.join() === 'down' && quiet.never.still.join() === 'brow,hat.rot,still' && quiet.played.calm.state && quiet.played.blink.shots >= 1 &&
      full.ok && full.played.ouch.shots === 1 && full.events.thud === 1 && full.channels['hat.rot'].moved && full.slots.mouth.join() === 'smile,o' && full.played.scared.state && full.never.clips.join() === 'wave' && full.states.mood === 3 && full.states.down === 3 &&
      /^pip: 6 s/.test(full.text) && /\nok: 0 fails, \d notes?$/.test(full.text) && full.text === again.text, JSON.stringify([quiet.never, full.never, full.states, full.text]));
    const bad = Rig.report(Object.assign({}, def, { states: { mood: 'clam' }, machine: [] }), { seconds: 2, script: [{ at: 0.5, event: 'hitt' }, { at: 1, fire: 'nope' }, { at: 1, go: 'gone' }, { at: 5, fire: 'blink' }] });
    const nan = Rig.report({ rest: { a: 0 }, clips: { c: { dur: 1, loop: true, tracks: { a: [[0, NaN], [1, NaN]] } } }, states: { c: 'c' } }, { seconds: 1 });
    check(`Rig.report is not ok on a mistake: a name that points nowhere in the definition, a script step that names an event, a clip or a state the rig does not have, a step after the end (${bad.warnings.length} + ${bad.problems.length} fails), a channel that is not a number`,
      !bad.ok && bad.warnings.length === 1 && bad.problems.length === 4 && /FAIL    state mood plays clip clam/.test(bad.text) && /not ok: 5 fails/.test(bad.text) && !nan.ok && /a is not a number/.test(nan.problems[0]), JSON.stringify([bad.warnings, bad.problems, nan.problems]));
  }
  const bad = results.filter((x) => !x.ok).length;
  console.log(bad ? `${bad} of ${results.length} checks FAILED` : `${results.length} checks pass`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
