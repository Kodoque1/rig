// The tutorial's character as a module of its own, so it can be checked without a page:
//
//   npx rig report examples/blob.rig.mjs --script examples/blob.script.json
//
// A page imports the same file: import def from './blob.rig.mjs'; const rig = Rig.create(def);
export default {
  rest: {
    'body.x': 0,
    'body.y': 0,
    'body.sx': 1,
    'body.sy': 1,
    'eye.x': 0,
    'eye.y': 0,
    'eye.open': 1,
    brow: 0,
    'tuft.rot': 0,
    'head.rot': 0,
  },
  clips: {
    calm: {
      dur: 2,
      loop: true,
      tracks: {
        'body.sy': [
          [0, 1],
          [1, 1.02],
          [2, 1],
        ],
      },
    },
    scared: {
      dur: 0.4,
      loop: true,
      tracks: {
        'body.sy': [
          [0, 0.88],
          [0.2, 0.84],
          [0.4, 0.88],
        ],
        'body.sx': [
          [0, 1.1],
          [0.4, 1.1],
        ],
        brow: [
          [0, 1],
          [0.4, 1],
        ],
        'slot:mouth': [[0, 'worry']],
      },
    },
    blink: {
      dur: 0.16,
      tracks: {
        'eye.open': [
          [0, 0],
          [0.07, -1],
          [0.16, 0],
        ],
      },
    },
    jump: {
      dur: 0.5,
      tracks: {
        'body.y': [
          [0, 0],
          [0.18, -46, 'out'],
          [0.5, 0, 'in'],
        ],
        'body.sy': [
          [0, 0],
          [0.08, -0.2],
          [0.2, 0.15],
          [0.5, 0, 'back'],
        ],
        'slot:mouth': [[0, 'open']],
      },
    },
  },
  states: {
    mood: {
      blend: 'fear',
      clips: [
        [0, 'calm'],
        [1, 'scared'],
      ],
    },
  },
  smooth: { fear: 6 },
  auto: { blink: [1.5, 4] },
  alive: { 'body.sy': [0.02, 2.8] },
  springs: { 'tuft.rot': { k: 120, d: 6, gain: 0.1 } },
  look: { x: 'eye.x', y: 'eye.y', head: 'head.rot', range: 6, head_gain: 0.12 },
  slots: { mouth: 'smile' },
  on: { poke: { fire: 'jump', kick: { 'tuft.rot': 14 }, mark: ['bang', 0.6] } },
};
