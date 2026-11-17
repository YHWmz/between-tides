// World layout: where things are, the footpath, and the terrain height function.
// Axes: +y up, the walk heads north (-z), the sea is to the west (-x).
import { noise, fbm, smooth, lerp, clamp } from './noise.js';

export const SEA_LEVEL = 0;
export const COMPOUND = { x: 15, z: -152, h: 27.2, flat: 21, blend: 20 }; // lighthouse yard
export const LIGHTHOUSE = { x: 8, z: -157 };
export const COTTAGE = { x: 22.5, z: -152.5, yaw: 0.0, w: 9.5, d: 5.6 };
export const COTTAGE_GROUND = COMPOUND.h;     // the ground is dead level under and around the cottage
export const GATE = { t: 0.585 };        // fraction along the path where the wall and gate cross it
export const START = { x: 5.6, z: 47, yaw: 0.42 };

// Footpath control points (x, z), south to north.
const PATH_PTS = [
  [8, 64], [6, 50], [2.5, 34], [-3, 17], [-9.5, 0], [-12.5, -19], [-11, -40], [-5, -58],
  [2, -73], [6.5, -90], [3, -107], [2.5, -122], [9, -132.5], [14.5, -139], [15.5, -144],
];

// ---- path: Catmull-Rom, resampled every 0.5 m, with a grid for distance queries -----------------------
const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

const buildPath = () => {
  const raw = [];
  const P = PATH_PTS, n = P.length;
  for (let i = 0; i < n - 1; i++) {
    const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(n - 1, i + 2)];
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      raw.push([catmull(a[0], b[0], c[0], d[0], t), catmull(a[1], b[1], c[1], d[1], t)]);
    }
  }
  raw.push(P[n - 1].slice());
  // resample by arc length
  const out = [raw[0]];
  let carry = 0;
  const STEP = 0.5;
  for (let i = 1; i < raw.length; i++) {
    let [ax, az] = raw[i - 1]; const [bx, bz] = raw[i];
    let seg = Math.hypot(bx - ax, bz - az);
    while (carry + seg >= STEP) {
      const f = (STEP - carry) / seg;
      ax = lerp(ax, bx, f); az = lerp(az, bz, f);
      out.push([ax, az]);
      seg = Math.hypot(bx - ax, bz - az); carry = 0;
    }
    carry += seg;
  }
  return out;
};

export const pathSamples = buildPath();             // [[x, z], ...] every 0.5 m
export const PATH_LENGTH = (pathSamples.length - 1) * 0.5;

const CELL = 6;
const grid = new Map();
pathSamples.forEach(([x, z], i) => {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const k = (cx + dx) * 4096 + (cz + dz);
    let a = grid.get(k); if (!a) grid.set(k, a = []);
    a.push(i);
  }
});

const near = { dist: 0, index: 0 };
/** Distance to the path centre line (capped at 6 m) and the nearest sample index. Shared result object. */
export const pathQuery = (x, z) => {
  const a = grid.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL));
  near.dist = 6; near.index = -1;
  if (!a) return near;
  let best = 36, bi = -1;
  for (let j = 0; j < a.length; j++) {
    const p = pathSamples[a[j]], dx = p[0] - x, dz = p[1] - z, d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = a[j]; }
  }
  near.dist = Math.sqrt(best); near.index = bi;
  return near;
};
export const pathDist = (x, z) => pathQuery(x, z).dist;

/** Position and unit tangent at fraction t (0..1) along the path. */
export const pathAt = (t) => {
  const f = clamp(t, 0, 1) * (pathSamples.length - 1);
  const i = Math.min(pathSamples.length - 2, Math.floor(f)), k = f - i;
  const a = pathSamples[i], b = pathSamples[i + 1];
  const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
  return { x: lerp(a[0], b[0], k), z: lerp(a[1], b[1], k), tx: tx / l, tz: tz / l };
};

// ---- coastline ---------------------------------------------------------------------------------------
/** x of the cliff edge at a given z. Land is east (x greater). */
export const coastX = (z) => {
  let x = -23.5 + 7.5 * noise(z / 70, 3.1, 11) + 3.2 * noise(z / 19, 8.7, 12) + 1.1 * noise(z / 5.5, 2.2, 13);
  x += 10 * smooth(10, 70, z);                          // the land steps seaward behind the start
  const t = -z - 205;                                   // north of the lighthouse the coast folds away
  if (t > 0) {
    x += 85 * smooth(0, 160, t);                        // a bay opens
    x -= 0.72 * Math.max(0, t - 190);                   // then the coast runs off to the north-west
    x += 190 * Math.sin(t / 185 + 0.4) * smooth(120, 420, t); // capes
    x += 40 * noise(z / 160, 1.3, 14) * smooth(60, 300, t);
  }
  return x;
};

