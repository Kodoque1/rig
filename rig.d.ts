// Types for rig.js. Channels are plain strings ("body.sy", "eye.x"): name them as you like.

/** How a key is eased into: linear, in-out (the default), in, out, overshoot, or a step at the key. */
export type Ease = 'lin' | 'io' | 'in' | 'out' | 'back' | 'hold';
/** A key of a track: [time in seconds, value, ease into this key]. */
export type Key = [t: number, value: number, ease?: Ease];
/** A key of a 'slot:<slot>' track: [time, attachment name]. Always stepped. */
export type SlotKey = [t: number, name: string | null];
export type Point = [x: number, y: number];
export type Pose = Record<string, number>;
export type Inputs = Record<string, number>;

export interface Clip {
  /** Length in seconds. */
  dur: number;
  loop?: boolean;
  /** channel -> keys. In a state, values are the channel's value; in a one-shot or a layer, offsets added on top. */
  tracks: Record<string, Key[] | SlotKey[]>;
  /** Named moments: [time, name, data]. Read them each frame in `rig.events`. */
  events?: [t: number, name: string, data?: any][];
  /** Mesh deform keys: mesh name -> [time, { pointIndex: [dx, dy] }, ease]. */
  deform?: Record<string, [t: number, offsets: Record<number, Point>, ease?: Ease][]>;
}

/** A state plays one clip, or blends several by an input: { blend: 'fear', clips: [[0, 'calm'], [1, 'scared']] }. */
export type State = string | { blend: string; clips: [at: number, clip: string][] };
/** [from state or '*', to state, condition, crossfade in seconds (default 0.2)]. The first that matches wins. */
export type Transition = [from: string, to: string, when: (inputs: Inputs, rig: Rig) => boolean, fade?: number];

export interface Layer {
  states: Record<string, State>;
  machine?: Transition[];
  initial?: string;
  sync?: string[][];
  /** A number, or the name of an input to follow. Default 1. */
  weight?: number | string;
}

export interface Spring {
  /** Stiffness. */
  k: number;
  /** Damping. */
  d: number;
  /** What the spring's motion is multiplied by before it is added to the channel. Default 1. */
  gain?: number;
  /** An input the spring follows (times `scale`); without it the spring rests at 0 and moves only when kicked. */
  input?: string;
  scale?: number;
}

export type Take = string | { clip: string; when?: (data: any, rig: Rig) => boolean; w?: number };
/** A mark's name, or [name, life in seconds] (default 0.8 s). */
export type MarkSpec = string | [name: string, life: number];

/** What an event does. A plain string is { fire: thatClip }. */
export interface Reaction {
  /** A one-shot to play. */
  fire?: string;
  /** A state to go to, with `fade` seconds of crossfade. */
  go?: string;
  fade?: number;
  /** One of several one-shots, never the same twice in a row. */
  take?: Take[];
  /** channel -> velocity given to its spring (times the event's data.scale when there is one). */
  kick?: Record<string, number>;
  /** Flip the sign of the kicks each time. */
  alt?: boolean;
  mark?: MarkSpec;
  /** slot -> attachment, or [attachment, seconds]. */
  attach?: Record<string, string | [name: string, dur?: number]>;
  /** Ignore the event when it comes again within this many seconds. */
  gap?: number;
}

export interface Look {
  /** Channels the gaze adds to. */
  x?: string;
  y?: string;
  head?: string;
  /** How far the eyes travel, in the channel's unit. Default 3. */
  range?: number;
  /** How much of the gaze the head takes. Default 0.25. */
  head_gain?: number;
  /** Seconds between two small eye jumps: [min, max]. Default [0.8, 2.5]. */
  saccade?: [number, number];
}

