/*! rig.js 3.9.0 | MIT licence | a small animation rig for 2D characters that react.
 *
 * A character is a rest pose of named channels ("body.sy", "eye.x"), keyframed clips, a state machine driven by inputs,
 * one-shots that add on top (a blink, a startle), springs, a gaze and a breath. The rig only computes numbers: you read the
 * pose each frame and draw with whatever you draw with (canvas, SVG, WebGL, the DOM).
 *
 *   const r = Rig.create({ rest: { 'body.sy': 1 }, alive: { 'body.sy': [0.02, 3] } });
 *   r.update(dt);          // once a frame, dt in seconds
 *   r.v('body.sy');        // read a channel and draw
 *
 * One file, no dependency. <script src="rig.js"> gives window.Rig; require('./rig.js') and import Rig from './rig.mjs' work too.
 * Guide: docs/tutorial.md. Reference: docs/api.md.
 */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.Rig = make();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const E = {
    lin: (t) => t,
    io: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
    in: (t) => t * t,
    out: (t) => 1 - (1 - t) * (1 - t),
    back: (t) => {
      const c = 1.9,
        u = t - 1;
      return 1 + (c + 1) * u * u * u + c * u * u;
    }, // overshoot, then settle
    hold: (t) => (t < 1 ? 0 : 1),
  };
  // a track: [[t, value, ease into this key], ...] sorted by t
  function sample(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++)
      if (t <= keys[i][0]) {
        const a = keys[i - 1],
          b = keys[i],
          q = (t - a[0]) / (b[0] - a[0] || 1);
        return a[1] + (b[1] - a[1]) * (E[b[2] || 'io'] || E.io)(q);
      }
    return keys[keys.length - 1][1];
  }
  const clipTime = (clip, t) => (clip.loop ? ((t % clip.dur) + clip.dur) % clip.dur : Math.min(t, clip.dur));
  // slot keys: a track named 'slot:<slot>' holds attachment names, [[t, 'name'], ...], always stepped (no blend between two
  // drawings). Before its first key a track says nothing, so the slot keeps what it had.
  const isKey = (ch) => ch.startsWith('slot:');
  function keyAt(keys, t) {
    let v;
    for (const k of keys) {
      if (k[0] > t) break;
      v = k[1];
    }
    return v;
  }
  function clipKeys(clip, t, out, from, tag) {
    for (const ch in clip.tracks)
      if (isKey(ch)) {
        const v = keyAt(clip.tracks[ch], t);
        if (v !== undefined) {
          out[ch.slice(5)] = v;
          from[ch.slice(5)] = tag;
        }
      }
  }
  // the clip that leads a machine now (the one weighing most in its crossfade or blend) and its time, for the slot keys
  function machineKeys(def, M, out, smooth, from, where) {
    const L = leadClip(def, M, smooth),
      clip = L.name && def.clips[L.name];
    if (clip) clipKeys(clip, clipTime(clip, L.t), out, from, where + ':' + L.name);
  }
  function leadClip(def, M, smooth) {
    if (M.leadAt === M.t + ':' + M.state) return M.leadOut; // once per frame: the slots and the events read the same lead
    const lead = M.prev && M.fade > M.fadeDur / 2 ? [M.prev, M.prevT] : [M.state, M.t],
      st = M.spec.states[lead[0]];
    let name = typeof st === 'string' ? st : null;
    // in a blend, the clip that led keeps the lead until the other one weighs .6: an input hovering at the midpoint does not
    // flip the face every frame
    // and a blend that is fading out keeps the clip it had: its face does not change on the way out
    if (st && st.clips && st.clips.length && lead[0] === M.prev && M.lead && st.clips.some((c) => c[1] === M.lead))
      name = M.lead;
    else if (st && st.clips && st.clips.length) {
      const x = smooth(st.blend),
        c = st.clips;
      name = c[c.length - 1][1];
      if (x <= c[0][0]) name = c[0][1];
      else
        for (let i = 1; i < c.length; i++)
          if (x <= c[i][0]) {
            const q = (x - c[i - 1][0]) / (c[i][0] - c[i - 1][0] || 1),
              a = c[i - 1][1],
              b = c[i][1];
            name = M.lead === a && q < 0.6 ? a : M.lead === b && q > 0.4 ? b : q < 0.5 ? a : b;
            break;
          }
      M.lead = name;
    }
    M.leadAt = M.t + ':' + M.state;
    M.leadOut = { name, t: lead[1], st: lead[0] };
    return M.leadOut;
  }
  // clip events (from Spine): clip.events [[t, 'name', data], ...] fire when the playhead passes their time, every loop,
  // all of them in order on a long frame, never twice
  function crossed(clip, t0, t1, cb) {
    if (!clip.events || !(t1 > t0)) return;
    const d = clip.dur || 1;
    if (!clip.loop) {
      for (const e of clip.events) if (e[0] > t0 && e[0] <= t1 && e[0] <= d) cb(e);
      return;
    }
    const n0 = Math.floor(t0 / d),
      n1 = Math.min(Math.floor(t1 / d), n0 + 64);
    for (let n = n0; n <= n1; n++)
      for (const e of clip.events) {
        const T = n * d + e[0];
        if (T > t0 && T <= t1) cb(e);
      }
  }

  // a state is a clip name, or a 1D blend { blend: 'fear', clips: [[0, 'calm'], [.5, 'tense'], [1, 'scared']] } driven by an input
  function statePose(def, st, t, P, k, smooth, additive) {
    const one = (name, w) => {
      const clip = def.clips[name];
      if (!clip || !w) return;
      const tt = clipTime(clip, t);
      for (const ch in clip.tracks) {
        if (isKey(ch)) continue;
        const base = def.rest[ch] || 0,
          cur = P[ch] == null ? base : P[ch],
          val = sample(clip.tracks[ch], tt);
        P[ch] = cur + (additive ? val - base : val - base) * w * k;
      }
    };
    if (typeof st === 'string') return one(st, 1);
    if (!st || !st.clips || !st.clips.length) return;
    const x = smooth(st.blend),
      c = st.clips;
    if (x <= c[0][0]) return one(c[0][1], 1);
    for (let i = 1; i < c.length; i++)
      if (x <= c[i][0]) {
        const q = (x - c[i - 1][0]) / (c[i][0] - c[i - 1][0] || 1);
        one(c[i - 1][1], 1 - q);
        one(c[i][1], q);
        return;
      }
    one(c[c.length - 1][1], 1);
  }
  // a machine: the state, its clock and the crossfade from the previous state (the base pose and every layer run one)
  function machine(spec) {
    if (!spec.states) spec = Object.assign({}, spec, { states: {} });
    return {
      spec,
      state: spec.initial || Object.keys(spec.states)[0] || null,
      t: 0,
      prev: null,
      prevT: 0,
      fade: 0,
      fadeDur: 0,
    };
  }
  // a cycle's length: a clip state's clip, or the first clip of a blend
  const cycle = (def, st) => {
    const n = typeof st === 'string' ? st : st && st.clips && st.clips[0] && st.clips[0][1],
      c = n && def.clips[n];
    return c && c.loop ? c.dur : 0;
  };
  function go(M, name, fade) {
    if (name === M.state || !M.spec.states[name]) return false;
    // states in one sync group (def.sync: [['walk', 'run']]) hand over their phase: the run starts where the walk's stride was,
    // so a footstep event never comes twice from the same foot across the crossfade
    let t0 = 0;
    const g = (M.spec.sync || []).find((g) => g.includes(M.state) && g.includes(name)),
      a = g && cycle(M.def, M.spec.states[M.state]),
      b = g && cycle(M.def, M.spec.states[name]);
    if (a && b) t0 = ((((M.t % a) + a) % a) / a) * b;
    M.prev = M.state;
    M.prevT = M.t;
    M.state = name;
    M.t = t0;
    M.fadeDur = fade == null ? 0.2 : fade;
    M.fade = M.fadeDur;
    return true;
  }
  function runMachine(M, inputs, R, dt) {
    for (const [from, to, cond, fade] of M.spec.machine || [])
      if ((from === '*' || from === M.state) && to !== M.state && cond(inputs, R)) {
        go(M, to, fade);
        if (M === R.base) R.note(to);
        break;
      }
    M.t += dt;
    if (M.prev) {
      M.prevT += dt;
      M.fade -= dt;
      if (M.fade <= 0) M.prev = null;
    }
  }
  function machinePose(def, M, P, k, smooth, additive) {
    const w = M.prev ? 1 - Math.max(0, M.fade) / (M.fadeDur || 1) : 1;
    if (M.prev) statePose(def, M.spec.states[M.prev], M.prevT, P, k * (1 - E.io(w)), smooth, additive);
    statePose(def, M.spec.states[M.state], M.t, P, k * (M.prev ? E.io(w) : 1), smooth, additive);
  }

  // ---- meshes (from Spine): one drawing on a mesh of points, bent by bones, keyed by deform offsets ----------------------------
  // weights: each point takes its k nearest bones (distance to the bone's segment), by 1 / (d + soft)^falloff, normalised
  function bindMesh(M) {
    const pts = M.points,
      B = M.bones,
      k = Math.min(M.k || 2, B.length),
      soft = M.soft == null ? 4 : M.soft,
      fall = M.falloff || 4;
    const segD = (p, b) => {
      const a = b.at,
        c = b.to || b.at,
        dx = c[0] - a[0],
        dy = c[1] - a[1],
        L2 = dx * dx + dy * dy,
        t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
      return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
    };
    const weights =
      M.weights ||
      pts.map((p) => {
        const d = B.map((b, i) => [i, segD(p, b)])
            .sort((x, y) => x[1] - y[1])
            .slice(0, k),
          on = d.filter((x) => x[1] + soft < 1e-9);
        if (on.length) return on.map(([i]) => [i, 1 / on.length]); // a point on a bone with soft 0: that bone (or those) only, never inf / inf
        const w = d.map(([i, di]) => [i, 1 / Math.pow(di + soft, fall)]),
          t = w.reduce((a, x) => a + x[1], 0);
        return w.map(([i, wi]) => [i, wi / t]);
      });
    let uv = M.uv;
    if (!uv) {
      const xs = pts.map((p) => p[0]),
        ys = pts.map((p) => p[1]),
        x0 = Math.min(...xs),
        y0 = Math.min(...ys),
        w = Math.max(...xs) - x0 || 1,
        h = Math.max(...ys) - y0 || 1;
      uv = pts.map((p) => [(p[0] - x0) / w, (p[1] - y0) / h]);
    }
    return { weights, uv };
  }
  // deform keys: [[t, { index: [dx, dy], ... }, ease], ...], a missing index is 0 at that key; added into out { index: [dx, dy] }
  function deformAt(keys, t, out) {
    if (!keys.length) return;
    let a = keys[0],
      b = keys[0],
      q = 0;
    if (t >= keys[keys.length - 1][0]) a = b = keys[keys.length - 1];
    else if (t > keys[0][0])
      for (let i = 1; i < keys.length; i++)
        if (t <= keys[i][0]) {
          a = keys[i - 1];
          b = keys[i];
          q = (E[b[2] || 'io'] || E.io)((t - a[0]) / (b[0] - a[0] || 1));
          break;
        }
    const idx = new Set(Object.keys(a[1]).concat(Object.keys(b[1])));
    for (const i of idx) {
      const va = a[1][i] || [0, 0],
        vb = b[1][i] || [0, 0],
        o = out[i] || (out[i] = [0, 0]);
      o[0] += va[0] + (vb[0] - va[0]) * q;
      o[1] += va[1] + (vb[1] - va[1]) * q;
    }
  }
  // a bone's channels: '<bone>.x', '.y' (where its root is now; rest = its at), '.rot' (radians, rest 0), '.sx', '.sy' (scale along and across it)
  function skin(M, R, D) {
    const n = M.points.length,
      out = new Float32Array(n * 2),
      T = M.bones.map((b) => {
        const a = b.at,
          c = b.to || [a[0] + 1, a[1]],
          r0 = Math.atan2(c[1] - a[1], c[0] - a[0]);
        const g = (ch, d) => (b.name + ch in R.pose ? R.pose[b.name + ch] : d);
        return {
          ax: a[0],
          ay: a[1],
          r0,
          x: g('.x', a[0]),
          y: g('.y', a[1]),
          rot: g('.rot', 0),
          sx: g('.sx', 1),
          sy: g('.sy', 1),
        };
      });
    for (let i = 0; i < n; i++) {
      let px = M.points[i][0],
        py = M.points[i][1];
      const d = D && D[i];
      if (d) {
        px += d[0];
        py += d[1];
      }
      let x = 0,
        y = 0;
      for (const [bi, w] of M.weights[i]) {
        const t = T[bi],
          c0 = Math.cos(t.r0),
          s0 = Math.sin(t.r0),
          lx = px - t.ax,
          ly = py - t.ay;
        const u = (lx * c0 + ly * s0) * t.sx,
          v = (-lx * s0 + ly * c0) * t.sy,
          a = t.r0 + t.rot,
          ca = Math.cos(a),
          sa = Math.sin(a);
        x += w * (t.x + u * ca - v * sa);
        y += w * (t.y + u * sa + v * ca);
      }
      out[2 * i] = x;
      out[2 * i + 1] = y;
    }
    return out;
  }
  function create(def, seed) {
    // every block of a definition is optional: a rig with only a rest pose and a breath is a valid rig
    def = Object.assign({ rest: {}, clips: {}, states: {} }, def);
    // a mesh bone's channels rest at its bind pose (x, y at its root, rot 0, sx and sy 1) unless def.rest says otherwise, so clips and
    // crossfades blend from there rather than from 0
    if (def.meshes) {
      const imp = {};
      for (const m in def.meshes)
        for (const b of def.meshes[m].bones)
          Object.assign(imp, {
            [b.name + '.x']: b.at[0],
            [b.name + '.y']: b.at[1],
            [b.name + '.rot']: 0,
            [b.name + '.sx']: 1,
            [b.name + '.sy']: 1,
          });
      def = Object.assign({}, def, { rest: Object.assign(imp, def.rest) });
    }
    const meshes = {};
    for (const m in def.meshes || {}) meshes[m] = Object.assign({ name: m }, def.meshes[m], bindMesh(def.meshes[m]));
    const pats = (def.owns || []).map((o) => (o.endsWith('*') ? [o.slice(0, -1), true] : [o, false]));
    const owned = (ch) => pats.some(([o, pre]) => (pre ? ch.startsWith(o) : ch === o));
    const warnings = [];
    for (const c in def.clips || {})
      for (const ch in def.clips[c].tracks) {
        if (isKey(ch)) {
          if (!def.slots || !(ch.slice(5) in def.slots))
            warnings.push(`clip ${c} keys ${ch}, a slot def.slots does not declare`);
        } else if (owned(ch)) warnings.push(`clip ${c} animates ${ch}, which the controller owns`);
      }
    for (const ch in Object.assign({}, def.springs, def.alive))
      if (owned(ch)) warnings.push(`${ch} is owned by the controller: its spring or breath is ignored`);
    // names that point nowhere are the usual typo: say so once, at creation, instead of animating nothing in silence
    const hasClip = (n) => n in def.clips;
    const scanStates = (states, where) => {
      for (const st in states || {}) {
        const v = states[st];
        const names = typeof v === 'string' ? [v] : v && v.clips ? v.clips.map((c) => c[1]) : [];
        for (const n of names)
          if (!hasClip(n)) warnings.push(`${where} ${st} plays clip ${n}, which def.clips does not have`);
      }
    };
    const scanMachine = (m, states, where) => {
      for (const t of m || [])
        if (!(t[1] in (states || {}))) warnings.push(`${where} goes to state ${t[1]}, which does not exist`);
    };
    scanStates(def.states, 'state');
    scanMachine(def.machine, def.states, 'def.machine');
    (def.layers || []).forEach((l, i) => {
      scanStates(l.states, `layer ${i} state`);
      scanMachine(l.machine, l.states, `layer ${i} machine`);
    });
    for (const k in def.auto || {})
      if (!hasClip(k)) warnings.push(`def.auto fires ${k}, which def.clips does not have`);
    for (const e in def.on || {}) {
      const o = typeof def.on[e] === 'string' ? { fire: def.on[e] } : def.on[e];
      if (o.fire && !hasClip(o.fire)) warnings.push(`def.on.${e} fires ${o.fire}, which def.clips does not have`);
      if (o.go && !(o.go in def.states)) warnings.push(`def.on.${e} goes to state ${o.go}, which does not exist`);
    }
    let rnd = ((seed || 1) * 9301) % 233280;
    const rand = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280; // a rig's own little dice: two characters never blink together
    const phase = {};
    for (const ch in def.alive || {}) phase[ch] = [rand() * 6.283, rand() * 6.283];
    const base = machine({ states: def.states, machine: def.machine, initial: def.initial, sync: def.sync });
    base.def = def;
    const R = {
      def,
      inputs: Object.assign({}, def.inputs || {}),
      base,
      layers: (def.layers || []).map((l) =>
        Object.assign(machine(l), { weight: l.weight == null ? 1 : l.weight, def }),
      ),
      get state() {
        return base.state;
      },
      get t() {
        return base.t;
      },
      shots: [], // additive one-shots playing: { clip, t }
      springs: {},
      autoT: {},
      pose: {},
      log: [],
      smoothed: {},
      clock: 0,
      look: { tx: 0, ty: 0, on: false, eye: [0, 0], eyeV: [0, 0], head: 0, headV: 0, sx: 0, sy: 0, nextSac: 1 },
      signals: {},
      ctrl: {},
      targets: {},
      reach: {},
      elbow: {},
      dodge: {},
      swivel: {},
      cross: {},
      heading: {},
      ikDt: 0,
      events: [],
      evLast: {},
      counts: {},
      worn: Object.assign({}, def.slots),
      timed: {},
      slots: Object.assign({}, def.slots),
      slotFrom: {},
      skinName: null,
      warnings,
      lastEvent: {},
      lastTake: {},
      unowned: {},
      marks: [],
      side: 1,
      held: null,
      snapS: {},
      holdT: 0,
      note(e) {
        R.log.push(e);
        if (R.log.length > 24) R.log.shift();
      },
      v(ch) {
        return ch in R.pose ? R.pose[ch] : def.rest[ch] || 0;
      },
      // the mesh's points this frame: deform keys in the bind pose, then skinned by its bones' channels; cached per frame
      meshDef(name) {
        return meshes[name] || null;
      },
      mesh(name) {
        const M = meshes[name];
        if (!M) return null;
        R.meshCache = R.meshCache || {};
        return R.meshCache[name] || (R.meshCache[name] = skin(M, R, (R.deform || {})[name]));
      },
      go(name, fade) {
        const ok = go(base, name, fade);
        if (ok) R.note(name);
        return ok;
      },
      layer(i) {
        return R.layers[i];
      },
      fire(name) {
        const c = def.clips[name];
        if (!c) return false;
        R.shots = R.shots.filter((s) => s.name !== name);
        R.shots.push({ name, clip: c, t: 0 });
        R.note('!' + name);
        return true;
      },
      playing(name) {
        return R.shots.some((s) => s.name === name);
      },
      kick(ch, vel) {
        const s = R.springs[ch];
        if (s) s.vel += vel;
      },
      // where the character looks: a direction from it to the target, each axis in -1..1 (null: no target, the gaze wanders)
      lookAt(x, y) {
        if (x == null) {
          R.look.on = false;
          return R;
        }
        R.look.on = true;
        R.look.tx = Math.max(-1, Math.min(1, x));
        R.look.ty = Math.max(-1, Math.min(1, y || 0));
        return R;
      },
      // the controller's side of the contract
      feed(sig) {
        Object.assign(R.signals, sig);
        for (const n in def.sense || {}) {
          const sp = def.sense[n];
          let v;
          if (typeof sp === 'function') v = sp(R.signals);
          else if (typeof sp === 'string') v = R.signals[sp];
          else {
            const x = R.signals[sp.from];
            if (x == null) continue;
            const r = sp.range || [0, 1];
            v = Math.max(0, Math.min(1, (x - r[0]) / (r[1] - r[0] || 1)));
          }
          if (v != null && isFinite(v)) R.inputs[n] = v;
        }
        return R;
      },
      event(name, data) {
        const sp = (def.on || {})[name];
        if (!sp) return false;
        const o = typeof sp === 'string' ? { fire: sp } : sp;
        if (o.gap && R.lastEvent[name] != null && R.clock - R.lastEvent[name] < o.gap) return false;
        R.lastEvent[name] = R.clock;
        R.note('@' + name);
        if (o.go) R.go(o.go, o.fade);
        if (o.fire) R.fire(o.fire);
        if (o.alt) R.side = -R.side;
        if (o.take) {
          const t = R.take(name, o.take, data);
          if (t) R.fire(t);
        }
        for (const ch in o.kick || {})
          R.kick(ch, o.kick[ch] * (data && data.scale != null ? data.scale : 1) * (o.alt ? R.side : 1));
        if (o.mark) R.mark(o.mark);
        for (const sl in o.attach || {}) {
          const a = [].concat(o.attach[sl]);
          R.attach(sl, a[0], a[1]);
        }
        return true;
      },
      // a varied take: one of the clips whose `when` fits the data, weighted, never the last one unless it is the only fit
      take(name, list, data) {
        const d = data || {};
        let fit = []
          .concat(list)
          .map((t) => (typeof t === 'string' ? { clip: t } : t))
          .filter((t) => def.clips[t.clip] && (!t.when || t.when(d, R)));
        if (fit.length > 1) fit = fit.filter((t) => t.clip !== R.lastTake[name]);
        if (!fit.length) return null;
        let u = rand() * fit.reduce((s, t) => s + (t.w == null ? 1 : t.w), 0),
          pick = fit[fit.length - 1];
        for (const t of fit) {
          u -= t.w == null ? 1 : t.w;
          if (u < 0) {
            pick = t;
            break;
          }
        }
        R.lastTake[name] = pick.clip;
        return pick.clip;
      },
      mark(m) {
        const [name, life] = Array.isArray(m) ? m : [m, 0.8];
        R.marks = R.marks.filter((x) => x.name !== name);
        R.marks.push({ name, age: 0, life, t: 0 });
        return R;
      },
      // slots and attachments: what is worn now (an outfit, a held item, damage), whole drawings swapped by name
      // attach(slot, name) changes what the slot wears until the game changes it again; with dur, a timed attach over everything
      // that ends by itself (a later plain attach changes what shows after it, not the timed one)
      // r.slots shows the change at once unless a clip keys that slot now (the clip keeps it until it lets go); r.slots is a new
      // object after each change, so a copy kept from an earlier frame never changes under the game's feet
      attach(slot, name, dur) {
        if (!(slot in R.worn)) return false;
        if (dur > 0) R.timed[slot] = { name, left: dur };
        else R.worn[slot] = name;
        const show = R.timed[slot]
          ? R.timed[slot].name
          : R.slotFrom[slot] && R.slotFrom[slot] !== 'timed'
            ? R.slots[slot]
            : name;
        if (show !== R.slots[slot]) R.slots = Object.assign({}, R.slots, { [slot]: show });
        return true;
      },
      skin(name) {
        const sk = (def.skins || {})[name];
        if (!sk) return false;
        R.skinName = name;
        for (const sl in sk) R.attach(sl, sk[sl]);
        R.note('~' + name);
        return true;
      },
      slot(name) {
        return R.slots[name];
      },
      // draw order: def.order gives each part a depth (an object { part: depth }, or a list back to front: depth = index);
      // a part's '<part>.z' channel adds to it, so clips, layers, one-shots, springs and the controller reorder parts like any
      // other channel. Ties keep the order def.order lists them in.
      // each part's depth this frame, [[part, depth], ...] in def.order's order: to sort the parts of several characters together
      depths(pose) {
        const P = pose || R.pose,
          o = def.order || [],
          list = Array.isArray(o) ? o.map((p, i) => [p, i]) : Object.entries(o);
        return list.map(([p, d]) => [p, d + (P[p + '.z'] == null ? def.rest[p + '.z'] || 0 : P[p + '.z'])]);
      },
      drawOrder(pose) {
        const P = pose || R.pose,
          o = def.order || [],
          list = Array.isArray(o) ? o.map((p, i) => [p, i]) : Object.entries(o);
        return list
          .map(([p, d], i) => [p, d + (P[p + '.z'] == null ? def.rest[p + '.z'] || 0 : P[p + '.z']), i])
          .sort((a, b) => a[1] - b[1] || a[2] - b[2])
          .map((x) => x[0]);
      },
      // constraints: where a named target is, in the character's own frame (the frame its channels draw in)
      target(name, x, y) {
        if (x == null) delete R.targets[name];
        else R.targets[name] = [x, y];
        return R;
      },
      set(chs) {
        for (const ch in chs) {
          if (owned(ch)) R.ctrl[ch] = chs[ch];
          else if (!R.unowned[ch]) {
            // a dropped set is loud, once per channel
            R.unowned[ch] = 1;
            const w = `set(${ch}): def.owns does not list it, so the controller's value is dropped`;
            warnings.push(w);
            if (typeof console !== 'undefined') console.warn('[rig] ' + w);
          }
        }
        return R;
      },
      drives() {
        const o = {},
          val = (x) => (typeof x === 'string' ? R.v(x) : x);
        for (const n in def.drive || {}) {
          const d = def.drive[n];
          o[n] = { target: val(d.target), gain: d.gain == null ? 1 : val(d.gain) };
        }
        return o;
      },
      smooth(name) {
        return R.smoothed[name] == null ? R.inputs[name] || 0 : R.smoothed[name];
      },
      update(dt) {
        if (!(dt >= 0) || dt > 1) dt = 0;
        R.clock += dt;
        // 0. inputs that drive blends ease toward their value (def.smooth: { fear: 6 } per second; default 8): no step in the pose
        const blendInputs = new Set();
        const scan = (st) => {
          for (const k in st) if (st[k] && st[k].blend) blendInputs.add(st[k].blend);
        };
        scan(def.states);
        R.layers.forEach((L) => scan(L.spec.states));
        blendInputs.forEach((n) => {
          const target = R.inputs[n] || 0,
            cur = R.smoothed[n] == null ? target : R.smoothed[n],
            rate = (def.smooth && def.smooth[n]) || 8;
          R.smoothed[n] = cur + (target - cur) * (1 - Math.exp(-rate * dt));
        });
        // 1. the state machines: the base one, then each layer's (the first matching transition from this state or from any wins)
        runMachine(base, R.inputs, R, dt);
        R.layers.forEach((L) => runMachine(L, R.inputs, R, dt));
        // 2. auto triggers: blinks, glances, at a random interval
        for (const k in def.auto || {}) {
          const [a, b] = def.auto[k];
          if (R.autoT[k] == null) R.autoT[k] = a + rand() * (b - a);
          R.autoT[k] -= dt;
          if (R.autoT[k] <= 0) {
            R.autoT[k] = a + rand() * (b - a);
            R.fire(k);
          }
        }
        // 3. the base pose: rest, the state's clip (or blend) over it, crossfaded from the previous state's
        const P = Object.assign({}, def.rest),
          sm = R.smooth;
        machinePose(def, base, P, 1, sm, false);
        // 4. layers add on top (a face over a body, a carried thing over a walk): their clips are offsets from rest, times the layer's weight
        R.layers.forEach((L) => {
          const w = typeof L.weight === 'string' ? R.smooth(L.weight) : L.weight;
          if (w) machinePose(def, L, P, w, sm, true);
        });
        // 5. one-shots add on top (their tracks are offsets)
        R.shots.forEach((s) => {
          s.t += dt;
          const tt = Math.min(s.t, s.clip.dur);
          for (const ch in s.clip.tracks)
            if (!isKey(ch)) P[ch] = (P[ch] == null ? def.rest[ch] || 0 : P[ch]) + sample(s.clip.tracks[ch], tt);
        });
        // 5b. slots: what the game attached, then the leading state clip's keys, the layers', the one-shots' (last fired wins),
        // then a timed attach (a hurt face for .5 s) over all of them
        if (def.slots) {
          const S = Object.assign({}, R.worn),
            F = {};
          machineKeys(def, base, S, sm, F, 'state');
          R.layers.forEach((L, i) => {
            const w = typeof L.weight === 'string' ? R.smooth(L.weight) : L.weight;
            if (w >= 0.5) machineKeys(def, L, S, sm, F, 'layer' + i);
          });
          R.shots.forEach((s) => clipKeys(s.clip, Math.min(s.t, s.clip.dur), S, F, 'shot:' + s.name));
          for (const sl in R.timed) {
            const T = R.timed[sl];
            T.left -= dt;
            if (T.left <= 0) delete R.timed[sl];
            else {
              S[sl] = T.name;
              F[sl] = 'timed';
            }
          }
          R.slots = S;
          R.slotFrom = F;
        }
        // 5c. clip events: the leading state clip's, the layers' weighing .5 or more, the one-shots'. A clip that just took
        // the lead fires only what its last frame crossed, so a crossfade never replays the keys it skipped
        R.events = [];
        const evFrom = (M, tag) => {
          const L = leadClip(def, M, sm),
            clip = L.name && def.clips[L.name],
            last = R.evLast[tag];
          let t0 = last && last.name === L.name && L.t >= last.t ? last.t : L.t <= dt + 1e-9 ? -1e-9 : L.t - dt;
          // one cycle handing over to another in its sync group: go on from the old one's phase (other states start afresh)
          const was =
            last &&
            last.name !== L.name &&
            (M.spec.sync || []).some((g) => g.includes(last.st) && g.includes(L.st)) &&
            def.clips[last.name];
          if (clip && clip.loop && was && was.loop) {
            const ph = (((last.t % was.dur) + was.dur) % was.dur) / was.dur,
              now = (((L.t % clip.dur) + clip.dur) % clip.dur) / clip.dur;
            // the time this frame moved on in the new clip: its phase gap, plus whole cycles while the frame was that long
            let gap = ((((now - ph) % 1) + 1) % 1) * clip.dur;
            while (gap + clip.dur <= dt + 1e-9) gap += clip.dur;
            // more than half a stride past the frame: not in step, fire nothing old
            if (gap > dt + 0.5 * clip.dur) t0 = L.t;
            else {
              t0 = L.t - gap;
              // a key on the handover's boundary fires only if the old clip had not reached its phase: rounding never fires it twice
              // (old clip at .25, new key at the same phase) nor drops it (old clip at .2499999, short of its own key)
              const d = clip.dur,
                b0 = ((t0 % d) + d) % d,
                edge = (e) => Math.min(Math.abs(e[0] - b0), d - Math.abs(e[0] - b0)) < 1e-6;
              crossed(clip, t0 - 1e-6, L.t, (e) => {
                if (edge(e)) {
                  let kp = e[0] / d;
                  if (ph > 0.5 && kp < 0.5) kp += 1;
                  if (!(kp > ph)) return;
                }
                R.events.push({ name: e[1], data: e[2], clip: L.name, at: e[0], from: tag });
              });
              R.evLast[tag] = { name: L.name, t: L.t, st: L.st };
              return;
            }
          }
          if (clip)
            crossed(clip, t0, L.t, (e) => R.events.push({ name: e[1], data: e[2], clip: L.name, at: e[0], from: tag }));
          R.evLast[tag] = L.name ? { name: L.name, t: L.t, st: L.st } : null;
        };
        evFrom(base, 'state');
        R.layers.forEach((L, i) => {
          const w = typeof L.weight === 'string' ? R.smooth(L.weight) : L.weight;
          if (w >= 0.5) evFrom(L, 'layer' + i);
          else R.evLast['layer' + i] = null;
        });
        // a shot fires from the time it last fired up to (t - dt can round below a key it already fired; an update(0) fires its key
        // at 0 once, never again)
        R.shots.forEach((sh) => {
          crossed(sh.clip, sh.evT == null ? -1e-9 : sh.evT, sh.t, (e) =>
            R.events.push({ name: e[1], data: e[2], clip: sh.name, at: e[0], from: 'shot' }),
          );
          sh.evT = sh.t;
        });
        for (const e of R.events) R.counts[e.name] = (R.counts[e.name] || 0) + 1;
        // 5d. mesh deform keys: the leading state clip's clip.deform, then the one-shots', added up, offsets per point; read
        // before finished one-shots leave, so a shot's last deform shows like its other channels
        if (def.meshes) {
          const D = {},
            add = (clip, t) => {
              for (const m in clip.deform || {}) {
                const o = D[m] || (D[m] = {});
                deformAt(clip.deform[m], t, o);
              }
            };
          const L = leadClip(def, base, sm),
            lc = L.name && def.clips[L.name];
          if (lc) add(lc, clipTime(lc, L.t));
          R.shots.forEach((s) => add(s.clip, Math.min(s.t, s.clip.dur)));
          R.deform = D;
          R.meshCache = {};
        }
        R.shots = R.shots.filter((s) => s.t < s.clip.dur);
        // 6. alive: a breath that never loops the same (two sines at an irrational ratio, each rig its own phase): def.alive { ch: [amp, period] }
        for (const ch in def.alive || {}) {
          const [amp, per] = def.alive[ch],
            w = 6.283 / (per || 3),
            p = phase[ch];
          P[ch] =
            (P[ch] == null ? def.rest[ch] || 0 : P[ch]) +
            amp * (0.7 * Math.sin(R.clock * w + p[0]) + 0.3 * Math.sin(R.clock * w * 1.618 + p[1]));
        }
        // 7. the gaze: def.look { x: 'eye.x', y: 'eye.y', head: 'head.rot', range: 3, head_gain: .25, saccade: [.8, 2.5] }. The eyes reach
        // the target fast, the head follows slower; small saccades around it; with no target the gaze wanders now and then
        if (def.look) {
          const L = R.look,
            S = def.look,
            sac = S.saccade || [0.8, 2.5];
          L.nextSac -= dt;
          if (L.nextSac <= 0) {
            L.nextSac = sac[0] + rand() * (sac[1] - sac[0]);
            const a = L.on ? 0.12 : 0.6;
            L.sx = (rand() * 2 - 1) * a;
            L.sy = (rand() * 2 - 1) * a * 0.5;
          }
          const gx = (L.on ? L.tx : 0) + L.sx,
            gy = (L.on ? L.ty : 0) + L.sy;
          const n = Math.max(1, Math.ceil(dt / 0.008)),
            h = dt / n,
            we = 30,
            wh = 7;
          for (let i = 0; i < n; i++) {
            [gx, gy].forEach((g, j) => {
              const acc = we * we * (g - L.eye[j]) - 2 * we * L.eyeV[j];
              L.eyeV[j] += acc * h;
              L.eye[j] += L.eyeV[j] * h;
            });
            const acc = wh * wh * (gx - L.head) - 2 * wh * L.headV;
            L.headV += acc * h;
            L.head += L.headV * h;
          }
          const r = S.range == null ? 3 : S.range,
            add = (ch, v) => {
              if (ch) P[ch] = (P[ch] == null ? def.rest[ch] || 0 : P[ch]) + v;
            };
          add(S.x, L.eye[0] * r);
          add(S.y, L.eye[1] * r);
          add(S.head, L.head * (S.head_gain == null ? 0.25 : S.head_gain));
        }
        // 8. springs: a damped follower per channel (a hat that lags, antennae that wobble); kick() throws them
        for (const ch in def.springs || {}) {
          const sp = def.springs[ch],
            s = R.springs[ch] || (R.springs[ch] = { x: 0, vel: 0 });
          const target = sp.input ? (R.inputs[sp.input] || 0) * (sp.scale || 1) : 0,
            n = Math.max(1, Math.ceil(dt / 0.008)),
            h = dt / n;
          for (let i = 0; i < n; i++) {
            s.vel += (sp.k * (target - s.x) - sp.d * s.vel) * h;
            s.x += s.vel * h;
          }
          P[ch] = (P[ch] == null ? def.rest[ch] || 0 : P[ch]) + s.x * (sp.gain || 1);
        }
        // 9. the controller's channels pass through untouched (def.owns): what it wrote with set(), else the rest pose
        if (def.owns) for (const ch in P) if (owned(ch)) P[ch] = ch in R.ctrl ? R.ctrl[ch] : def.rest[ch] || 0;
        for (const ch in R.ctrl) P[ch] = R.ctrl[ch];
        // 9b. constraints, in their listed order, each blended by its mix (a number or a channel, so a clip can let go):
        // ik (two bones reach a target), aim (a channel turns to face a target), copy (a channel follows another), path (a point
        // rides a curve). An ik with avoid [{ at, r }] keeps out of those circles: it picks the elbow side that crosses
        // less (swinging across over swing s) and slides its end to a circle's edge by at most dodge px (R.elbow, R.dodge,
        // R.cross). They read the controller's channels and never write them.
        R.ikDt = dt;
        for (const C of def.constraints || []) constrain(C, P);
        // 10. snap and hold: a big change jumps past its target and holds a beat, small drifts ease (never on owned channels)
        for (const ch in def.snap || {}) {
          if (owned(ch)) continue;
          const t = P[ch] == null ? def.rest[ch] || 0 : P[ch],
            f = R.snapS[ch] || (R.snapS[ch] = { d: t, hold: 0 });
          if (f.hold > 0) f.hold -= dt;
          else if (Math.abs(t - f.d) > def.snap[ch]) {
            f.d = t + (t - f.d) * (def.snapOver == null ? 0.3 : def.snapOver);
            f.hold = def.snapHold == null ? 0.2 : def.snapHold;
          } else f.d += (t - f.d) * (1 - Math.exp(-12 * dt));
          P[ch] = f.d;
        }
        // 11. marks age; a state's mark stays alive while the rig is in it
        for (const st in def.markStates || {})
          if (base.state === st && !R.marks.some((m) => m.name === [].concat(def.markStates[st])[0]))
            R.mark(def.markStates[st]);
        R.marks.forEach((m) => {
          m.age += dt;
          m.t = Math.min(1, m.age / (m.life || 1));
        });
        R.marks = R.marks.filter((m) => m.age < m.life);
        R.pose = P;
        // 12. held poses (def.hold, in Hz): the pose sampled at that rate, for a skin that wants it
        if (def.hold) {
          R.holdT += dt;
          if (!R.held || R.holdT >= 1 / def.hold) {
            R.holdT = R.held ? R.holdT % (1 / def.hold) : 0;
            R.held = Object.assign({}, P);
          }
        }
        return R;
      },
    };
    const pt = (p, P) =>
      typeof p === 'string' ? R.targets[p] || (P[p + '.x'] != null ? [P[p + '.x'], P[p + '.y']] : null) : p;
    const put = (P, ch, v, m) => {
      if (!ch || owned(ch)) return;
      const cur = P[ch] == null ? def.rest[ch] || 0 : P[ch];
      P[ch] = cur + (v - cur) * m;
    };
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    function constrain(C, P) {
      const m =
        typeof C.mix === 'string' ? (P[C.mix] == null ? def.rest[C.mix] || 0 : P[C.mix]) : C.mix == null ? 1 : C.mix;
      if (!(m > 0)) return;
      const k = Math.min(1, m);
      if (C.ik) {
        const root = pt(C.root, P);
        let tg = pt(C.target, P);
        if (!root || !tg) return;
        let bend = C.bend == null ? 1 : C.bend,
          s;
        if (C.avoid) {
          // repulsion: the limb keeps out of circles (a face, the other arm) by its elbow side and a small dodge of the end
          const circ = C.avoid
            .map((a) => {
              const c = pt(a.at, P);
              return c && [c[0], c[1], a.r];
            })
            .filter(Boolean);
          const pen = (a, b) =>
            circ.reduce((t, [cx, cy, r]) => {
              const dx = b[0] - a[0],
                dy = b[1] - a[1],
                u = Math.max(0, Math.min(1, ((cx - a[0]) * dx + (cy - a[1]) * dy) / (dx * dx + dy * dy || 1)));
              return t + Math.max(0, r - Math.hypot(a[0] + dx * u - cx, a[1] + dy * u - cy));
            }, 0);
          // the dodge: an end inside a circle slides to its edge, by at most C.dodge px (default 8)
          const cap = C.dodge == null ? 8 : C.dodge;
          let moved = 0;
          for (const [cx, cy, r] of circ) {
            let dx = tg[0] - cx,
              dy = tg[1] - cy,
              d = Math.hypot(dx, dy);
            if (d < 1e-6) {
              dx = tg[0] - root[0];
              dy = tg[1] - root[1];
              d = Math.hypot(dx, dy);
              if (d < 1e-6) {
                dx = 0;
                dy = -1;
                d = 1;
              }
            } // on the centre: slide away from the root
            const need = Math.min(cap - moved, r - Math.hypot(tg[0] - cx, tg[1] - cy));
            if (need > 0) {
              tg = [tg[0] + (dx / d) * need, tg[1] + (dy / d) * need];
              moved += need;
            }
          }
          R.dodge[C.ik] = moved;
          // the swivel: of the two elbow sides, the one that crosses less; the side in use keeps it unless the other is clearly better (2 px)
          const cost = (b) => {
            const q = bones.ik2(root, tg, C.lens[0], C.lens[1], b),
              e = [root[0] + Math.cos(q.a1) * C.lens[0], root[1] + Math.sin(q.a1) * C.lens[0]];
            return pen(root, e) + pen(e, tg);
          };
          const was = R.elbow[C.ik] == null ? bend : R.elbow[C.ik],
            other = -was,
            cw = cost(was),
            co = cost(other);
          bend = co + 2 < cw ? other : was;
          if (bend !== was) R.swivel[C.ik] = { from: was, t: 0 };
          R.elbow[C.ik] = bend;
          R.cross[C.ik] = Math.min(cw, co);
        }
        s = bones.ik2(root, tg, C.lens[0], C.lens[1], bend);
        R.reach[C.ik] = s.reach;
        const sw = R.swivel[C.ik]; // a side change swings the elbow across over C.swing seconds (default .15) instead of popping
        if (sw) {
          sw.t += R.ikDt || 0;
          const u = Math.min(1, sw.t / (C.swing == null ? 0.15 : C.swing)),
            e = u * u * (3 - 2 * u),
            q = bones.ik2(root, tg, C.lens[0], C.lens[1], sw.from);
          s = { a1: q.a1 + wrap(s.a1 - q.a1) * e, a2: q.a2 + (s.a2 - q.a2) * e, reach: s.reach };
          if (u >= 1) delete R.swivel[C.ik];
        }
        const [b1, b2] = C.bones,
          cur1 = P[b1] == null ? def.rest[b1] || 0 : P[b1];
        put(P, b1, cur1 + wrap(s.a1 - (C.base || 0) - cur1), k);
        put(P, b2, s.a2, k);
      } // the shortest way round, so a blend never spins
      else if (C.aim) {
        const root = pt(C.root, P),
          tg = pt(C.target, P);
        if (!root || !tg) return;
        let a = Math.atan2(tg[1] - root[1], tg[0] - root[0]) - (C.offset || 0);
        if (C.limit) {
          const cur = C.center || 0;
          a = cur + Math.max(C.limit[0], Math.min(C.limit[1], wrap(a - cur)));
        }
        const cur = P[C.aim] == null ? def.rest[C.aim] || 0 : P[C.aim];
        put(P, C.aim, cur + wrap(a - cur), k);
      } else if (C.copy) {
        const v =
          (P[C.from] == null ? def.rest[C.from] || 0 : P[C.from]) * (C.scale == null ? 1 : C.scale) + (C.offset || 0);
        put(P, C.copy, v, k);
      } else if (C.path) {
        const t = typeof C.at === 'string' ? (P[C.at] == null ? def.rest[C.at] || 0 : P[C.at]) : C.at || 0,
          q = bones.along(C.points, t, C.closed);
        put(P, C.x || C.path + '.x', q[0], k);
        put(P, C.y || C.path + '.y', q[1], k);
        if (C.rot !== false) {
          const rc = C.rot || C.path + '.rot',
            last = R.heading[rc],
            h = last == null ? q[2] : last + wrap(q[2] - last);
          R.heading[rc] = h;
          put(P, rc, h, k);
        }
      } // the heading stays continuous (no jump at ±π), so a partial mix never flips it
    }
    if (base.state) R.log.push(base.state);
    return R;
  }
  // ---- bones: skeletal chains (a limb, a tail, a held weapon). Joint angles are relative to the parent bone, so the hand stays at
  // the end of the forearm and the weapon leaves from the hand whatever the pose. Angles in radians, canvas frame: 0 = +x, positive =
  // clockwise (y points down); a character facing left mirrors its x. The angles can come from a rig's channels (r.pose) or from
  // follow(), which tracks a target pose with critically damped springs and a speed cap (a heavy club is never flicked).
  function along(...a) {
    return bones.along(...a);
  }
  along.cache = new WeakMap();
  const bones = {
    // forward kinematics: root [x, y], bones [{ joint, len }] in order, pose { joint: angle } -> { pts: [[x, y]...], angles: [...] }
    chain(root, list, pose, base) {
      let x = root[0],
        y = root[1],
        a = base || 0;
      const pts = [[x, y]],
        angles = [];
      list.forEach((b) => {
        a += pose[b.joint] || 0;
        x += Math.cos(a) * b.len;
        y += Math.sin(a) * b.len;
        pts.push([x, y]);
        angles.push(a);
      });
      return { pts, angles };
    },
    // a follower: f = bones.follower(['sh', 'el']); f.step(target, dt, stiff = 16 rad/s, maxSpeed = 10 rad/s) -> pose (never overshoots)
    follower(joints) {
      const F = {
        joints,
        pose: null,
        vel: {},
        step(target, dt, stiff, maxSpeed) {
          const w = stiff || 16,
            cap = maxSpeed || 10;
          if (!F.pose || !(dt >= 0) || dt > 1) {
            F.pose = Object.assign({}, target);
            joints.forEach((j) => (F.vel[j] = 0));
            return F.pose;
          }
          const n = Math.max(1, Math.ceil(dt / (1 / 120))),
            h = dt / n;
          for (let i = 0; i < n; i++)
            joints.forEach((j) => {
              const x = F.pose[j],
                v = F.vel[j] || 0,
                acc = w * w * ((target[j] || 0) - x) - 2 * w * v;
              F.vel[j] = Math.max(-cap, Math.min(cap, v + acc * h));
              F.pose[j] = x + F.vel[j] * h;
            });
          return F.pose;
        },
        set(pose) {
          F.pose = Object.assign({}, pose);
          joints.forEach((j) => (F.vel[j] = 0));
        },
      };
      return F;
    },
    // blend two poses (t = 0 -> a, 1 -> b)
    mix(a, b, t) {
      const o = {};
      Object.keys(a).forEach((k) => (o[k] = a[k] + ((k in b ? b[k] : a[k]) - a[k]) * t));
      return o;
    },
    // two-bone IK: root [x, y], target [x, y], bone lengths, bend 1 or -1 (which side the elbow or knee goes) ->
    // { a1: the first bone's angle, a2: the second's relative to it, reach: distance / full length (over 1: out of reach) }.
    // Out of reach, the limb points straight at the target; too close, it folds as far as it can. Same frame as chain().
    ik2(root, target, l1, l2, bend) {
      const dx = target[0] - root[0],
        dy = target[1] - root[1],
        far = Math.hypot(dx, dy),
        s = bend == null ? 1 : bend;
      const d = Math.max(Math.abs(l1 - l2) + 1e-6, Math.min(l1 + l2 - 1e-6, far)),
        base = Math.atan2(dy, dx);
      const al = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))),
        be = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
      return { a1: base - s * al, a2: s * (Math.PI - be), reach: far / (l1 + l2) };
    },
    // a point along a smooth curve through points (Catmull-Rom), t in 0..1 by length; closed loops back to the start.
    // -> [x, y, heading]
    along(points, t, closed) {
      const n = points.length;
      if (!n) return [0, 0, 0];
      if (n === 1) return [points[0][0], points[0][1], 0];
      const segs = closed ? n : n - 1,
        P = (i) => points[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
      const at = (i, u) => {
        const p0 = P(i - 1),
          p1 = P(i),
          p2 = P(i + 1),
          p3 = P(i + 2),
          u2 = u * u,
          u3 = u2 * u;
        return [0, 1].map(
          (j) =>
            0.5 *
            (2 * p1[j] +
              (-p0[j] + p2[j]) * u +
              (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 +
              (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3),
        );
      };
      const key = points;
      let tab = along.cache.get(key);
      if (!tab || tab.closed !== !!closed) {
        tab = { closed: !!closed, len: [0] };
        let L = 0,
          prev = at(0, 0);
        for (let i = 0; i < segs; i++)
          for (let k = 1; k <= 16; k++) {
            const q = at(i, k / 16);
            L += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
            tab.len.push(L);
            prev = q;
          }
        along.cache.set(key, tab);
      }
      let u = closed ? ((t % 1) + 1) % 1 : Math.max(0, Math.min(1, t));
      const L = tab.len[tab.len.length - 1] * u;
      let lo = 0,
        hi = tab.len.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (tab.len[mid] < L) lo = mid;
        else hi = mid;
      }
      const f = lo + (L - tab.len[lo]) / (tab.len[hi] - tab.len[lo] || 1),
        seg = Math.min(segs - 1, Math.floor(f / 16)),
        uu = f / 16 - seg;
      const q = at(seg, Math.min(1, uu)),
        q2 = at(seg, Math.min(1, uu + 0.01)),
        q1 = uu + 0.01 > 1 ? at(seg, uu - 0.01) : q;
      return [
        q[0],
        q[1],
        uu + 0.01 > 1 ? Math.atan2(q[1] - q1[1], q[0] - q1[0]) : Math.atan2(q2[1] - q[1], q2[0] - q[0]),
      ];
    },
  };
  // ---- an audience: watchers that see what happens, each when the news reaches it, look at it and remember it
  function audience(opts) {
    const o = opts || {},
      mem = Object.assign({ life: 20, full: 3, input: 'wary' }, o.memory);
    let rnd = ((o.seed || 7) * 9301) % 233280;
    const rand = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280;
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const A = {
      members: [],
      queue: [],
      clock: 0,
      speed: o.speed || 650,
      jitter: o.jitter == null ? 0.08 : o.jitter,
      look: o.look == null ? 0.8 : o.look,
      habitLife: o.habitLife || 40,
      habits: {},
      memory: mem,
      add(rig, x, y, name) {
        const m = { rig, x, y, name: name || 'w' + A.members.length, seen: 0, lookT: 0 };
        A.members.push(m);
        return m;
      },
      move(m, x, y) {
        m.x = x;
        m.y = y;
        return A;
      },
      // something happened at (x, y): each watcher hears of it after its distance / speed, sees where, and remembers it
      react(x, y, ev, data) {
        A.members.forEach((m) =>
          A.queue.push({ at: A.clock + Math.hypot(x - m.x, y - m.y) / A.speed + rand() * A.jitter, m, ev, x, y, data }),
        );
        A.queue.sort((a, b) => a.at - b.at);
        return A;
      },
      // the player's habit: how this move reads against the recent ones (decayed counts)
      habit(key) {
        const k = Math.pow(0.5, (A.clock - (A.habitAt || 0)) / A.habitLife);
        A.habitAt = A.clock;
        for (const h in A.habits) A.habits[h] *= k;
        A.habits[key] = (A.habits[key] || 0) + 1;
        let tot = 0;
        for (const h in A.habits) tot += A.habits[h];
        const share = A.habits[key] / tot;
        return tot < (o.habitMin || 6) ? 'new' : share > 0.25 ? 'stale' : share < 0.06 ? 'fresh' : 'plain';
      },
      update(dt) {
        if (!(dt >= 0) || dt > 1) dt = 0;
        A.clock += dt;
        const fade = Math.pow(0.5, dt / mem.life);
        while (A.queue.length && A.queue[0].at <= A.clock) {
          const q = A.queue.shift(),
            m = q.m,
            range = o.range || 300;
          // where it happened, seen from where the watcher stands now (it may have moved while the news travelled)
          const dx = q.x - m.x,
            dy = q.y - m.y,
            d = Object.assign({}, q.data, { dx: clamp(dx / range), dy: clamp(dy / range), dist: Math.hypot(dx, dy) });
          m.seen += 1;
          if (A.look) {
            m.rig.lookAt(d.dx, d.dy);
            m.lookT = A.look;
          }
          m.rig.event(q.ev, d);
        }
        A.members.forEach((m) => {
          m.seen *= fade;
          if (mem.input) m.rig.inputs[mem.input] = Math.min(1, m.seen / mem.full);
          if (m.lookT > 0 && (m.lookT -= dt) <= 0) m.rig.lookAt(null);
        });
        return A;
      },
    };
    return A;
  }
  // ---- the rig lab: a panel over the running page for the rigs you expose. Rig.expose('hero', rig) names a rig for it; ?rig in the
  // URL opens it, and so does Rig.lab() (or Rig.lab([{ name, rig }]) for a list of your own). A slider per input, the states and
  // one-shots as buttons, the gaze following the pointer. Tuning happens live, in the running game.
  const exposed = [];
  function expose(name, rig) {
    const i = exposed.findIndex((x) => x.name === name);
    if (i >= 0) exposed[i].rig = rig;
    else exposed.push({ name, rig });
    if (lab.refresh) lab.refresh();
    return rig;
  }
  function lab(list) {
    if (lab.on || typeof document === 'undefined') return;
    lab.on = true;
    const src = () =>
      typeof list === 'function'
        ? list() || []
        : Array.isArray(list)
          ? list
          : list
            ? Object.keys(list).map((name) => ({ name, rig: list[name] }))
            : exposed.slice();
    const css =
      'position:fixed;top:8px;left:8px;z-index:99999;max-height:calc(100vh - 16px);overflow:auto;width:min(300px,calc(100vw - 16px));background:rgba(20,20,28,.92);color:#fff;font:12px/1.35 system-ui,sans-serif;border-radius:10px;padding:8px 10px;box-shadow:0 4px 18px rgba(0,0,0,.4)';
    const box = document.createElement('div');
    box.id = 'rigLab';
    box.style.cssText = css;
    document.body.appendChild(box);
    const esc = (t) =>
      String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    let rigs = [],
      follow = false;
    const head = (extra) =>
      '<div style="display:flex;gap:8px;align-items:center"><b style="flex:1">Rig lab</b>' +
      extra +
      '<button id="rlClose" aria-label="Close the lab" style="padding:0 6px">\u00d7</button></div>';
    const build = () => {
      rigs = src();
      if (!rigs.length) {
        box.innerHTML = head('') + 'No rig to show: call <code>Rig.expose(name, rig)</code>.';
        box.querySelector('#rlClose').addEventListener('click', lab.close);
        return;
      }
      box.innerHTML =
        head('<label><input type="checkbox" id="rlFollow"> gaze follows the pointer</label>') +
        rigs
          .map((x, i) => {
            const d = x.rig.def,
              ins = Object.keys(Object.assign({}, d.inputs || {}, x.rig.inputs)),
              rng = d.ranges || {};
            const blends = [];
            const scan = (st) => {
              for (const k in st) if (st[k] && st[k].blend && !blends.includes(st[k].blend)) blends.push(st[k].blend);
            };
            scan(d.states);
            (d.layers || []).forEach((l) => scan(l.states));
            const all = [...new Set(ins.concat(blends))],
              used = new Set();
            [d.states].concat((d.layers || []).map((l) => l.states)).forEach((st) => {
              for (const k in st || {}) {
                const v = st[k];
                if (typeof v === 'string') used.add(v);
                else if (v && v.clips) v.clips.forEach((c) => used.add(c[1]));
              }
            });
            return (
              '<div style="border-top:1px solid #444;margin-top:6px;padding-top:6px"><b>' +
              esc(x.name) +
              '</b> <span id="rlS' +
              i +
              '" style="opacity:.7"></span>' +
              all
                .map((n) => {
                  const r = rng[n] || [0, 1];
                  return (
                    '<div><label>' +
                    esc(n) +
                    ' <input type="range" min="' +
                    r[0] +
                    '" max="' +
                    r[1] +
                    '" step="' +
                    (r[1] - r[0]) / 100 +
                    '" value="' +
                    (x.rig.inputs[n] || 0) +
                    '" data-rig="' +
                    i +
                    '" data-in="' +
                    esc(n) +
                    '" style="width:100%"></label></div>'
                  );
                })
                .join('') +
              '<div>' +
              Object.keys(d.states || {})
                .map((n) => '<button data-rig="' + i + '" data-go="' + esc(n) + '">' + esc(n) + '</button>')
                .join(' ') +
              '</div>' +
              '<div style="margin-top:3px">' +
              Object.keys(d.clips || {})
                .filter((n) => !used.has(n))
                .map((n) => '<button data-rig="' + i + '" data-fire="' + esc(n) + '">!' + esc(n) + '</button>')
                .join(' ') +
              '</div>' +
              (d.skins
                ? '<div style="margin-top:3px">' +
                  Object.keys(d.skins)
                    .map((n) => '<button data-rig="' + i + '" data-skin="' + esc(n) + '">~' + esc(n) + '</button>')
                    .join(' ') +
                  '</div>'
                : '') +
              '</div>'
            );
          })
          .join('');
      box.querySelectorAll('input[data-in]').forEach((el) =>
        el.addEventListener('input', () => {
          rigs[+el.dataset.rig].rig.inputs[el.dataset.in] = +el.value;
        }),
      );
      box
        .querySelectorAll('[data-go]')
        .forEach((el) => el.addEventListener('click', () => rigs[+el.dataset.rig].rig.go(el.dataset.go, 0.2)));
      box
        .querySelectorAll('[data-skin]')
        .forEach((el) => el.addEventListener('click', () => rigs[+el.dataset.rig].rig.skin(el.dataset.skin)));
      box
        .querySelectorAll('[data-fire]')
        .forEach((el) => el.addEventListener('click', () => rigs[+el.dataset.rig].rig.fire(el.dataset.fire)));
      box.querySelector('#rlClose').addEventListener('click', lab.close);
      const f = box.querySelector('#rlFollow');
      if (f)
        f.addEventListener('change', () => {
          follow = f.checked;
          if (!follow) rigs.forEach((x) => x.rig.lookAt(null));
        });
    };
    const onMove = (e) => {
      if (!follow) return;
      rigs.forEach((x) => x.rig.lookAt((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1));
    };
    addEventListener('pointermove', onMove);
    lab.close = () => {
      removeEventListener('pointermove', onMove);
      if (follow) rigs.forEach((x) => x.rig.lookAt(null));
      box.remove();
      lab.on = false;
      lab.refresh = null;
    };
    const tick = () => {
      if (!lab.on) return;
      rigs.forEach((x, i) => {
        const el = document.getElementById('rlS' + i);
        if (el) {
          const r = x.rig,
            sig = Object.keys(r.signals),
            dr = r.drives(),
            fx = (v) => (typeof v === 'number' ? +v.toFixed(2) : v);
          el.textContent =
            r.state +
            (r.shots.length ? ' + ' + r.shots.map((s) => s.name).join(',') : '') +
            (sig.length ? ' | fed ' + sig.map((k) => k + ' ' + fx(r.signals[k])).join(', ') : '') +
            (Object.keys(dr).length
              ? ' | drives ' +
                Object.keys(dr)
                  .map((k) => k + ' ' + fx(dr[k].target) + '@' + fx(dr[k].gain))
                  .join(', ')
              : '') +
            (r.def.slots
              ? ' | slots ' +
                Object.keys(r.slots)
                  .map((k) => k + ' ' + r.slots[k] + (r.slotFrom[k] ? ' (' + r.slotFrom[k] + ')' : ''))
                  .join(', ')
              : '');
        }
      });
      setTimeout(tick, 200);
    };
    lab.refresh = build;
    build();
    tick();
  }
  if (
    typeof location !== 'undefined' &&
    typeof addEventListener === 'function' &&
    /[?&]rig(=|&|$)/.test(location.search || '')
  )
    addEventListener('load', () => lab());
  // ---- phys (from Cascadeur): a body that weighs. A few weighted points held rigid by sticks (shoulders and hips), tied to
  // the world by links: a rope (a hand on a hold: never longer than max), a strut (a foot on a step: between min and max), each
  // with a rest length it leans toward (soft). Gravity pulls; the pose follows from where the links hold, so the game never places
  // the body by hand: a one-hand hang swings under that hand and tilts, feet under the hips take the weight, a jump flies a true
  // arc. Position-based dynamics at a fixed 120 Hz step, so the same inputs give the same motion.
  //   const W = Rig.phys.create({ points: { shL: { at: [-13, -30], m: 1 }, ... }, sticks: [['shL', 'shR'], ...], gravity: 900 });
  //   W.link('armL', 'shL', [x, y], { max: 41 }); W.link('legL', 'hipL', [x, y], { min: 20, rest: 44, soft: .25, pull: .04 }); W.unlink('armL'); W.step(dt);
  //   W.load.armL: the share of the body's weight the link carries (1 = all of it; struts by how upright, ropes the rest); W.com(), W.vel(), W.launch(vx, vy);
  //   W.frame('hipL', 'hipR', 'shL', 'shR') -> { x, y, rot }: a pelvis point and the spine's lean, for the rig's local frame.
  const phys = {
    create(o) {
      const W = {
        p: {},
        sticks: [],
        links: {},
        load: {},
        gravity: o.gravity == null ? 900 : o.gravity,
        damp: o.damp == null ? 0.02 : o.damp,
        air: o.air || 0,
        iters: o.iters || 8,
        acc: 0,
        h: 1 / 120,
      };
      for (const k in o.points) {
        const q = o.points[k];
        W.p[k] = { x: q.at[0], y: q.at[1], px: q.at[0], py: q.at[1], m: q.m || 1 };
      }
      (o.sticks || []).forEach(([a, b]) => W.sticks.push([a, b, Math.hypot(W.p[a].x - W.p[b].x, W.p[a].y - W.p[b].y)]));
      const mass = () => Object.values(W.p).reduce((t, q) => t + q.m, 0);
      W.link = (name, point, at, opt) => {
        W.links[name] = Object.assign({ point, at: at.slice(), min: 0, max: Infinity, rest: null, soft: 0 }, opt || {});
        return W;
      };
      W.unlink = (name) => {
        delete W.links[name];
        delete W.load[name];
        return W;
      };
      W.move = (name, at) => {
        if (W.links[name]) W.links[name].at = at.slice();
        return W;
      };
      W.com = () => {
        let x = 0,
          y = 0,
          M = 0;
        for (const k in W.p) {
          const q = W.p[k];
          x += q.x * q.m;
          y += q.y * q.m;
          M += q.m;
        }
        return [x / M, y / M];
      };
      W.vel = () => {
        let x = 0,
          y = 0,
          M = 0;
        for (const k in W.p) {
          const q = W.p[k];
          x += (q.x - q.px) * q.m;
          y += (q.y - q.py) * q.m;
          M += q.m;
        }
        return [x / M / W.h, y / M / W.h];
      };
      W.launch = (vx, vy) => {
        for (const k in W.p) {
          const q = W.p[k];
          q.px = q.x - vx * W.h;
          q.py = q.y - vy * W.h;
        }
        return W;
      };
      W.place = (dx, dy) => {
        for (const k in W.p) {
          const q = W.p[k];
          q.x += dx;
          q.y += dy;
          q.px += dx;
          q.py += dy;
        }
        return W;
      };
      W.frame = (hl, hr, sl, sr) => {
        const a = W.p[hl],
          b = W.p[hr],
          c = W.p[sl],
          d = W.p[sr],
          x = (a.x + b.x) / 2,
          y = (a.y + b.y) / 2,
          ux = (c.x + d.x) / 2 - x,
          uy = (c.y + d.y) / 2 - y;
        return { x, y, rot: Math.atan2(ux, -uy) };
      }; // 0 = upright, positive = leaning right (clockwise on the canvas)
      W.step = (dt) => {
        W.acc = Math.min(W.acc + (dt > 0 ? dt : 0), 0.1);
        let steps = 0;
        while (W.acc >= W.h) {
          W.acc -= W.h;
          steps++;
          const dmp = Object.keys(W.links).length ? W.damp : W.air; // held, the joints and the grip damp a swing; in the air nothing does
          for (const k in W.p) {
            const q = W.p[k],
              vx = (q.x - q.px) * (1 - dmp),
              vy = (q.y - q.py) * (1 - dmp);
            q.px = q.x;
            q.py = q.y;
            q.x += vx;
            q.y += vy + W.gravity * W.h * W.h;
          }
          for (let it = 0; it < W.iters; it++) {
            // a link holds between min and max and leans toward its rest length: soft when it is shorter (a bent leg pushes), pull when longer
            for (const n in W.links) {
              const L = W.links[n],
                q = W.p[L.point],
                dx = q.x - L.at[0],
                dy = q.y - L.at[1],
                d = Math.hypot(dx, dy) || 1e-6;
              let goal = d;
              if (L.rest != null) {
                const k = d < L.rest ? L.soft : L.pull || 0;
                if (k) goal = d + (L.rest - d) * k;
              }
              goal = Math.max(L.min, Math.min(L.max, goal));
              if (goal !== d) {
                const c = (d - goal) / d;
                q.x -= dx * c;
                q.y -= dy * c;
              }
            }
            for (const [a, b, len] of W.sticks) {
              const A = W.p[a],
                Bq = W.p[b],
                dx = Bq.x - A.x,
                dy = Bq.y - A.y,
                d = Math.hypot(dx, dy) || 1e-6,
                c = (d - len) / d / (A.m + Bq.m);
              A.x += dx * c * Bq.m;
              A.y += dy * c * Bq.m;
              Bq.x -= dx * c * A.m;
              Bq.y -= dy * c * A.m;
            }
          }
        }
        // the share of the body's weight each link carries, from statics rather than from the solver's corrections (two links that
        // squeeze the body would both read huge): a strut carries by how upright it stands under its point (half the weight each,
        // all of it at most), the taut ropes share the rest (a slack one barely carries)
        let up = 0;
        const struts = [],
          ropes = [];
        for (const n in W.links) {
          const L = W.links[n],
            q = W.p[L.point],
            d = Math.hypot(q.x - L.at[0], q.y - L.at[1]) || 1e-6;
          if (L.rest != null) {
            const v = Math.max(0, (L.at[1] - q.y) / d) * 0.5;
            struts.push([n, v]);
            up += v;
          } else ropes.push([n, L.max < Infinity ? (d > L.max * 0.85 ? 1 : 0.15) : 1]);
        }
        // with no rope to take the rest, the struts carry it all (one foot planted alone holds the whole body)
        const tw = ropes.reduce((t, r) => t + r[1], 0),
          k = up > 1 || (up > 0 && !tw) ? 1 / up : 1,
          left = Math.max(0, 1 - up * k);
        W.load = {};
        struts.forEach(([n, v]) => (W.load[n] = v * k));
        ropes.forEach(([n, w]) => (W.load[n] = tw > 0 ? (left * w) / tw : 0));
        if (!struts.length && !ropes.length) W.load = {};
        return W;
      };
      return W;
    },
  };
  // mesh helpers: Rig.mesh.grid(x, y, w, h, cols, rows) -> { points, tris } for a picture's rectangle; Rig.mesh.draw(ctx, img,
  // r, name) draws the picture on the rig's mesh this frame, one affine triangle at a time (each grown by half a pixel, so no seam
  // shows), in the character's frame: translate and scale the context first. img is anything drawImage takes (a canvas too).
  const mesh = {
    grid(x, y, w, h, cols, rows) {
      const points = [],
        tris = [],
        c = cols + 1;
      for (let j = 0; j <= rows; j++)
        for (let i = 0; i <= cols; i++) points.push([x + (w * i) / cols, y + (h * j) / rows]);
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const a = j * c + i;
          tris.push([a, a + 1, a + c], [a + 1, a + c + 1, a + c]);
        }
      return { points, tris };
    },
    draw(ctx, img, r, name) {
      const M = r.meshDef(name),
        P = r.mesh(name);
      if (!M || !P) return;
      const iw = img.width,
        ih = img.height;
      for (const [a, b, c] of M.tris) {
        const x0 = P[2 * a],
          y0 = P[2 * a + 1],
          x1 = P[2 * b],
          y1 = P[2 * b + 1],
          x2 = P[2 * c],
          y2 = P[2 * c + 1];
        const u0 = M.uv[a][0] * iw,
          v0 = M.uv[a][1] * ih,
          u1 = M.uv[b][0] * iw,
          v1 = M.uv[b][1] * ih,
          u2 = M.uv[c][0] * iw,
          v2 = M.uv[c][1] * ih;
        const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
        if (!det) continue;
        const A = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det,
          B = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det,
          C = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det,
          D = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
        const cx = (x0 + x1 + x2) / 3,
          cy = (y0 + y1 + y2) / 3,
          g = (x, y) => {
            const dx = x - cx,
              dy = y - cy,
              l = Math.hypot(dx, dy) || 1;
            return [x + (dx / l) * 0.6, y + (dy / l) * 0.6];
          };
        const [p0, p1, p2] = [g(x0, y0), g(x1, y1), g(x2, y2)];
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.closePath();
        ctx.clip();
        ctx.transform(A, C, B, D, x0 - A * u0 - B * v0, y0 - C * u0 - D * v0);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      }
    },
  };
  // ---- a definition read back without a screen: play it for a few seconds and say what moved, what played and what never did.
  //   Rig.report(def, { seconds: 6, fps: 60, seed: 1, name: 'pip', script: [{ at: 1, event: 'poke' }, { at: 2, inputs: { fear: 1 } }] })
  // A script step happens at its time (seconds) and may carry: event (+ data), inputs, fire, go (+ fade), look ([x, y] or null),
  // feed, set, attach ([slot, name, seconds?]), skin, kick ({ channel: velocity }).
  // Returns { ok, text, warnings, problems, notes, states, layers, played, never, channels, events, slots }. ok is false when the
  // definition has a mistake (rig.warnings), a channel is not a number, or a script step names something the rig does not have.
  function report(def, o) {
    o = o || {};
    const secs = o.seconds > 0 ? +o.seconds : 6,
      fps = o.fps > 0 ? +o.fps : 60,
      dt = 1 / fps,
      frames = Math.round(secs * fps);
    const rig = create(def, o.seed),
      d = rig.def,
      r3 = (v) => Math.round(v * 1000) / 1000;
    const log = [],
      note0 = rig.note;
    rig.note = (e) => {
      log.push(e);
      note0(e);
    };
    const script = (o.script || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0)),
      problems = [],
      sent = {};
    const states = {},
      layers = rig.layers.map(() => ({})),
      ch = {},
      slots = {};
    const see = (k, v) => {
      const c = ch[k] || (ch[k] = { rest: d.rest[k] || 0, min: Infinity, max: -Infinity, bad: false });
      if (typeof v !== 'number' || !isFinite(v)) c.bad = true;
      else {
        if (v < c.min) c.min = v;
        if (v > c.max) c.max = v;
      }
    };
    const run = (s) => {
      if (s.inputs) Object.assign(rig.inputs, s.inputs);
      if (s.feed) rig.feed(s.feed);
      if (s.set) rig.set(s.set);
      if (s.event != null) {
        sent[s.event] = (sent[s.event] || 0) + 1;
        if (!(d.on && s.event in d.on))
          problems.push(`the script sends the event ${s.event}, which def.on does not have`);
        else rig.event(s.event, s.data);
      }
      if (s.fire != null && !rig.fire(s.fire))
        problems.push(`the script fires ${s.fire}, which def.clips does not have`);
      if (s.go != null) {
        if (s.go in d.states) rig.go(s.go, s.fade);
        else problems.push(`the script goes to state ${s.go}, which does not exist`);
      }
      if ('look' in s) s.look ? rig.lookAt(s.look[0], s.look[1]) : rig.lookAt(null);
      if (s.attach) rig.attach(s.attach[0], s.attach[1], s.attach[2]);
      if (s.skin != null) rig.skin(s.skin);
      for (const k in s.kick || {}) rig.kick(k, s.kick[k]);
    };
    // the clips a state plays this frame: its clip, or the clips of its blend that weigh something at the input's value now
    const inState = {},
      heard = (v) => {
        if (typeof v === 'string') inState[v] = true;
        else if (v && v.clips && v.clips.length) {
          const cs = v.clips.slice().sort((a, b) => a[0] - b[0]),
            x = v.blend in rig.smoothed ? rig.smoothed[v.blend] : rig.inputs[v.blend] || 0;
          let i = 0;
          while (i < cs.length - 1 && x >= cs[i + 1][0]) i++;
          inState[cs[i][1]] = true;
          if (i < cs.length - 1 && x > cs[i][0] + 1e-3) inState[cs[i + 1][1]] = true;
        }
      };
    let si = 0;
    const counts = {};
    for (let f = 0; f < frames; f++) {
      const t = f * dt;
      while (si < script.length && (script[si].at || 0) <= t + 1e-9) run(script[si++]);
      rig.update(dt);
      if (rig.state != null) {
        states[rig.state] = (states[rig.state] || 0) + dt;
        heard(d.states[rig.state]);
      }
      rig.layers.forEach((l, i) => {
        if (l.state == null) return;
        layers[i][l.state] = (layers[i][l.state] || 0) + dt;
        heard(((d.layers[i] || {}).states || {})[l.state]);
      });
      for (const k in d.rest) see(k, rig.v(k));
      for (const k in rig.pose) see(k, rig.pose[k]);
      for (const k in rig.slots) {
        const v = rig.slots[k] == null ? '(nothing)' : String(rig.slots[k]);
        (slots[k] = slots[k] || {})[v] = true;
      }
      for (const e of rig.events) counts[e.name] = (counts[e.name] || 0) + 1;
    }
    for (; si < script.length; si++)
      problems.push(`a script step at ${script[si].at} s is after the end of the run (${secs} s)`);
    // what played: a state's clip (a blend's clips once the input gave them weight), and each one-shot fired
    const played = {};
    const mark = (n, how) => {
      if (!(n in d.clips)) return;
      const p = played[n] || (played[n] = { state: false, shots: 0 });
      if (how === 'state') p.state = true;
      else p.shots++;
    };
    for (const n in inState) mark(n, 'state');
    for (const e of log) if (e[0] === '!') mark(e.slice(1), 'shot');
    const never = {
      clips: Object.keys(d.clips).filter((n) => !played[n]),
      states: Object.keys(d.states).filter((n) => !states[n]),
      reactions: Object.keys(d.on || {}).filter((n) => !sent[n] && !log.includes('@' + n)),
      still: [],
    };
    const channels = {},
      bad = [];
    for (const k of Object.keys(ch).sort()) {
      const c = ch[k],
        moved = c.max - c.min > 1e-6;
      channels[k] = {
        rest: c.rest,
        min: c.min === Infinity ? null : r3(c.min),
        max: c.max === -Infinity ? null : r3(c.max),
        moved,
      };
      if (c.bad) bad.push(k);
      else if (!moved && k in d.rest) never.still.push(k);
    }
    for (const k of bad)
      problems.push(`${k} is not a number at some frame (a key, a spring or an input gave NaN or Infinity)`);
    const notes = [];
    if (never.clips.length)
      notes.push(
        `Never played in this run: ${never.clips.join(', ')} (no state, input, event or script step played them).`,
      );
    if (never.states.length) notes.push(`States never reached: ${never.states.join(', ')}.`);
    if (never.reactions.length)
      notes.push(
        `Reactions never sent: ${never.reactions.join(', ')} (add { at, event } steps to the script to see them).`,
      );
    if (never.still.length) notes.push(`Channels of the rest pose that nothing moved: ${never.still.join(', ')}.`);
    const ok = !rig.warnings.length && !problems.length,
      plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    const span = (o2) =>
      Object.keys(o2)
        .map((k) => `${k} ${r3(o2[k])} s`)
        .join(', ');
    const L = [
      `${o.name || 'rig'}: ${secs} s at ${fps} frames a second, seed ${o.seed || 1}, ${plural(script.length, 'script step')}`,
    ];
    for (const w of rig.warnings) L.push('FAIL    ' + w);
    for (const p of problems) L.push('FAIL    ' + p);
    if (ok) L.push('pass    no mistake in the definition, every channel is a number on every frame');
    if (Object.keys(states).length) L.push('states  ' + span(states));
    layers.forEach((x, i) => Object.keys(x).length && L.push(`layer ${i} ` + span(x)));
    const pl = Object.keys(played).map(
      (n) => n + (played[n].state ? ' (state)' : '') + (played[n].shots ? ' x' + played[n].shots : ''),
    );
    if (pl.length) L.push('played  ' + pl.join(', '));
    if (Object.keys(counts).length)
      L.push(
        'events  ' +
          Object.keys(counts)
            .map((k) => k + ' x' + counts[k])
            .join(', '),
      );
    const mv = Object.keys(channels).filter((k) => channels[k].moved);
    if (mv.length) L.push('moved   ' + mv.map((k) => `${k} ${channels[k].min}..${channels[k].max}`).join(', '));
    const sl = Object.keys(slots).map((k) => k + ': ' + Object.keys(slots[k]).join(' / '));
    if (sl.length) L.push('slots   ' + sl.join(', '));
    for (const n of notes) L.push('note    ' + n);
    L.push(
      `${ok ? 'ok' : 'not ok'}: ${plural(rig.warnings.length + problems.length, 'fail')}, ${plural(notes.length, 'note')}`,
    );
    const map = (o2) => Object.fromEntries(Object.keys(o2).map((k) => [k, r3(o2[k])]));
    return {
      ok,
      name: o.name || 'rig',
      seconds: secs,
      warnings: rig.warnings.slice(),
      problems,
      notes,
      states: map(states),
      layers: layers.map(map),
      played,
      never,
      channels,
      events: counts,
      slots: Object.fromEntries(Object.keys(slots).map((k) => [k, Object.keys(slots[k])])),
      text: L.join('\n'),
    };
  }
  return { create, audience, ease: E, sample, bones, phys, mesh, lab, expose, report, version: '3.9.0' };
});