const cliffTop = (z) => 13.5 + 12.5 * smooth(40, -150, z) + 26 * smooth(-300, -1300, z) + 2.2 * noise(z / 55, 5.5, 21);

// Height without the path cut and the yard: the natural ground.
const naturalHeight = (x, z) => {
  const d = x - coastX(z);                              // metres inland of the cliff edge
  const top = cliffTop(z);
  if (d >= 0) {
    let h = top + Math.min(d, 90) * 0.042;
    h += 2.6 * fbm(x / 46, z / 46, 3, 31) * smooth(2, 26, d);
    h += 0.42 * fbm(x / 7, z / 7, 2, 32);
    h += (15 + 9 * noise(x / 190, z / 190, 33)) * smooth(45, 240, d); // hills inland
    h -= 0.45 * (1 - smooth(0, 1.7, d)) ** 2;           // the lip breaks over
    return h;
  }
  const FACE = 8.5;
  const t = -d / FACE;
  if (t < 1) {
    const e = 1 - (1 - t) ** 2.1;                       // steep at the top, easing onto the foot
    let h = lerp(top - 0.45, 0.6, e);
    const mid = Math.sin(Math.PI * t);
    h += 1.3 * mid * (noise(x / 6.5, z / 6.5, 41) + 0.6 * noise(x / 2.3, z / 2.3, 42));
    // bedding: the face breaks into ledges a couple of metres apart
    const STEP = 2.3, f = h / STEP - Math.floor(h / STEP);
    const ledge = (Math.floor(h / STEP) + smooth(0.0, 0.38, f)) * STEP;
    return lerp(h, ledge, 0.7 * mid);
  }
  const s = -d - FACE;                                  // metres seaward of the cliff foot
  let h = 0.6 - s * 0.2 - 0.0012 * s * s;
  const sk = noise(x / 12, z / 12, 51) + 0.4 * noise(x / 4.1, z / 4.1, 52);
  // skerries: low, flat-topped reefs that the swell breaks over
  h += (4.4 * smooth(0.34, 0.62, sk) + 1.6 * smooth(0.62, 0.9, sk) + 0.5 * noise(x / 1.9, z / 1.9, 53) * smooth(0.3, 0.6, sk))
    * smooth(0, 5, s) * (1 - smooth(30, 62, s));
  return Math.max(h, -26);
};

// Smoothed ground height under each path sample: the walking line.
const pathHeights = (() => {
  const raw = pathSamples.map(([x, z]) => naturalHeight(x, z));
  const out = new Float32Array(raw.length), R = 9;
  for (let i = 0; i < raw.length; i++) {
    let s = 0, n = 0;
    for (let j = -R; j <= R; j++) { const k = clamp(i + j, 0, raw.length - 1); s += raw[k]; n++; }
    out[i] = s / n;
  }
  return out;
})();
// ease the last stretch into the yard level
for (let i = 0; i < pathHeights.length; i++) {
  const [x, z] = pathSamples[i];
  const w = 1 - smooth(COMPOUND.flat, COMPOUND.flat + COMPOUND.blend, Math.hypot(x - COMPOUND.x, z - COMPOUND.z));
  pathHeights[i] = lerp(pathHeights[i], COMPOUND.h, w);
}

/** Ground height in metres. */
export const heightAt = (x, z) => {
  let h = naturalHeight(x, z);
  const r = Math.hypot(x - COMPOUND.x, z - COMPOUND.z);
  if (r < COMPOUND.flat + COMPOUND.blend && x - coastX(z) > 0) {
    const w = 1 - smooth(COMPOUND.flat, COMPOUND.flat + COMPOUND.blend, r);
    h = lerp(h, COMPOUND.h + 0.12 * fbm(x / 5, z / 5, 2, 61), w);
    const pad = (1 - smooth(COTTAGE.w / 2 + 1.2, COTTAGE.w / 2 + 3.5, Math.abs(x - COTTAGE.x))) * (1 - smooth(COTTAGE.d / 2 + 1.2, COTTAGE.d / 2 + 3.5, Math.abs(z - COTTAGE.z)));
    if (pad > 0) h = lerp(h, COTTAGE_GROUND, pad);
  }
  const q = pathQuery(x, z);
  if (q.index >= 0 && q.dist < 4.5) {
    const w = 1 - smooth(0.8, 4.5, q.dist);
    h = lerp(h, pathHeights[q.index] - 0.05, w);
  }
  return h;
};

export const pathHeightAt = (i) => pathHeights[clamp(i | 0, 0, pathHeights.length - 1)];