/** A target: a name set with rig.target(), a part with '<part>.x' and '<part>.y' channels, or a fixed point. */
export type TargetRef = string | Point;
export type Constraint =
  | { ik: string; bones: [string, string]; lens: [number, number]; root: TargetRef; target: TargetRef; bend?: 1 | -1; base?: number;
      avoid?: { at: TargetRef; r: number }[]; dodge?: number; swing?: number; mix?: number | string }
  | { aim: string; root: TargetRef; target: TargetRef; offset?: number; limit?: [number, number]; center?: number; mix?: number | string }
  | { copy: string; from: string; scale?: number; offset?: number; mix?: number | string }
  | { path: string; points: Point[]; closed?: boolean; at: number | string; x?: string; y?: string; rot?: string | false; mix?: number | string };

export interface MeshBone { name: string; at: Point; to?: Point }
export interface MeshDef {
  points: Point[];
  tris: [number, number, number][];
  bones: MeshBone[];
  /** Bones each point follows. Default 2. */
  k?: number;
  falloff?: number;
  soft?: number;
  uv?: Point[];
  /** Per point: [[bone index, weight], ...]. Computed from distance when absent. */
  weights?: [bone: number, w: number][][];
}

/** A character. Every block is optional. */
export interface RigDef {
  /** The pose at rest: channel -> value. A channel not listed rests at 0. */
  rest?: Pose;
  clips?: Record<string, Clip>;
  states?: Record<string, State>;
  machine?: Transition[];
  /** The first state. Default: the first key of `states`. */
  initial?: string;
  /** Groups of states that hand over their phase (a walk and a run). */
  sync?: string[][];
  /** Machines that run beside the main one and add on top (a face over a body). */
  layers?: Layer[];
  /** Start values of the inputs. */
  inputs?: Inputs;
  /** Slider ranges for the lab: input -> [min, max]. */
  ranges?: Record<string, [number, number]>;
  /** How fast a blend follows its input, per second. Default 8. */
  smooth?: Record<string, number>;
  /** One-shots fired by themselves every [min, max] seconds: { blink: [2, 5] }. */
  auto?: Record<string, [number, number]>;
  springs?: Record<string, Spring>;
  /** A breath that never loops the same: channel -> [amplitude, period in seconds]. */
  alive?: Record<string, [number, number]>;
  look?: Look;
  /** What each event does: rig.event(name, data). */
  on?: Record<string, string | Reaction>;
  /** Signals fed by rig.feed() turned into inputs: a signal name, a { from, range } map to 0..1, or a function. */
  sense?: Record<string, string | { from: string; range?: [number, number] } | ((signals: Record<string, any>) => number)>;
  /** Channels your own code writes with rig.set(); the rig never moves them. 'leg.*' matches a prefix. */
  owns?: string[];
  /** Requests your code may honour: name -> { target, gain }, each a number or a channel. Read with rig.drives(). */
  drive?: Record<string, { target: number | string; gain?: number | string }>;
  /** Slots and what each wears at the start. */
  slots?: Record<string, string | null>;
  /** Sets of attachments: rig.skin(name). */
  skins?: Record<string, Record<string, string | null>>;
  /** Draw order: part -> depth, or a list back to front. A part's '<part>.z' channel adds to its depth. */
  order?: Record<string, number> | string[];
  constraints?: Constraint[];
  meshes?: Record<string, MeshDef>;
  /** channel -> threshold: a change bigger than this jumps past its target and holds a beat. */
  snap?: Record<string, number>;
  snapHold?: number;
  snapOver?: number;
  /** A mark kept alive while the rig is in a state. */
  markStates?: Record<string, MarkSpec>;
  /** Fill rig.held with the pose sampled this many times a second. */
  hold?: number;
}

export interface Mark { name: string; age: number; life: number; /** 0..1 over its life */ t: number }
export interface ClipEvent { name: string; data: any; clip: string; at: number; from: string }

