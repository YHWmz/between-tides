// The keeper's cottage: a hollow stone shell you can walk into, and the one room inside it.
// Local axes: +x east, +z south (the door side), y = 0 at the ground outside; the floor is 5 cm up.
import * as THREE from 'three/webgpu';
import { float, uniform, mix, vec3 } from 'three/tsl';
import { COTTAGE, COTTAGE_GROUND } from './layout.js';
import { boxUV, jitter, boxUp, fuse, surface } from './build.js';

const AO = 0.15;           // how much sky light reaches indoor surfaces; direct sun through the windows is untouched
const TO = 0.3, TI = 0.15; // stone outside, plaster lining inside
const F = 0.05;            // floor level

export function createCottage(tex, colliders, { limewash, paint }) {
  const { x, z, w, d } = COTTAGE, y0 = COTTAGE_GROUND;
  const group = new THREE.Group(); group.position.set(x, y0, z);
  const WH = 2.55, pitch = (43 * Math.PI) / 180, rise = (d / 2) * Math.tan(pitch);
  const DOORX = 0.1;
  const indoor = (m) => { m.aoNode = float(AO); return m; };
  const bx = (wd, ht, dp, cx, cy, cz, s = 0.45, swap = false) => boxUV(new THREE.BoxGeometry(wd, ht, dp), s, swap).translate(cx, cy, cz);
  const mesh = (list, mat, opts) => { const m = new THREE.Mesh(fuse(list, opts), mat); m.castShadow = m.receiveShadow = true; group.add(m); return m; };

  // ---- shell ----------------------------------------------------------------------------------------
  const outer = [], inner = [];
  const WIN = { hw: 0.44, y0: 0.93, y1: 1.97 };
  const longWall = (face, openings) => {
    const rects = []; let cur = -w / 2 + TO;
    for (const o of openings.sort((a, b) => a.c - b.c)) {
      rects.push([cur, o.c - o.hw, -0.3, WH]);
      rects.push([o.c - o.hw, o.c + o.hw, -0.3, o.y0]);
      rects.push([o.c - o.hw, o.c + o.hw, o.y1, WH]);
      cur = o.c + o.hw;
    }
    rects.push([cur, w / 2 - TO, -0.3, WH]);
    for (const [a, b, lo, hi] of rects) {
      outer.push(bx(b - a, hi - lo, TO, (a + b) / 2, (lo + hi) / 2, face * (d / 2 - TO / 2)));
      const ilo = Math.max(lo, 0);
      if (hi - ilo > 0.01) inner.push(bx(b - a, hi - ilo, TI, (a + b) / 2, (ilo + hi) / 2, face * (d / 2 - TO - TI / 2)));
    }
  };
  const SOUTH_WIN = [-2.9, 2.9], NORTH_WIN = [-2.6, 1.6];
  longWall(1, [...SOUTH_WIN.map((c) => ({ c, ...WIN })), { c: DOORX, hw: 0.56, y0: 0, y1: 2.11 }]);
  longWall(-1, NORTH_WIN.map((c) => ({ c, ...WIN })));
  const gable = new THREE.Shape();
  gable.moveTo(-d / 2, -0.3); gable.lineTo(d / 2, -0.3); gable.lineTo(d / 2, WH); gable.lineTo(0, WH + rise); gable.lineTo(-d / 2, WH); gable.closePath();
  for (const s of [-1, 1]) {
    outer.push(boxUV(new THREE.ExtrudeGeometry(gable, { depth: TO, bevelEnabled: false }).rotateY(Math.PI / 2).translate(s < 0 ? -w / 2 : w / 2 - TO, 0, 0), 0.45));
    inner.push(bx(TI, WH, d - 2 * TO, s * (w / 2 - TO - TI / 2), WH / 2, 0));
  }
  mesh(outer, limewash(tex, y0, [0.98, 0.96, 0.92]));
  mesh(inner, indoor(surface(tex.plaster, { tint: [1.0, 0.97, 0.9] })));

  // roof, chimneys
  const slope = (d / 2 + 0.34) / Math.cos(pitch), slabs = [];
  for (const s of [1, -1]) {
    const g = boxUV(new THREE.BoxGeometry(w + 0.66, 0.1, slope), 0.62);
    g.rotateX(s * pitch);
    g.translate(0, WH + rise - (slope / 2) * Math.sin(pitch) + 0.1, s * (slope / 2) * Math.cos(pitch));
    slabs.push(g);
  }
  slabs.push(bx(w + 0.7, 0.14, 0.3, 0, WH + rise + 0.14, 0, 0.62));
  mesh(slabs, surface(tex.roof, { tint: [1.25, 1.28, 1.36], lichen: 0.5, lichenFreq: 3.5 }));
  const stoneG = [], potG = [];
  for (const s of [1, -1]) {
    const c = boxUp(0.62, 1.25, 0.8, 1, 2, 1); jitter(c, 0.02, 3, s);
    stoneG.push(boxUV(c, 0.8).translate(s * (w / 2 - 0.5), WH + rise - 0.35, 0));
    stoneG.push(boxUV(boxUp(0.74, 0.1, 0.92), 0.8).translate(s * (w / 2 - 0.5), WH + rise + 0.86, 0));
    for (const o of [-0.17, 0.17]) potG.push(new THREE.CylinderGeometry(0.085, 0.11, 0.36, 10).translate(s * (w / 2 - 0.5), WH + rise + 1.12, o));
  }
  mesh(potG, paint(0x8b4f37, 0.85), { smooth: true });

  // floor, ceiling and beams
  const floorMat = indoor(surface(tex.wood, { tint: [0.72, 0.56, 0.4] }));
  mesh([bx(w - 2 * TO, 0.1, d - 2 * TO, 0, F - 0.05, 0, 0.55)], floorMat);
  const darkWood = indoor(surface(tex.wood, { tint: [0.42, 0.33, 0.25] }));
  const over = [bx(w - 0.5, 0.06, d - 0.5, 0, WH + 0.03, 0, 0.5)];
  for (let bxm = -3.6; bxm <= 3.61; bxm += 1.44) over.push(bx(0.13, 0.17, d - 0.8, bxm, WH - 0.085, 0, 1.0, true));
  mesh(over, darkWood);

  // ---- windows --------------------------------------------------------------------------------------
  const frames = [], glassG = [], sills = [];
  const windowAt = (wx, face) => {
    const zz = face * (d / 2 - 0.1);
    for (const s of [-1, 1]) frames.push(new THREE.BoxGeometry(0.05, 1.04, 0.09).translate(wx + s * 0.415, 1.45, zz));
    for (const yy of [0.955, 1.945]) frames.push(new THREE.BoxGeometry(0.88, 0.05, 0.09).translate(wx, yy, zz));
    frames.push(new THREE.BoxGeometry(0.03, 0.96, 0.05).translate(wx, 1.45, zz));
    frames.push(new THREE.BoxGeometry(0.8, 0.03, 0.05).translate(wx, 1.52, zz));
    glassG.push(new THREE.BoxGeometry(0.8, 0.96, 0.008).translate(wx, 1.45, zz));
    stoneG.push(bx(1.1, 0.08, 0.26, wx, 0.89, face * (d / 2 + 0.05), 0.8));
    sills.push(bx(0.96, 0.035, 0.26, wx, 0.925, face * (d / 2 - 0.34), 1.2));
  };
  SOUTH_WIN.forEach((c) => windowAt(c, 1)); NORTH_WIN.forEach((c) => windowAt(c, -1));
  mesh(frames, paint(0xcfcabd, 0.7));
  const glass = new THREE.Mesh(fuse(glassG), new THREE.MeshStandardNodeMaterial({ color: 0xa9bcc0, roughness: 0.05, transparent: true, opacity: 0.14, depthWrite: false }));
  group.add(glass);

  // ---- door -----------------------------------------------------------------------------------------
  stoneG.push(bx(1.42, 0.2, 0.3, DOORX, 2.22, d / 2 + 0.03, 0.8));     // lintel
  stoneG.push(bx(1.4, 0.12, 0.7, DOORX, -0.01, d / 2 + 0.2, 0.8));     // threshold
  mesh(stoneG, surface(tex.wall, { tint: [0.95, 0.95, 0.93], lichen: 0.45 }));
  const jambs = [];
  for (const s of [-1, 1]) jambs.push(bx(0.06, 2.06, 0.2, DOORX + s * 0.53, 1.08, d / 2 - 0.15, 1.2, true));
  jambs.push(bx(1.12, 0.06, 0.2, DOORX, 2.08, d / 2 - 0.15, 1.2));
  mesh([...jambs, ...sills], darkWood);
  const doorMat = surface(tex.wood, { tint: [0.33, 0.47, 0.36], lichen: 0.08 });
  const leaf = new THREE.Mesh(fuse([
    boxUV(new THREE.BoxGeometry(0.98, 2.0, 0.05, 1, 4, 1), 1.1, true).translate(0.49, 1.05, 0),
    bx(0.9, 0.12, 0.03, 0.49, 0.45, -0.04, 1.1), bx(0.9, 0.12, 0.03, 0.49, 1.65, -0.04, 1.1),
  ]), doorMat);
  const latch = new THREE.Mesh(fuse([new THREE.BoxGeometry(0.16, 0.03, 0.02).translate(0.86, 1.05, -0.06), new THREE.BoxGeometry(0.03, 0.1, 0.03).translate(0.9, 1.05, 0.04)]), paint(0x1a1b1c, 0.5, 0.6));
  leaf.castShadow = leaf.receiveShadow = latch.castShadow = true;
  const pivot = new THREE.Group(); pivot.position.set(DOORX - 0.49, 0, d / 2 - 0.13); pivot.add(leaf, latch);
  group.add(pivot);

  // ---- the room -------------------------------------------------------------------------------------
  const furn = indoor(surface(tex.wood, { tint: [0.62, 0.47, 0.32] }));
  const iron = indoor(paint(0x17181a, 0.46, 0.65)), brass = indoor(paint(0x9a7a3a, 0.35, 0.9));
  const cloth = (hex) => indoor(paint(hex, 0.95));
  const wood = [], ironG = [], brassG = [];
  const legs = (cx, cz, hx, hz, h, t = 0.05) => { for (const a of [-1, 1]) for (const b of [-1, 1]) wood.push(bx(t, h, t, cx + a * hx, F + h / 2, cz + b * hz, 1.2, true)); };

  // desk under the south wall, where the evening sun through the north window lands
  const DESK = { x: 1.72, z: 1.98, top: F + 0.78 };
  wood.push(bx(1.15, 0.04, 0.62, DESK.x, DESK.top - 0.02, DESK.z, 1.2));
  legs(DESK.x, DESK.z, 0.52, 0.26, 0.74);
  wood.push(bx(1.04, 0.1, 0.03, DESK.x, DESK.top - 0.1, DESK.z - 0.27, 1.2), bx(0.4, 0.09, 0.02, DESK.x - 0.2, DESK.top - 0.1, DESK.z - 0.29, 1.2));
  brassG.push(new THREE.SphereGeometry(0.014, 8, 6).translate(DESK.x - 0.2, DESK.top - 0.1, DESK.z - 0.31));
  // chair, pushed back a little
  {
    const g = [bx(0.42, 0.035, 0.42, 0, 0.47, 0, 1.2)];
    for (const a of [-1, 1]) { g.push(bx(0.04, 0.46, 0.04, a * 0.18, 0.23, 0.18, 1.2, true)); g.push(bx(0.04, 0.95, 0.04, a * 0.18, 0.475, -0.18, 1.2, true)); }
    for (const yy of [0.66, 0.84]) g.push(bx(0.36, 0.06, 0.02, 0, yy, -0.18, 1.2));
    for (const c of g) { c.rotateY(0.35); c.translate(DESK.x - 0.12, F, DESK.z - 0.78); wood.push(c); }
  }
  // the station log, open
  const logLocal = new THREE.Vector3(DESK.x - 0.18, DESK.top + 0.02, DESK.z - 0.02);
  const book = new THREE.Group(); book.position.copy(logLocal); book.rotation.y = 0.12;
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.31), indoor(paint(0x3a2620, 0.8)));
  const pages = new THREE.Mesh(fuse([new THREE.BoxGeometry(0.215, 0.022, 0.28).translate(-0.112, 0.016, 0), new THREE.BoxGeometry(0.215, 0.018, 0.28).translate(0.112, 0.014, 0)]), indoor(paint(0xd8cdb0, 0.92)));
  const ink = new THREE.Mesh(fuse([0.08, 0.05, 0.02, -0.01, -0.04].map((zz, i) => new THREE.BoxGeometry(0.15 - (i % 2) * 0.04, 0.001, 0.008).translate(-0.112 - (i % 2) * 0.02, 0.028, zz))), indoor(paint(0x2a2a3a, 0.9)));
  book.add(cover, pages, ink); group.add(book);
  for (const m of [cover, pages]) { m.castShadow = m.receiveShadow = true; }
  // oil lamp
  const lampLocal = new THREE.Vector3(DESK.x + 0.4, DESK.top, DESK.z + 0.1);
  brassG.push(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 16).translate(lampLocal.x, lampLocal.y + 0.015, lampLocal.z),
    new THREE.CylinderGeometry(0.035, 0.06, 0.07, 16).translate(lampLocal.x, lampLocal.y + 0.065, lampLocal.z),
    new THREE.CylinderGeometry(0.024, 0.03, 0.03, 12).translate(lampLocal.x, lampLocal.y + 0.115, lampLocal.z));
  const chimney = new THREE.Mesh(new THREE.LatheGeometry([[0.028, 0], [0.045, 0.05], [0.03, 0.13], [0.024, 0.22]].map(([r, y]) => new THREE.Vector2(r, y)), 16).translate(lampLocal.x, lampLocal.y + 0.125, lampLocal.z),
    new THREE.MeshStandardNodeMaterial({ color: 0xd8e2df, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  const flameK = uniform(0);
  const flameMat = new THREE.MeshBasicNodeMaterial();
  flameMat.colorNode = mix(vec3(0.02, 0.018, 0.015), vec3(9.0, 4.6, 1.3), flameK);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8).scale(1, 2.4, 1).translate(lampLocal.x, lampLocal.y + 0.175, lampLocal.z), flameMat);
  const lampLight = new THREE.PointLight(0xffa850, 0, 7.5, 1.8);
  lampLight.position.set(lampLocal.x, lampLocal.y + 0.2, lampLocal.z - 0.02);
  group.add(chimney, flame, lampLight);
  // enamel mug
  const mug = new THREE.Mesh(fuse([new THREE.CylinderGeometry(0.04, 0.036, 0.085, 14).translate(DESK.x - 0.47, DESK.top + 0.043, DESK.z + 0.12),
    new THREE.TorusGeometry(0.026, 0.006, 6, 12).rotateY(0.6).translate(DESK.x - 0.515, DESK.top + 0.043, DESK.z + 0.15)], { smooth: true }), indoor(paint(0xdfe2de, 0.3)));
  mug.castShadow = true; group.add(mug);
  // the tide table pinned above the desk
  const tideLocal = new THREE.Vector3(DESK.x, F + 1.5, d / 2 - TO - TI - 0.004);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.004).translate(tideLocal.x, tideLocal.y, tideLocal.z), indoor(paint(0xd9d0b6, 0.95)));
  const rules = new THREE.Mesh(fuse([new THREE.BoxGeometry(0.28, 0.035, 0.001).translate(tideLocal.x, tideLocal.y + 0.17, tideLocal.z - 0.003),
    ...Array.from({ length: 9 }, (_, i) => new THREE.BoxGeometry(0.28, 0.004, 0.001).translate(tideLocal.x, tideLocal.y + 0.1 - i * 0.035, tideLocal.z - 0.003))]), indoor(paint(0x2b3040, 0.9)));
  group.add(paper, rules);

  // a table for one, west of the door, with the second chair
  const TB = { x: -1.9, z: 0.75 };
  wood.push(bx(0.95, 0.04, 0.72, TB.x, F + 0.74, TB.z, 1.2));
  legs(TB.x, TB.z, 0.42, 0.31, 0.72);
  {
    const g = [bx(0.42, 0.035, 0.42, 0, 0.47, 0, 1.2)];
    for (const a of [-1, 1]) { g.push(bx(0.04, 0.46, 0.04, a * 0.18, 0.23, 0.18, 1.2, true)); g.push(bx(0.04, 0.95, 0.04, a * 0.18, 0.475, -0.18, 1.2, true)); }
    for (const yy of [0.66, 0.84]) g.push(bx(0.36, 0.06, 0.02, 0, yy, -0.18, 1.2));
    for (const c of g) { c.rotateY(Math.PI - 0.5); c.translate(TB.x + 0.25, F, TB.z + 0.72); wood.push(c); }
  }
  const plate = new THREE.Mesh(fuse([new THREE.CylinderGeometry(0.11, 0.08, 0.018, 18).translate(TB.x + 0.12, F + 0.77, TB.z + 0.1),
    new THREE.CylinderGeometry(0.075, 0.06, 0.07, 14).translate(TB.x - 0.2, F + 0.795, TB.z - 0.12)], { smooth: true }), indoor(paint(0xdcdfda, 0.3)));
  const paperFold = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.21).rotateY(0.4).translate(TB.x - 0.14, F + 0.766, TB.z + 0.18), indoor(paint(0xbfb59a, 0.95)));
  plate.castShadow = paperFold.castShadow = true; group.add(plate, paperFold);
  // skirting along the long walls
  {
    const L = w / 2 - TO - TI, zz = d / 2 - TO - TI - 0.012;
    wood.push(bx(2 * L, 0.11, 0.025, 0, F + 0.055, -zz, 1.2));
    for (const [a, b] of [[-L, DOORX - 0.56], [DOORX + 0.56, L]]) wood.push(bx(b - a, 0.11, 0.025, (a + b) / 2, F + 0.055, zz, 1.2));   // not across the doorway
  }

  // stove on its hearth at the east gable
  const ST = { x: 3.62, z: 0.12 };
  const hearth = [bx(1.2, 0.05, 1.3, ST.x + 0.05, F + 0.025, ST.z, 0.8)];
  ironG.push(new THREE.CylinderGeometry(0.29, 0.31, 0.72, 20).translate(ST.x, F + 0.2 + 0.36, ST.z),
    new THREE.CylinderGeometry(0.33, 0.33, 0.035, 20).translate(ST.x, F + 0.94, ST.z),
    new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20).translate(ST.x, F + 0.2, ST.z),
    new THREE.BoxGeometry(0.03, 0.26, 0.24).translate(ST.x - 0.3, F + 0.5, ST.z),
    new THREE.CylinderGeometry(0.07, 0.07, WH - 1.0, 12).translate(ST.x + 0.12, F + 0.95 + (WH - 1.0) / 2, ST.z));
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; ironG.push(new THREE.CylinderGeometry(0.025, 0.018, 0.2, 6).translate(ST.x + Math.cos(a) * 0.24, F + 0.1, ST.z + Math.sin(a) * 0.24)); }
  brassG.push(new THREE.SphereGeometry(0.018, 8, 6).translate(ST.x - 0.33, F + 0.5, ST.z + 0.08));
  // kettle
  ironG.push(new THREE.SphereGeometry(0.11, 14, 10).scale(1, 0.72, 1).translate(ST.x - 0.08, F + 1.03, ST.z + 0.08),
    new THREE.CylinderGeometry(0.012, 0.022, 0.13, 6).rotateZ(1.0).translate(ST.x - 0.21, F + 1.06, ST.z + 0.08),
    new THREE.TorusGeometry(0.075, 0.008, 6, 14, Math.PI).translate(ST.x - 0.08, F + 1.09, ST.z + 0.08));
  // coal scuttle
  ironG.push(new THREE.CylinderGeometry(0.15, 0.11, 0.26, 12, 1, true).translate(ST.x - 0.1, F + 0.18, ST.z + 0.72));

  // bed in the north-west corner, a trunk at its foot
  const BED = { x: -3.3, z: -1.86 };
  wood.push(bx(1.95, 0.12, 0.92, BED.x, F + 0.3, BED.z, 1.2), bx(0.05, 0.86, 0.92, BED.x - 0.98, F + 0.43, BED.z, 1.2, true), bx(0.05, 0.56, 0.92, BED.x + 0.98, F + 0.28, BED.z, 1.2, true));
  legs(BED.x, BED.z, 0.95, 0.43, 0.26, 0.06);
  const soft = (g, amp, seed) => jitter(g, amp, 3.5, seed);
  const mattress = new THREE.Mesh(soft(new THREE.BoxGeometry(1.86, 0.14, 0.84, 8, 1, 4), 0.012, 1).translate(BED.x, F + 0.43, BED.z), cloth(0xb5ad9b));
  const blanket = new THREE.Mesh(soft(new THREE.BoxGeometry(1.3, 0.06, 0.9, 10, 1, 6), 0.022, 2).translate(BED.x + 0.26, F + 0.52, BED.z), cloth(0x4a5863));
  const pillow = new THREE.Mesh(soft(new THREE.SphereGeometry(0.3, 14, 10).scale(0.75, 0.22, 1.05), 0.012, 3).translate(BED.x - 0.7, F + 0.56, BED.z), cloth(0xd9d5cb));
  for (const m of [mattress, blanket, pillow]) { m.geometry.computeVertexNormals(); m.castShadow = m.receiveShadow = true; group.add(m); }
  const TRUNK = { x: -1.72, z: -1.98 };
  wood.push(bx(0.82, 0.4, 0.46, TRUNK.x, F + 0.2, TRUNK.z, 1.2));
  for (const s of [-0.26, 0.26]) ironG.push(new THREE.BoxGeometry(0.04, 0.41, 0.47).translate(TRUNK.x + s, F + 0.2, TRUNK.z));

  // shelf on the north wall: books, jars, the radio
  const SH = { x: -0.5, y: F + 1.5, z: -(d / 2 - TO - TI) + 0.11 };
  wood.push(bx(1.5, 0.03, 0.22, SH.x, SH.y, SH.z, 1.2));
  for (const s of [-0.6, 0.6]) wood.push(bx(0.03, 0.16, 0.18, SH.x + s, SH.y - 0.09, SH.z, 1.2));
  const bookCols = [0x6b2f28, 0x2f4a3c, 0x33405e, 0x7a6a3c, 0x4b2e3e, 0x2c2c30, 0x8a7f6a];
  let bxp = SH.x - 0.68;
  bookCols.forEach((hex, i) => {
    const t = 0.03 + (i * 37 % 5) * 0.008, h = 0.19 + (i * 13 % 4) * 0.018;
    const b = new THREE.Mesh(new THREE.BoxGeometry(t, h, 0.15).translate(bxp + t / 2, SH.y + 0.015 + h / 2, SH.z), cloth(hex));
    if (i === 6) b.geometry.rotateZ(-0.0); b.castShadow = true; group.add(b); bxp += t + 0.004;
  });
  const radio = new THREE.Mesh(fuse([new THREE.BoxGeometry(0.34, 0.2, 0.14).translate(SH.x + 0.42, SH.y + 0.115, SH.z)]), indoor(paint(0x3a2c20, 0.55)));
  const dial = new THREE.Mesh(fuse([new THREE.BoxGeometry(0.14, 0.11, 0.004).translate(SH.x + 0.36, SH.y + 0.12, SH.z + 0.072)]), indoor(paint(0xb8a57a, 0.8)));
  radio.castShadow = true; group.add(radio, dial);
  brassG.push(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10).rotateX(Math.PI / 2).translate(SH.x + 0.52, SH.y + 0.085, SH.z + 0.075),
    new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10).rotateX(Math.PI / 2).translate(SH.x + 0.52, SH.y + 0.145, SH.z + 0.075));
  const jars = new THREE.Mesh(fuse([0.0, 0.11].map((o, i) => new THREE.CylinderGeometry(0.04, 0.04, 0.12 + i * 0.03, 10).translate(SH.x - 0.02 + o, SH.y + 0.075 + i * 0.015, SH.z)), { smooth: true }),
    new THREE.MeshStandardNodeMaterial({ color: 0x8aa39a, roughness: 0.1, transparent: true, opacity: 0.45 }));
  group.add(jars);

  // oilskin by the door, boots under it, a rug
  const HOOK = { x: -1.35, z: d / 2 - TO - TI };
  wood.push(bx(0.7, 0.07, 0.025, HOOK.x, F + 1.72, HOOK.z - 0.013, 1.2));
  for (const s of [-0.22, 0, 0.22]) ironG.push(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 5).rotateX(Math.PI / 2).translate(HOOK.x + s, F + 1.71, HOOK.z - 0.05));
  const coatG = soft(new THREE.BoxGeometry(0.46, 1.08, 0.1, 5, 9, 2), 0.03, 7);
  { const p = coatG.getAttribute('position'); for (let i = 0; i < p.count; i++) { const yy = p.getY(i); p.setX(i, p.getX(i) * (0.72 + 0.28 * (0.54 - yy) / 1.08)); } }
  const coat = new THREE.Mesh(coatG.translate(HOOK.x - 0.22, F + 1.17, HOOK.z - 0.09), indoor(paint(0x4f3d12, 0.42)));
  coat.geometry.computeVertexNormals();
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 0.5).translate(HOOK.x + 0.22, F + 1.6, HOOK.z - 0.08), indoor(paint(0x4f3d12, 0.42)));
  const boots = new THREE.Mesh(fuse([-0.12, 0.1].map((o, i) => fuse([new THREE.CylinderGeometry(0.055, 0.06, 0.3, 8).translate(HOOK.x - 0.2 + o, F + 0.17, HOOK.z - 0.2 + i * 0.03),
    new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(HOOK.x - 0.2 + o, F + 0.035, HOOK.z - 0.26 + i * 0.03)]))), indoor(paint(0x15171a, 0.4)));
  const rug = new THREE.Mesh(fuse([new THREE.BoxGeometry(2.0, 0.012, 1.25).translate(0.3, F + 0.006, -0.05), new THREE.BoxGeometry(1.7, 0.014, 0.95).translate(0.3, F + 0.007, -0.05)]), cloth(0x3d1f1b));
  for (const m of [coat, hat, boots]) m.castShadow = true;
  rug.receiveShadow = true;
  group.add(coat, hat, boots, rug);

  mesh(wood, furn);
  mesh(ironG, iron, { smooth: true });
  mesh(brassG, brass, { smooth: true });
  mesh(hearth, indoor(surface(tex.wall, { tint: [0.8, 0.8, 0.8] })));

  // warm light thrown back off the sunlit wall; only worth paying for while someone is in the room
  const bounce = new THREE.PointLight(0xffd2b0, 0, 9, 1.6);
  bounce.position.set(0.6, F + 1.9, 0.5);
  group.add(bounce);

  // ---- colliders ------------------------------------------------------------------------------------
  const H = (TO + TI) / 2, zs = z + d / 2 - H, zn = z - d / 2 + H;
  colliders.segment(x - w / 2, zn, x + w / 2, zn, H, 0.3);
  colliders.segment(x - w / 2, zs, x + DOORX - 0.74, zs, H, 0.3);
  colliders.segment(x + DOORX + 0.74, zs, x + w / 2, zs, H, 0.3);
  for (const s of [-1, 1]) colliders.segment(x + s * (w / 2 - H), z - d / 2, x + s * (w / 2 - H), z + d / 2, H, 0.3);
  const blocker = colliders.segment(x + DOORX - 0.5, z + d / 2 - 0.13, x + DOORX + 0.5, z + d / 2 - 0.13, 0.1, 0);
  (colliders.fills = colliders.fills || []).push({ cx: x, cz: z, w: w + 0.3, d: d + 0.3, c: 1, s: 0 });
  colliders.segment(x + DESK.x - 0.5, z + DESK.z + 0.05, x + DESK.x + 0.5, z + DESK.z + 0.05, 0.3, 0);
  colliders.circle(x + DESK.x - 0.12, z + DESK.z - 0.78, 0.2);
  colliders.segment(x + BED.x - 0.8, z + BED.z, x + BED.x + 0.8, z + BED.z, 0.46, 0);
  colliders.segment(x + TRUNK.x - 0.25, z + TRUNK.z, x + TRUNK.x + 0.25, z + TRUNK.z, 0.24, 0);
  colliders.circle(x + ST.x, z + ST.z, 0.4);
  colliders.circle(x + TB.x, z + TB.z, 0.5);
  colliders.circle(x + TB.x + 0.25, z + TB.z + 0.72, 0.2);

  const world = (v, dy = 0) => new THREE.Vector3(x + v.x, y0 + v.y + dy, z + v.z);
  let open = 0, target = 0, vel = 0, lampOn = false, lampK = 0;
  return {
    group,
    doorPos: new THREE.Vector3(x + DOORX, y0 + 1.5, z + d / 2 - 0.13),
    logPos: world(logLocal, 0.03), lampPos: world(lampLocal, 0.15), tidePos: world(tideLocal),
    get doorOpen() { return target === 1; },
    get moving() { return open !== target; },
    get lampLit() { return lampOn; },
    inside: (px, pz) => Math.abs(px - x) < w / 2 - 0.3 && Math.abs(pz - z) < d / 2 - 0.2,
    openDoor() { target = 1; blocker.on = false; },
    lightLamp() { lampOn = true; },
    /** @param k 0 outdoors .. 1 indoors (eased by the caller) */
    update(dt, t, k) {
      if (open !== target) {
        vel += (7 * (target - open) - 3.2 * vel) * dt; open += vel * dt;
        if (Math.abs(target - open) < 0.002 && Math.abs(vel) < 0.01) { open = target; vel = 0; }
        pivot.rotation.y = 1.72 * open;                    // swings inward
      }
      if (lampOn && lampK < 1) lampK = Math.min(1, lampK + dt / 1.2);
      const flick = 0.93 + 0.05 * Math.sin(t * 11.3) + 0.03 * Math.sin(t * 27.1);
      flameK.value = lampK * flick;
      lampLight.intensity = 3.2 * lampK * flick;
      bounce.intensity = 3.0 * k;
    },
  };
}
