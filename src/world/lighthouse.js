// The lighthouse: a hollow tower with a doorway, a stone stair winding up the inside of the wall, and the
// lantern room on top. Angles are measured as (x, z) = (cos a, sin a); the stair climbs toward +a.
import * as THREE from 'three/webgpu';
import { uv, positionWorld, mix, vec3, float, uniform, exp, smoothstep, materialColor, mx_noise_float, normalWorld, texture } from 'three/tsl';
import { heightAt, LIGHTHOUSE } from './layout.js';
import { boxUV, boxUp, place, fuse, surface } from './build.js';
import { sunFlat } from './terrain.js';

const H = 15.6, R0 = 2.9, R1 = 2.0, WALL = 0.45;
const LB = H + 0.16, LG = LB + 0.75, LT = LG + 1.55;       // lantern floor, glazing sill, glazing head
const LANTERN_RADIUS = 1.76, LANTERN_SCALE = LANTERN_RADIUS / 1.5;
const FLOOR = 0.5;                                          // ground floor, local y
const DOOR = Math.atan2(13, 7.5);                           // faces the path coming into the yard
const HD = 0.21, DOOR_TOP = 2.6;                            // doorway half-angle and head
const rAt = (y) => R0 + (R1 - R0) * Math.min(1, Math.max(0, (y - 0.7) / (H - 0.7)));
const rOuter = (y) => (y <= 0.45 ? 3.2 : y <= 0.62 ? 3.2 - 0.15 * (y - 0.45) / 0.17 : y <= 0.7 ? 3.05 - 0.15 * (y - 0.62) / 0.08 : rAt(y));
const rInner = (y) => rAt(Math.min(y, H)) - WALL;

// the stair, as a function of the angle walked since the doorway
const STEP = (Math.PI * 2) / 16, RISER = 0.2, N_STEPS = 66;
const TH_MIN = -0.4, TH_S = 0.45, TH_H = TH_S + N_STEPS * STEP;      // landing, then the winding stair
const STEEP = 1.3, TH_T = TH_H + STEEP;                              // a last steep flight up through the hatch
const TH_MAX = TH_T + Math.PI * 2 - STEEP - 0.3;                     // the lantern floor is a C around the lamp
const GALLERY_RADIUS = 2.91, GALLERY_RAIL = GALLERY_RADIUS - 0.07;
const GALLERY_DOOR = DOOR + TH_T + 0.52, GALLERY_HALF = 0.39;
const lanternArc = (radius, height, segments = 56) =>
  new THREE.CylinderGeometry(radius, radius, height, segments, 1, true,
    Math.PI / 2 - GALLERY_DOOR + GALLERY_HALF, Math.PI * 2 - 2 * GALLERY_HALF);
const Y_H = FLOOR + N_STEPS * RISER;
const floorOf = (t) => (t <= TH_S ? FLOOR : t <= TH_H ? Math.min(Y_H, FLOOR + ((t - TH_S) / STEP + 0.5) * RISER) : t <= TH_T ? Y_H + (LB - Y_H) * (t - TH_H) / STEEP : LB);

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const at = (g, angle, r, y) => place(g, Math.cos(angle) * r, y, Math.sin(angle) * r, -angle + Math.PI / 2);   // local x = sideways, z = outward

// Put each sill below eye level on the nearest turn of the stairs.
const WINDOWS = [[DOOR + 0.05, 5.6], [DOOR + 2.3, 3.8], [DOOR - 2.0, 8.4], [DOOR + 0.9, 11.4], [DOOR + 3.3, 11.9]]
  .map(([angle, hint]) => {
    const turns = [0, 1, 2, 3, 4].map(turn => wrap(angle - DOOR) + turn * Math.PI * 2)
      .filter(theta => theta >= TH_S && theta < TH_H - 1);
    const theta = turns.reduce((a, b) => Math.abs(floorOf(a) + 1.2 - hint) < Math.abs(floorOf(b) + 1.2 - hint) ? a : b);
    const bottom = floorOf(theta) + 1.1, top = bottom + 1.0;
    const half = 0.38 / rOuter((bottom + top) / 2);
    return { angle, theta, half, bottom, top };
  });