export interface Rig {
  readonly def: RigDef;
  /** Set these from your game: the machine and the blends read them. */
  inputs: Inputs;
  /** The main machine's state. */
  readonly state: string | null;
  /** Seconds in that state. */
  readonly t: number;
  /** This frame's pose. Prefer v(). */
  pose: Pose;
  /** The pose sampled at def.hold times a second. */
  held: Pose | null;
  /** The last states ('name'), one-shots ('!name'), events ('@name') and skins ('~name'). */
  log: string[];
  /** Things to draw over the character ("!", sweat, stars), timed by the rig. */
  marks: Mark[];
  /** The clip events the playhead passed this frame. */
  events: ClipEvent[];
  /** How many times each clip event fired. */
  counts: Record<string, number>;
  /** What each slot shows this frame. */
  slots: Record<string, string | null>;
  /** Who set each slot this frame: 'state:<clip>', 'layer<i>:<clip>', 'shot:<clip>', 'timed'. Absent: your attach(). */
  slotFrom: Record<string, string>;
  /** Mistakes found in the definition, and dropped set() calls. */
  warnings: string[];
  /** Per IK constraint: distance / full length (over 1: out of reach), the elbow side in use, how far the end dodged. */
  reach: Record<string, number>;
  elbow: Record<string, number>;
  dodge: Record<string, number>;
  /** Per IK constraint with avoid: how deep the limb still crosses a circle, in px. */
  cross: Record<string, number>;
  /** Which take each event played last. */
  lastTake: Record<string, string>;
  /** 1 or -1: flips with each `alt` reaction. */
  side: number;

  /** Advance by dt seconds. Call once a frame. */
  update(dt: number): Rig;
  /** A channel's value this frame. */
  v(channel: string): number;
  /** Go to a state now, with a crossfade (default 0.2 s). */
  go(state: string, fade?: number): boolean;
  /** Play a clip once, added on top. */
  fire(clip: string): boolean;
  playing(clip: string): boolean;
  /** Give a spring a velocity. */
  kick(channel: string, velocity: number): void;
  /** Look toward a direction, each axis -1..1. null: the gaze wanders. */
  lookAt(x: number | null, y?: number): Rig;
  /** Something happened: run its reaction from def.on. False when there is none or it came within its gap. */
  event(name: string, data?: any): boolean;
  /** Feed signals from your game; def.sense turns them into inputs. */
  feed(signals: Record<string, any>): Rig;
  /** Write channels you own (def.owns). */
  set(channels: Pose): Rig;
  /** What def.drive asks of your code. */
  drives(): Record<string, { target: number; gain: number }>;
  /** Put a named target in the character's frame, for constraints. Without x: remove it. */
  target(name: string, x?: number, y?: number): Rig;
  /** Change what a slot wears. With dur, for that many seconds over everything else. */
  attach(slot: string, name: string | null, dur?: number): boolean;
  skin(name: string): boolean;
  slot(name: string): string | null | undefined;
  mark(mark: MarkSpec): Rig;
  /** The parts sorted back to front for this frame. */
  drawOrder(pose?: Pose): string[];
  /** [[part, depth], ...], to sort the parts of several characters together. */
  depths(pose?: Pose): [string, number][];
  /** A mesh's points this frame: [x0, y0, x1, y1, ...]. */
  mesh(name: string): Float32Array | null;
  meshDef(name: string): (MeshDef & { name: string; uv: Point[]; weights: [number, number][][] }) | null;
  /** The eased value of an input a blend follows. */
  smooth(input: string): number;
  layer(i: number): { state: string; t: number; weight: number | string };
}

export interface Watcher { rig: Rig; x: number; y: number; name: string; seen: number }
export interface Audience {
  members: Watcher[];
  speed: number;
  add(rig: Rig, x: number, y: number, name?: string): Watcher;
  move(watcher: Watcher, x: number, y: number): Audience;
  /** Something happened at (x, y): each watcher gets the event when the news reaches it, with data.dx, data.dy, data.dist added. */
  react(x: number, y: number, event: string, data?: any): Audience;
  /** How the player's move reads against the recent ones. */
  habit(key: string): 'new' | 'stale' | 'fresh' | 'plain';
  /** Call each frame, before the rigs' own update. */
  update(dt: number): Audience;
}
export interface AudienceOptions {
  /** How fast the news travels, in px per second. Default 650. */
  speed?: number;
  jitter?: number;
  /** Seconds a watcher keeps looking at what happened. Default 0.8; 0: never. */
  look?: number;
  /** Distance that reads as "far" for data.dx and data.dy. Default 300. */
  range?: number;
  /** Half-life in seconds, events for a full memory, the input it drives. Default { life: 20, full: 3, input: 'wary' }. */
  memory?: { life?: number; full?: number; input?: string | null };
  habitLife?: number;
  habitMin?: number;
  seed?: number;
}

export interface Follower {
  pose: Pose | null;
  step(target: Pose, dt: number, stiff?: number, maxSpeed?: number): Pose;
  set(pose: Pose): void;
}
export interface Bones {
  /** Forward kinematics: joint angles relative to the parent bone -> the joints' points. */
  chain(root: Point, bones: { joint: string; len: number }[], pose: Pose, base?: number): { pts: Point[]; angles: number[] };
  /** Eases a limb toward a pose with a speed cap, never overshooting. */
  follower(joints: string[]): Follower;
  mix(a: Pose, b: Pose, t: number): Pose;
  /** Two-bone IK. a1: the first bone's angle; a2: the second's, relative to it; reach over 1: out of reach. */
  ik2(root: Point, target: Point, l1: number, l2: number, bend?: 1 | -1): { a1: number; a2: number; reach: number };
  /** A point along a smooth curve through the points, t 0..1 by length -> [x, y, heading]. */
  along(points: Point[], t: number, closed?: boolean): [number, number, number];
}

export interface PhysLink { min?: number; max?: number; rest?: number | null; soft?: number; pull?: number }
export interface PhysWorld {
  p: Record<string, { x: number; y: number; m: number }>;
  /** The share of the body's weight each link carries. */
  load: Record<string, number>;
  gravity: number;
  link(name: string, point: string, at: Point, options?: PhysLink): PhysWorld;
  unlink(name: string): PhysWorld;
  move(name: string, at: Point): PhysWorld;
  step(dt: number): PhysWorld;
  com(): Point;
  vel(): Point;
  launch(vx: number, vy: number): PhysWorld;
  place(dx: number, dy: number): PhysWorld;
  frame(hipL: string, hipR: string, shoulderL: string, shoulderR: string): { x: number; y: number; rot: number };
}
export interface Phys {
  create(options: { points: Record<string, { at: Point; m?: number }>; sticks?: [string, string][]; gravity?: number; damp?: number; air?: number; iters?: number }): PhysWorld;
}

export interface Mesh {
  /** Points and triangles for a picture's rectangle. */
  grid(x: number, y: number, w: number, h: number, cols: number, rows: number): { points: Point[]; tris: [number, number, number][] };
  /** Draw a picture on a rig's mesh this frame. `image` is anything drawImage takes. */
  draw(ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, rig: Rig, name: string): void;
}

export type RigList = { name: string; rig: Rig }[] | Record<string, Rig> | (() => { name: string; rig: Rig }[]);

/** Build a character from its definition. Two rigs with different seeds never blink together. */
export function create(def: RigDef, seed?: number): Rig;
export function audience(options?: AudienceOptions): Audience;
/** Name a rig for the lab. Returns the rig. */
export function expose<T extends Rig>(name: string, rig: T): T;
/** Open the lab panel over the page: the exposed rigs, or the ones given. `?rig` in the URL opens it too. */
export const lab: { (rigs?: RigList): void; /** Close the panel. */ close?: () => void; /** Rebuild it after rigs changed. */ refresh?: (() => void) | null };
/** A track's value at a time. */
export function sample(keys: Key[], t: number): number;
export const ease: Record<Ease, (t: number) => number>;
export const bones: Bones;
export const phys: Phys;
export const mesh: Mesh;
export const version: string;

declare const Rig: {
  create: typeof create; audience: typeof audience; expose: typeof expose; lab: typeof lab; sample: typeof sample;
  ease: typeof ease; bones: Bones; phys: Phys; mesh: Mesh; version: string;
};
export default Rig;
export as namespace Rig;