/** Interior and exterior skins share the same openings. */
function shell(baseRows, rOf, inward, uScale, vScale) {
  const openings = [{ angle: DOOR, half: HD, bottom: FLOOR, top: DOOR_TOP }, ...WINDOWS];
  const start = DOOR - HD, span = Math.PI * 2;
  const cycle = (a) => start + ((a - start + span * 2) % span);
  const ang = [...new Set([ ...Array.from({ length: 65 }, (_, i) => start + i * span / 64),
    ...openings.flatMap(({ angle, half }) => [cycle(angle - half), cycle(angle + half)]) ])].sort((a, b) => a - b);
  const rows = [...new Set([...baseRows, ...openings.flatMap(({ bottom, top }) => [bottom, top])])].sort((a, b) => a - b);
  const cols = ang.length, pos = [], nor = [], uvs = [], idx = [], s = inward ? -1 : 1;
  for (const y of rows) {
    const r = rOf(y), slope = (rOf(y + 0.01) - rOf(y - 0.01)) / 0.02, l = Math.hypot(1, slope);
    for (const a of ang) {
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      nor.push((s * Math.cos(a)) / l, (-s * slope) / l, (s * Math.sin(a)) / l);
      uvs.push(((a - ang[0]) / (Math.PI * 2)) * uScale, y * vScale);
    }
  }
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const midAngle = (ang[i] + ang[i + 1]) / 2, midY = (rows[j] + rows[j + 1]) / 2;
    if (openings.some(({ angle, half, bottom, top }) => midY > bottom && midY < top && Math.abs(wrap(midAngle - angle)) < half)) continue;
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    if (inward) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** A slab between two angles and two radii: a stair tread, or a slice of floor. */
function wedge(a0, a1, r0, r1, top, thick) {
  const P = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  const c = [P(a0, r0, top), P(a0, r1, top), P(a1, r1, top), P(a1, r0, top), P(a0, r0, top - thick), P(a0, r1, top - thick), P(a1, r1, top - thick), P(a1, r0, top - thick)];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], pos = [];
  for (const [a, b, d, e] of quads) for (const k of [a, b, d, a, d, e]) pos.push(...c[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return boxUV(g, 0.8);
}

// A common patina palette, with separate responses for paint, rust and brass.
const pigment = (hex) => {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
};
const grain = (p) => mx_noise_float(p).mul(0.5).add(0.5);

function agedMetal({ paint, oxide, roughness, metalness, scale, decay }) {
  const p = positionWorld;
  const spots = grain(p.mul(scale)).mul(0.72).add(grain(p.mul(scale * 4.2)).mul(0.28));
  const wear = smoothstep(0.53, 0.74, spots).mul(decay);
  const m = new THREE.MeshStandardNodeMaterial();
  const coat = pigment(paint).mul(grain(p.mul(scale * 0.6)).mul(0.35).add(0.82));
  m.colorNode = mix(coat, pigment(oxide), wear);
  m.roughnessNode = mix(float(roughness), float(0.93), wear);
  m.metalnessNode = mix(float(metalness), float(0.05), wear);
  return m;
}

function wetLimewash(tex, x, baseY, z, tint) {
  return surface(tex.plaster, {
    tint, normalScale: 0.82, lichen: 0.24, lichenFreq: 3.7,
    extra: (color) => {
      const p = positionWorld.sub(vec3(x, baseY, z));
      const streaks = grain(p.mul(vec3(5.5, 0.24, 5.5)));
      const patches = grain(p.mul(1.35));
      const wash = smoothstep(0.46, 0.76, streaks.mul(0.65).add(patches.mul(0.35)));
      const chips = smoothstep(0.60, 0.77, patches.mul(0.65).add(grain(p.mul(9)).mul(0.35)));
      let damp = smoothstep(0.18, 2.35, p.y).oneMinus().mul(patches.mul(0.55).add(0.38));
      // Runoff starts below each sill and narrows as it follows the wall.
      for (const { angle, bottom, half } of WINDOWS) {
        const r = rOuter(bottom), sx = Math.cos(angle) * r, sz = Math.sin(angle) * r;
        const span = r * half;
        const across = p.xz.sub(vec3(sx, 0, sz).xz).length();
        const drop = float(bottom).sub(p.y);
        const runoff = smoothstep(0, 0.09, drop).mul(smoothstep(0.15, 1.3, drop).oneMinus())
          .mul(smoothstep(span * 0.42, span + 0.09, across).oneMinus());
        damp = damp.add(runoff.mul(streaks).mul(0.58));
      }
      const plaster = mix(color, color.mul(vec3(0.56, 0.50, 0.40)), wash.mul(0.75));
      const exposed = mix(plaster, pigment(0x897e69), chips.mul(0.46));
      return mix(exposed, pigment(0x5b5a43), damp.clamp(0, 0.78));
    },
  });
}

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, 'rgba(255,240,210,0.7)'); g.addColorStop(0.4, 'rgba(255,200,140,0.16)'); g.addColorStop(1, 'rgba(255,180,120,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createLighthouse(tex, colliders) {
  const { x, z } = LIGHTHOUSE, y0 = heightAt(x, z) - 0.25;
  const group = new THREE.Group();
  group.position.set(x, y0, z);
  const add = (m, cast = true) => { m.castShadow = cast; m.receiveShadow = true; group.add(m); return m; };

  const white = wetLimewash(tex, x, y0, z, [0.93, 0.89, 0.81]);
  const dark = agedMetal({ paint: 0x414744, oxide: 0x725244, roughness: 0.72, metalness: 0.26, scale: 4, decay: 0.58 });
  dark.side = THREE.DoubleSide;
  const iron = agedMetal({ paint: 0x4c5751, oxide: 0x805742, roughness: 0.64, metalness: 0.34, scale: 18, decay: 0.73 });
  const brass = agedMetal({ paint: 0x957850, oxide: 0x4f6453, roughness: 0.49, metalness: 0.72, scale: 28, decay: 0.58 });

  // ---- outside ----------------------------------------------------------------------------------------
  const rowsUp = [1.2, 1.9, DOOR_TOP];
  for (let i = 1; i <= 12; i++) rowsUp.push(DOOR_TOP + ((H - DOOR_TOP) * i) / 12);
  add(new THREE.Mesh(shell([0, 0.45, FLOOR, 0.62, 0.7, ...rowsUp], rOuter, false, 8, 7 / H), white));
  add(new THREE.Mesh(new THREE.LatheGeometry([
    [R1, H - 0.58], [2.19, H - 0.35], [2.56, H - 0.14], [GALLERY_RADIUS, H + 0.04],
    [GALLERY_RADIUS, LB - 0.055],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 64), dark));
  const deck = new THREE.RingGeometry(LANTERN_RADIUS - 0.025, GALLERY_RADIUS, 64).rotateX(-Math.PI / 2).translate(0, LB, 0);
  add(new THREE.Mesh(boxUV(deck, 1.2), surface(tex.paving, { tint: [0.78, 0.75, 0.68], lichen: 0.24 })), false);
  const rail = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    rail.push(new THREE.CylinderGeometry(0.022, 0.028, 1.12, 6).translate(Math.cos(a) * GALLERY_RAIL, LB + 0.56, Math.sin(a) * GALLERY_RAIL));
  }
  for (const h of [0.22, 0.58, 1.1]) rail.push(new THREE.TorusGeometry(GALLERY_RAIL, 0.024, 6, 64).rotateX(Math.PI / 2).translate(0, LB + h, 0));
  add(new THREE.Mesh(fuse(rail, { smooth: true }), iron));
  const murette = lanternArc(LANTERN_RADIUS, 0.75).translate(0, LB + 0.375, 0);
  { const a = murette.getAttribute('uv'); for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * 4, a.getY(i) * 0.4); }
  add(new THREE.Mesh(murette, white));
  const frame = [], frameRadius = LANTERN_RADIUS - 0.04, glassRadius = LANTERN_RADIUS - 0.06;
  const arc = Math.PI * 2 - 2 * GALLERY_HALF;
  for (let i = 0; i <= 11; i++) {
    const a = GALLERY_DOOR + GALLERY_HALF + arc * i / 11;
    const edge = i === 0 || i === 11;
    frame.push(at(boxUp(edge ? 0.082 : 0.05, edge ? LT - LB : LT - LG, 0.10),
      a, frameRadius, edge ? LB : LG));
  }
  for (const [radius, y] of [[0.045, LG], [0.03, LG + 0.78]]) {
    frame.push(new THREE.TorusGeometry(frameRadius, radius, 6, 56, arc)
      .rotateX(Math.PI / 2).rotateY(-GALLERY_DOOR - GALLERY_HALF).translate(0, y, 0));
  }
  frame.push(new THREE.CylinderGeometry(1.62 * LANTERN_SCALE, 1.52 * LANTERN_SCALE, 0.14, 48).translate(0, LT + 0.07, 0));
  add(new THREE.Mesh(fuse(frame, { smooth: true }), iron));
  const glass = new THREE.Mesh(lanternArc(glassRadius, 0.775, 64).translate(0, LG + 0.3875, 0),
    new THREE.MeshPhysicalNodeMaterial({ color: 0xffffff, transmission: 1, roughness: 0.045, ior: 1.32, thickness: 0.006, side: THREE.DoubleSide }));
  group.add(glass);
  const roofProf = [[1.62, 0.14], [1.5, 0.3], [1.2, 0.66], [0.72, 1.0], [0.3, 1.18], [0.16, 1.28], [0.16, 1.44], [0.24, 1.52], [0.2, 1.66], [0.03, 1.74]];
  add(new THREE.Mesh(new THREE.LatheGeometry(roofProf.map(([r, y]) => new THREE.Vector2(r * LANTERN_SCALE, y + LT)), 40), dark));
  add(new THREE.Mesh(fuse([new THREE.CylinderGeometry(0.014, 0.014, 1.1, 5).translate(0, LT + 2.25, 0),
    new THREE.BoxGeometry(0.62, 0.014, 0.014).translate(0, LT + 2.42, 0), new THREE.BoxGeometry(0.014, 0.014, 0.62).translate(0, LT + 2.42, 0),
    new THREE.BoxGeometry(0.34, 0.14, 0.012).translate(0.12, LT + 2.66, 0)]), iron));

  // doorway: jambs through the wall, lintel, step and threshold; windows
  const stoneParts = [];
  for (const s of [-1, 1]) stoneParts.push(at(boxUV(boxUp(0.2, DOOR_TOP - FLOOR + 0.05, 1.0, 1, 3, 1), 0.7).translate(s * 0.6, 0, 0), DOOR, 2.78, FLOOR));
  stoneParts.push(at(boxUV(boxUp(1.6, 0.3, 1.02, 2, 1, 1), 0.7), DOOR, 2.79, DOOR_TOP));
  stoneParts.push(at(boxUV(boxUp(1.9, 0.2, 1.0, 2, 1, 1), 0.7), DOOR, 3.3, 0.3));
  stoneParts.push(at(boxUV(boxUp(1.3, 0.1, 1.2, 1, 1, 1), 0.7), DOOR, 2.75, FLOOR - 0.09));
  const reveal = ({ angle, half, bottom, top }) => {
    const point = (a, y, radius) => [Math.cos(a) * radius(y), y, Math.sin(a) * radius(y)];
    const left = angle - half, right = angle + half;
    const vertices = [];
    const face = (a, b, c, d) => vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (const a of [left, right]) face(point(a, bottom, rInner), point(a, top, rInner), point(a, top, rOuter), point(a, bottom, rOuter));
    for (const y of [bottom, top]) face(point(left, y, rInner), point(right, y, rInner), point(right, y, rOuter), point(left, y, rOuter));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return boxUV(geometry, 0.7);
  };
  const revealMat = surface(tex.wall, { tint: [0.96, 0.9, 0.82], lichen: 0.56, normalScale: 0.9 });
  revealMat.side = THREE.DoubleSide;
  add(new THREE.Mesh(fuse([...stoneParts, ...WINDOWS.map(reveal)]), revealMat));

  const paneMat = new THREE.MeshStandardNodeMaterial({
    color: 0xb9c5c3, roughness: 0.13, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false,
  });
  const windows = WINDOWS.map(({ angle, half, bottom, top, theta }) => {
    const mid = (bottom + top) / 2, radius = rOuter(top) - 0.02;
    const width = 2 * radius * Math.sin(half), height = top - bottom;
    const frameRadius = radius * Math.cos(half);
    const frame = new THREE.Group();
    frame.position.set(Math.cos(angle) * frameRadius, mid, Math.sin(angle) * frameRadius);
    frame.rotation.y = -angle + Math.PI / 2;
    const rim = 0.028, stile = 0.024, gap = 0.006;
    const leafWidth = width / 2 - rim - gap / 2;
    const leafHeight = height - 2 * rim;
    const solid = (parts, material) => {
      const mesh = new THREE.Mesh(fuse(parts), material);
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    };
    const fixed = [
      ...[-1, 1].map(side => new THREE.BoxGeometry(rim, height, 0.067).translate(side * (width - rim) / 2, 0, -0.013)),
      ...[-1, 1].map(side => new THREE.BoxGeometry(width - 2 * rim, rim, 0.067).translate(0, side * (height - rim) / 2, -0.013)),
    ];
    const leaves = [-1, 1].map(side => {
      const hinge = side * (width / 2 - rim);
      const sash = new THREE.Group();
      sash.position.x = hinge;
      const center = -side * leafWidth / 2;
      const join = -side * (leafWidth - stile / 2);
      const rails = [
        ...[-1, 1].map(y => new THREE.BoxGeometry(leafWidth, stile, 0.038).translate(center, y * (leafHeight - stile) / 2, 0)),
        ...[-side * stile / 2, join].map(px => new THREE.BoxGeometry(stile, leafHeight - 2 * stile, 0.038).translate(px, 0, 0)),
      ];
      // Exposed knuckles and small backing plates at the outer jamb.
      for (const h of [-0.32, 0.32]) {
        fixed.push(new THREE.BoxGeometry(0.038, 0.084, 0.019).translate(hinge + side * 0.012, h, 0.025));
        rails.push(new THREE.CylinderGeometry(0.014, 0.014, 0.072, 8).translate(0, h, 0.024));
      }
      sash.add(solid(rails, iron),
        new THREE.Mesh(new THREE.PlaneGeometry(leafWidth - 2 * stile, leafHeight - 2 * stile).translate(center, 0, 0), paneMat));
      const latch = [
        new THREE.BoxGeometry(0.043, 0.062, 0.012).translate(join + side * 0.014, -0.02, -0.024),
      ];
      if (side < 0) {
        latch.push(new THREE.BoxGeometry(0.055, 0.012, 0.016).translate(join, -0.02, -0.038),
          new THREE.SphereGeometry(0.013, 8, 6).translate(join - 0.024, -0.02, -0.043));
      }
      sash.add(solid(latch, brass));
      frame.add(sash);
      return { sash, side };
    });
    frame.add(solid(fixed, iron));
    group.add(frame);
    const inner = rInner(mid);
    let opened = false, amount = 0;
    return {
      theta, angle, leaves,
      pos: new THREE.Vector3(x + Math.cos(angle) * inner, y0 + mid, z + Math.sin(angle) * inner),
      get opened() { return opened; },
      get openness() { return amount; },
      get moving() { return amount !== Number(opened); },
      toggle() { opened = !opened; },
      update(dt) {
        const target = Number(opened);
        amount += clamp(target - amount, -dt / 0.84, dt / 0.84);
        const swing = 1.73 * amount * amount * (3 - 2 * amount);
        for (const { sash, side } of leaves) sash.rotation.y = side * swing;
      },
    };
  });
  // the door, hung on the walker's right, opening outward
  const leaf = new THREE.Mesh(fuse([boxUV(new THREE.BoxGeometry(1.0, 2.1, 0.07, 1, 4, 1), 1.1, true).translate(-0.5, 1.05, 0),
    boxUV(new THREE.BoxGeometry(0.92, 0.12, 0.03), 1.1).translate(-0.5, 0.5, -0.05), boxUV(new THREE.BoxGeometry(0.92, 0.12, 0.03), 1.1).translate(-0.5, 1.6, -0.05)]),
  surface(tex.wood, { tint: [0.55, 0.54, 0.43], lichen: 0.46, lichenFreq: 7, normalScale: 1.1 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 14).translate(-0.86, 1.05, 0.05), brass);
  leaf.castShadow = leaf.receiveShadow = true;
  const pivot = new THREE.Group();
  { const er = [Math.cos(DOOR), Math.sin(DOOR)], el = [-Math.sin(DOOR), Math.cos(DOOR)], rr = 3.0;
    pivot.position.set(er[0] * rr - el[0] * 0.5, FLOOR, er[1] * rr - el[1] * 0.5); }
  const PIVOT_YAW = -DOOR + Math.PI / 2;
  pivot.rotation.y = PIVOT_YAW; pivot.add(leaf, ring); group.add(pivot);

  // ---- inside: what light there is comes down from the lantern, through the slit windows and the door ----
  const doorK = uniform(0);
  const sun = sunFlat.value;
  const glowAt = (p) => {
    const l = p.sub(vec3(x, y0, z));
    let g = vec3(0.018, 0.02, 0.026).add(vec3(0.42, 0.44, 0.5).mul(smoothstep(H - 7.0, H + 0.5, l.y)).mul(0.3));
    for (const { angle: a, bottom, top } of WINDOWS) {
      const mid = (bottom + top) / 2, r = rInner(mid), d = l.sub(vec3(Math.cos(a) * r, mid, Math.sin(a) * r));
      const warm = Math.cos(a) * sun.x + Math.sin(a) * sun.z > 0.15;
      g = g.add((warm ? vec3(0.5, 0.31, 0.17) : vec3(0.13, 0.16, 0.21)).mul(exp(d.dot(d).mul(-1 / (1.5 * 1.5)))));
    }
    const dd = l.sub(vec3(Math.cos(DOOR) * 2.3, 1.5, Math.sin(DOOR) * 2.3));
    return g.add(vec3(0.2, 0.19, 0.19).mul(doorK).mul(exp(dd.dot(dd).mul(-1 / (2.2 * 2.2)))));
  };
  const shaft = (m) => { m.aoNode = float(0.1); m.emissiveNode = (m.colorNode ?? materialColor).mul(glowAt(positionWorld)); return m; };
  const rowsIn = [FLOOR, ...rowsUp, LB];
  const inner = add(new THREE.Mesh(shell(rowsIn, rInner, true, 6, 0.42), shaft(wetLimewash(tex, x, y0, z, [0.98, 0.92, 0.82]))));
  inner.castShadow = true;                                     // seen from the sun it is this face that closes the tower
  const flags = new THREE.CircleGeometry(rInner(FLOOR), 40).rotateX(-Math.PI / 2).translate(0, FLOOR, 0);
  { const a = flags.getAttribute('uv'); for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * 3, a.getY(i) * 3); }
  add(new THREE.Mesh(flags, shaft(surface(tex.paving, { tint: [0.87, 0.81, 0.74], normalScale: 0.85, lichen: 0.32 }))), false);

  const treads = [];
  for (let i = 0; i < N_STEPS; i++) {
    const a0 = DOOR + TH_S + i * STEP, top = FLOOR + (i + 1) * RISER;
    treads.push(wedge(a0, a0 + STEP * 1.06, 0.2, rInner(top) + 0.04, top, RISER + 0.06));   // solid stone steps, no gaps between them
  }
  const steepRise = (LB - Y_H) / 10;
  for (let i = 0; i < 10; i++) {
    const a0 = DOOR + TH_H + (i * STEEP) / 10;
    treads.push(wedge(a0, a0 + (STEEP / 10) * 1.1, 0.2, 1.5, Y_H + (i + 1) * steepRise, steepRise + 0.04));
  }
  const sweep = smoothstep(0.65, 0.98, normalWorld.y);
  const stoneIn = shaft(surface(tex.rock, {
    tint: [1.56, 1.44, 1.28], lichen: 0.32, normalScale: 0.85,
    extra: (color) => mix(color, color.mul(vec3(1.20, 1.16, 1.12)), sweep.mul(0.61)),
  }));
  stoneIn.roughnessNode = mix(texture(tex.rock.r, uv()).g, float(0.53), sweep.mul(0.65));
  stoneIn.side = THREE.DoubleSide;
  add(new THREE.Mesh(fuse(treads), stoneIn), false);
  const newel = new THREE.CylinderGeometry(0.22, 0.24, Y_H - FLOOR, 18).translate(0, (Y_H + FLOOR) / 2, 0);
  { const a = newel.getAttribute('uv'); for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * 1.2, a.getY(i) * 6); }
  add(new THREE.Mesh(newel, stoneIn), false);
  // what is kept under the stair
  add(new THREE.Mesh(fuse([at(boxUV(boxUp(0.7, 0.55, 0.6), 1.4), DOOR - 0.95, 1.75, FLOOR), at(boxUV(boxUp(0.5, 0.4, 0.45), 1.4), DOOR - 0.95, 1.72, FLOOR + 0.55),
    at(boxUV(boxUp(0.55, 0.7, 0.5), 1.4), DOOR - 1.45, 1.8, FLOOR)]), shaft(surface(tex.wood, { tint: [0.6, 0.5, 0.38] }))), false);

  // lantern room: a plate floor with the hatch left open, the inside of the parapet, the lamp on its pedestal
  const plate = [];
  { const a0 = DOOR + TH_T, span = Math.PI * 2 - STEEP - 0.15, n = 28;
    for (let i = 0; i < n; i++) plate.push(wedge(a0 + (span * i) / n, a0 + (span * (i + 1)) / n, 0, LANTERN_RADIUS + 0.02, LB, 0.05)); }
  const plateMat = agedMetal({ paint: 0x56514a, oxide: 0x805941, roughness: 0.76, metalness: 0.28, scale: 9, decay: 0.68 }); plateMat.side = THREE.DoubleSide; plateMat.aoNode = float(0.6);
  add(new THREE.Mesh(fuse(plate), plateMat), false);
  const liner = wetLimewash(tex, x, y0, z, [0.89, 0.84, 0.76]); liner.side = THREE.BackSide; liner.aoNode = float(0.7);
  add(new THREE.Mesh(lanternArc(LANTERN_RADIUS - 0.03, 0.75).translate(0, LB + 0.375, 0), liner), false);
  const rails = [];
  for (const t of [TH_T + 0.02, TH_MAX + 0.28]) for (const r of [0.8, LANTERN_RADIUS - 0.1]) rails.push(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6).translate(Math.cos(DOOR + t) * r, LB + 0.475, Math.sin(DOOR + t) * r));
  { const t = TH_MAX + 0.28, g = new THREE.BoxGeometry(0.03, 0.03, LANTERN_RADIUS - 0.88); rails.push(at(g, DOOR + t, (0.8 + LANTERN_RADIUS - 0.1) / 2, LB + 0.93)); }
  const lampY = LG + 0.8;
  rails.push(new THREE.CylinderGeometry(0.1, 0.16, lampY - 0.45 - LB, 12).translate(0, (lampY - 0.45 + LB) / 2, 0),
    new THREE.CylinderGeometry(0.3, 0.3, 0.04, 20).translate(0, lampY - 0.5, 0));
  add(new THREE.Mesh(fuse(rails, { smooth: true }), iron));

  // ---- the lamp, its glow and the beam ----------------------------------------------------------------
  const glow = uniform(0.0);                                          // 0 dark, 1 lit
  const lampMat = new THREE.MeshBasicNodeMaterial();
  lampMat.colorNode = mix(vec3(0.12, 0.1, 0.07), vec3(14.0, 9.0, 3.6), glow);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14).translate(0, lampY, 0), lampMat);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.0, 24, 8, true).translate(0, lampY, 0),
    new THREE.MeshStandardNodeMaterial({ color: 0xcfe0dc, roughness: 0.1, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  const lensRings = new THREE.Mesh(fuse([-0.5, -0.25, 0, 0.25, 0.5].map((o) => new THREE.TorusGeometry(0.455, 0.012, 6, 28).rotateX(Math.PI / 2).translate(0, lampY + o, 0)), { smooth: true }), brass);
  const light = new THREE.PointLight(0xffc27a, 0, 70, 1.6);
  light.position.set(0, lampY, 0);
  const beam = new THREE.Group();
  beam.position.set(0, lampY, 0);
  const beamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
  beamMat.colorNode = vec3(1.0, 0.78, 0.45);
  beamMat.opacityNode = uv().y.pow(1.6).mul(0.085).mul(glow);
  for (const s of [1, -1]) beam.add(new THREE.Mesh(new THREE.ConeGeometry(5.5, 120, 28, 1, true).translate(0, -60, 0).rotateZ((s * Math.PI) / 2), beamMat));
  beam.rotation.z = 0.035; beam.visible = false;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0xffb060, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.position.set(0, lampY, 0); halo.scale.setScalar(13);
  group.add(lamp, lens, lensRings, light, beam, halo);

  // the switch box beside the door
  const SW = DOOR + 0.5;
  add(new THREE.Mesh(fuse([at(boxUp(0.36, 0.5, 0.16), SW, rAt(1.1) + 0.04, 1.1),
    at(new THREE.CylinderGeometry(0.02, 0.02, 3.4, 6).translate(0.1, 3.3, 0), SW, rOuter(0.3) - 0.24, 0)]), iron));
  const leverPivot = new THREE.Group();
  { const r = rAt(1.35) + 0.2; leverPivot.position.set(Math.cos(SW) * r, 1.42, Math.sin(SW) * r); leverPivot.rotation.y = -SW + Math.PI / 2; }
  const lever = new THREE.Mesh(fuse([new THREE.BoxGeometry(0.03, 0.26, 0.03).translate(0, 0.13, 0), new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.27, 0)]), agedMetal({ paint: 0x853f32, oxide: 0x603829, roughness: 0.62, metalness: 0.26, scale: 30, decay: 0.63 }));
  lever.rotation.x = -0.9; lever.castShadow = true;                    // up = off
  leverPivot.add(lever); group.add(leverPivot);

  // The lantern-room control stands just inside the sill, on the landing.
  const topSwitchAngle = DOOR + TH_T + 2.55;
  const topSwitch = new THREE.Group();
  const topSwitchRadius = LANTERN_RADIUS - 0.16;
  topSwitch.position.set(Math.cos(topSwitchAngle) * topSwitchRadius, LB, Math.sin(topSwitchAngle) * topSwitchRadius);
  topSwitch.rotation.y = -topSwitchAngle + Math.PI / 2;
  const switchBox = new THREE.Mesh(fuse([
    new THREE.BoxGeometry(0.08, 0.8, 0.08).translate(0, 0.4, 0),
    new THREE.BoxGeometry(0.25, 0.3, 0.12).translate(0, 0.91, 0),
  ]), iron);
  switchBox.castShadow = switchBox.receiveShadow = true;
  const topLever = new THREE.Group();
  topLever.position.set(0, 0.83, -0.086);
  topLever.rotation.z = -0.9;
  topLever.add(new THREE.Mesh(lever.geometry, lever.material));
  topSwitch.add(switchBox, topLever);
  group.add(topSwitch);
  const topSwitchPos = new THREE.Vector3(x + topSwitch.position.x, y0 + LB + 1.02, z + topSwitch.position.z);

  (colliders.fills = colliders.fills || []).push({ cx: x, cz: z, w: 7, d: 7, c: 1, s: 0 });   // no grass under the tower

  // ---- walking it: the tower is a zone that takes over collision and floor height from the terrain ------
  const RIN_G = R0 - WALL, ROUT_G = 3.2, PR = 0.32;
  const er = [Math.cos(DOOR), Math.sin(DOOR)], el = [-Math.sin(DOOR), Math.cos(DOOR)];
  let open = 0, target = 0, vel = 0, inside = false, gallery = false, th = 0, lastA = 0;
  const roomLimit = LANTERN_RADIUS - 0.03 - PR;
  const doorwayClearance = GALLERY_HALF - Math.asin((PR + 0.05) / LANTERN_RADIUS);
  const canCrossGalleryDoor = (a) => Math.abs(wrap(a - GALLERY_DOOR)) < doorwayClearance;
  const zone = {
    get inside() { return inside; },
    get theta() { return th; },
    get atTop() { return inside && !gallery && th >= TH_T - 0.05; },
    get onGallery() { return gallery; },
    /** 1 in the dark of the shaft, 0 outdoors and up in the glass of the lantern */
    get shade() { return inside ? clamp((LB - 1.2 - floorOf(th)) / 2.5, 0, 1) : 0; },
    reset() { inside = gallery = false; },
    enter(theta) { inside = true; gallery = false; th = clamp(theta, TH_MIN, TH_MAX); lastA = DOOR + th; return [x + Math.cos(lastA) * 1.05, z + Math.sin(lastA) * 1.05]; },
    /** Moves p = { x, z } to somewhere a body can be and returns the floor height there, or null to use the ground. */
    apply(p) {
      let dx = p.x - x, dz = p.z - z, r = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
      const squeeze = () => {                                           // keep to the middle of the doorway
        const rel = wrap(a - DOOR), rc = r * Math.cos(rel), l = clamp(r * Math.sin(rel), -0.17, 0.17);
        dx = er[0] * rc + el[0] * l; dz = er[1] * rc + el[1] * l; r = Math.hypot(dx, dz); a = Math.atan2(dz, dx);
      };
      const inDoorway = () => { const rel = wrap(a - DOOR); return target === 1 && Math.abs(rel) < 0.6 && Math.abs(r * Math.sin(rel)) < 0.36; };
      if (!inside) {
        if (r >= ROUT_G + PR) return null;
        if (!inDoorway()) { r = ROUT_G + PR; p.x = x + Math.cos(a) * r; p.z = z + Math.sin(a) * r; return null; }
        squeeze();
        if (r < RIN_G - 0.05) { inside = true; th = wrap(a - DOOR); lastA = a; }
        p.x = x + dx; p.z = z + dz;
        return r < ROUT_G - 0.2 ? y0 + FLOOR : null;
      }
      if (gallery) {
        if (canCrossGalleryDoor(a) && r < LANTERN_RADIUS) {
          gallery = false;
          th = TH_T + 0.52 + wrap(a - GALLERY_DOOR);
        } else {
          const innerLimit = canCrossGalleryDoor(a) ? LANTERN_RADIUS : LANTERN_RADIUS + PR;
          r = clamp(r, innerLimit, GALLERY_RAIL - PR - 0.03);
          p.x = x + Math.cos(a) * r; p.z = z + Math.sin(a) * r;
          return y0 + LB;
        }
      } else {
        th += wrap(a - lastA);
      }
      if (th < TH_MIN || th > TH_MAX) { th = clamp(th, TH_MIN, TH_MAX); a = DOOR + th; }
      lastA = a;
      const fy = floorOf(th);
      let rMin = 0.22 + PR, rMax = rInner(fy) - PR;
      if (th >= TH_T) {
        rMin = 0.75;
        const throughDoor = canCrossGalleryDoor(a);
        rMax = throughDoor ? GALLERY_RAIL - PR - 0.03 : roomLimit;
        if (throughDoor && r >= LANTERN_RADIUS) gallery = true;
      }
      else if (th > TH_H) { const k = clamp((th - TH_H) / STEEP, 0, 1); rMin += (0.75 - rMin) * k; rMax += (1.14 - rMax) * k; }
      if (Math.abs(th) < 0.5 && inDoorway() && r > RIN_G - PR - 0.05) {
        dx = Math.cos(a) * r; dz = Math.sin(a) * r; squeeze(); rMax = Infinity;
        if (r > RIN_G + 0.1) inside = false;
      }
      r = clamp(r, rMin, rMax);
      p.x = x + Math.cos(a) * r; p.z = z + Math.sin(a) * r;
      return y0 + fy;
    },
  };

  const sr = rAt(1.3) + 0.5;
  let lit = false, k = 0, near = 0;
  return {
    group, zone, windows, topSwitchPos,
    galleryDoor: new THREE.Vector3(x + Math.cos(GALLERY_DOOR) * LANTERN_RADIUS, y0 + LB, z + Math.sin(GALLERY_DOOR) * LANTERN_RADIUS),
    lampY: y0 + lampY,
    switchPos: new THREE.Vector3(x + Math.cos(SW) * sr, y0 + 1.35, z + Math.sin(SW) * sr),
    doorPos: new THREE.Vector3(x + er[0] * 3.0, y0 + 1.6, z + er[1] * 3.0),
    lensPos: new THREE.Vector3(x, y0 + lampY, z),
    get lit() { return lit; },
    get doorOpen() { return target === 1; },
    get moving() { return open !== target || windows.some(window => window.moving); },
    openDoor() { target = 1; },
    setLit(on) { lit = on; },
    update(dt, t) {
      for (const window of windows) window.update(dt);
      if (open !== target) {
        vel += (6 * (target - open) - 3.2 * vel) * dt; open += vel * dt;
        if (Math.abs(target - open) < 0.002 && Math.abs(vel) < 0.01) { open = target; vel = 0; }
        pivot.rotation.y = PIVOT_YAW + 1.9 * open;
        doorK.value = open;
      }
      k = lit ? Math.min(1, k + dt / 2.8) : Math.max(0, k - dt / 0.38);
      const e = k * k * (3 - 2 * k), flick = lit && k < 1 ? 0.85 + 0.15 * Math.sin(t * 31) : 1;
      // Beside the lamp the eye stops down: the far-reaching light and its halo would white out the whole room.
      const up = inside && floorOf(th) > LB - 3.2 ? 1 : 0;
      near += (up - near) * (1 - Math.exp(-dt * 2.5));
      glow.value = e * flick * (1 - 0.86 * near);
      light.intensity = e * (900 + (14 - 900) * near);
      halo.material.opacity = 0.75 * e * (1 - near);
      beam.visible = k > 0 && near < 0.5;
      lever.rotation.x = THREE.MathUtils.damp(lever.rotation.x, lit ? 0.9 : -0.9, 16, dt);
      topLever.rotation.z = lever.rotation.x;
      if (k > 0) beam.rotation.y = t * 0.42;
    },
  };
}
