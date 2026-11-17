// The walked foreground: flagstones, the old fence, dry-stone walls with the gate, and boulders.
import * as THREE from 'three/webgpu';
import { heightAt, pathSamples, pathAt, coastX, pathDist, GATE, COMPOUND, PATH_LENGTH } from './layout.js';
import { rng, noise, lerp, smooth } from './noise.js';
import { boxUV, jitter, boxUp, place, fuse, tintGeometry, surface, rockSurface } from './build.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const left = (t) => ({ x: t.tz, z: -t.tx });      // unit vector to the walker's left (the sea side)

// ---- flagstones -------------------------------------------------------------------------------------
function flagstones(tex) {
  const R = rng(4242);
  const pos = [], uvs = [], col = [], idx = [];
  // One slab: a rounded-rectangle outline (superellipse) with knocked corners, so neighbours fit like paving.
  const stone = (cx, cz, ra, rb, yaw) => {
    const n = 11, base = pos.length / 3;
    const tone = 0.66 + R() * 0.5, warm = (R() - 0.5) * 0.14;
    const c = [tone * (1.02 + warm), tone, tone * (0.97 - warm)];
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const power = 2.6 + R() * 2.2, chipAt = R() * Math.PI * 2, chip = R() < 0.6 ? 0.62 + R() * 0.2 : 1, chip2 = chipAt + 2 + R() * 2;
    const tiltA = (R() - 0.5) * 0.03, tiltB = (R() - 0.5) * 0.03;
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.3;
      let k = 1 / (Math.abs(Math.cos(a)) ** power + Math.abs(Math.sin(a)) ** power) ** (1 / power);
      k *= 0.9 + R() * 0.16;
      const da = Math.abs(Math.atan2(Math.sin(a - chipAt), Math.cos(a - chipAt))), db = Math.abs(Math.atan2(Math.sin(a - chip2), Math.cos(a - chip2)));
      if (da < 0.55) k *= chip;
      if (db < 0.4) k *= 0.86;
      ring.push([Math.cos(a) * ra * k, Math.sin(a) * rb * k]);
    }
    const push = (lx, lz, lift) => {
      const x = cx + lx * cy - lz * sy, z = cz + lx * sy + lz * cy;
      pos.push(x, heightAt(x, z) + lift + lx * tiltA + lz * tiltB, z); uvs.push(x * 0.7, z * 0.7); col.push(c[0], c[1], c[2]);
    };
    const top = 0.022 + R() * 0.022;
    push(0, 0, top + 0.004);                                             // centre
    for (const [x, z] of ring) push(x * 0.93, z * 0.93, top);            // top edge
    for (const [x, z] of ring) push(x, z, top - 0.014);                  // worn arris
    for (const [x, z] of ring) push(x * 1.01, z * 1.01, -0.09);          // skirt into the earth
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, t0 = base + 1 + i, t1 = base + 1 + j, b0 = t0 + n, b1 = t1 + n, s0 = b0 + n, s1 = b1 + n;
      idx.push(base, t1, t0, t0, t1, b1, t0, b1, b0, b0, b1, s1, b0, s1, s0);
    }
  };
  const W = 1.46;                                                        // paved width
  let s = 1.2;
  while (s < PATH_LENGTH - 0.6) {
    const p = pathAt(s / PATH_LENGTH), yaw = Math.atan2(p.tz, p.tx);
    const r = R(), count = r < 0.2 ? 1 : r < 0.68 ? 2 : 3;
    const depth = count === 1 ? 0.3 + R() * 0.1 : count === 2 ? 0.36 + R() * 0.14 : 0.3 + R() * 0.1;   // half-length along the walk
    // split the width unevenly
    const cuts = [0];
    for (let i = 1; i < count; i++) cuts.push(i / count + (R() - 0.5) * 0.24);
    cuts.push(1);
    const wander = (R() - 0.5) * 0.14;
    for (let i = 0; i < count; i++) {
      if (R() < 0.06) continue;                                          // a stone gone, grass in its place
      const a0 = cuts[i], a1 = cuts[i + 1], half = (a1 - a0) * W / 2 - 0.035;
      const off = ((a0 + a1) / 2 - 0.5) * W + wander, along = (R() - 0.5) * 0.1;
      stone(p.x + p.tz * off + p.tx * along, p.z - p.tx * off + p.tz * along, depth * (0.86 + R() * 0.2), half, yaw + (R() - 0.5) * 0.16);
    }
    s += depth * 2 + 0.05 + R() * 0.06;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, surface(tex.rock, { tint: [2.3, 2.12, 1.85], lichen: 0.3, lichenFreq: 5, vertexColors: true, leanToSun: 0.7 }));
  mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'flagstones';
  return mesh;
}

// ---- fence ------------------------------------------------------------------------------------------
function fence(tex, colliders) {
  const R = rng(777);
  const posts = [], rails = [];
  const line = [];
  const SPAN = 2.35;
  for (let s = 5; s < PATH_LENGTH * (GATE.t - 0.015); s += SPAN) {
    const p = pathAt(s / PATH_LENGTH), L = left(p);
    let off = 2.0 + 0.5 * noise(s * 0.11, 2.0, 9);
    let x = p.x + L.x * off, z = p.z + L.z * off;
    const d = x - coastX(z);
    if (d < 2.2) { x += 2.2 - d; }                                       // never past the lip
    line.push({ x, z, y: heightAt(x, z), s });
  }
  line.forEach((p, i) => {
    const h = 1.12 + R() * 0.2, w = 0.17 + R() * 0.05;
    let g = boxUp(w, h, w * (0.9 + R() * 0.25), 1, 5, 1);
    jitter(g, 0.014, 5, i);
    g = boxUV(g, 1.4, true);
    place(g, p.x, p.y - 0.12, p.z, R() * 3, (R() - 0.5) * 0.11, (R() - 0.5) * 0.11);
    posts.push(g);
    p.top = h - 0.12;
    colliders.circle(p.x, p.z, 0.1, 0.05);
  });
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    if (i === 9 || i === 10) continue;                                   // a gap where the fence has fallen
    colliders.segment(a.x, a.z, b.x, b.z, 0.07, 0.0);
    for (const hgt of [0.5, 0.96]) {
      const broken = R() < 0.09;
      const ay = a.y + hgt + (R() - 0.5) * 0.05, by = broken ? b.y + 0.06 : b.y + hgt + (R() - 0.5) * 0.05;
      const dx = b.x - a.x, dy = by - ay, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) * (broken ? 0.82 : 1.04);
      let g = new THREE.BoxGeometry(len, 0.11 + R() * 0.025, 0.045 + R() * 0.012, 6, 1, 1);
      jitter(g, 0.01, 4, i * 7 + hgt * 10);
      g = boxUV(g, 1.2, false);
      const yaw = Math.atan2(-dz, dx), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw, pitch, 'YZX'));
      g.applyMatrix4(m);
      const k = broken ? 0.41 : 0.5;
      g.translate(a.x + dx * k, ay + dy * k, a.z + dz * k);
      const side = 0.1;                                                // nailed to the landward face
      g.translate(-dz / Math.hypot(dx, dz) * side, 0, dx / Math.hypot(dx, dz) * side);
      rails.push(g);
    }
  }
  const mat = surface(tex.wood, { tint: [1.2, 1.06, 0.88], lichen: 0.8, lichenFreq: 7.5 });
  const mesh = new THREE.Mesh(fuse([...posts, ...rails]), mat);
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'fence';
  return { mesh, material: mat, line };
}

// ---- dry-stone walls --------------------------------------------------------------------------------
function wallRun(points, out, colliders, R, { height = 1.1, thick = 0.52 } = {}) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 0.95));
    colliders.segment(a[0], a[1], b[0], b[1], thick / 2, 0.3);
    const yaw = Math.atan2(-dz, dx);
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n, x = a[0] + dx * f, z = a[1] + dz * f;
      const y = Math.min(heightAt(x, z), heightAt(x + dx / len * 0.4, z + dz / len * 0.4), heightAt(x - dx / len * 0.4, z - dz / len * 0.4));
      const h = height + (R() - 0.5) * 0.07;
      let g = boxUp(len / n + 0.06, h + 0.3, thick * (0.92 + R() * 0.16), 2, 3, 1);
      jitter(g, 0.035, 2.4, i * 31 + k);
      // batter: the wall narrows toward the top
      const p = g.getAttribute('position');
      for (let v = 0; v < p.count; v++) p.setZ(v, p.getZ(v) * (1 - 0.22 * (p.getY(v) / (h + 0.3))));
      g = boxUV(g, 0.7);
      place(g, x, y - 0.3, z, yaw);
      out.push(g);
      // coping: flat cap stones, a hand wider than the wall, laid end to end
      let run = 0;
      const seg = len / n;
      while (run < seg - 0.02) {
        const cl = Math.min(seg - run, 0.3 + R() * 0.26);
        const cf = (k + (run + cl / 2) / seg) / n, cx = a[0] + dx * cf, cz = a[1] + dz * cf;
        let s = new THREE.BoxGeometry(cl - 0.012, 0.075 + R() * 0.03, thick * (1.0 + R() * 0.14), 2, 1, 2);
        jitter(s, 0.014, 5, run * 7 + k * 13 + i * 71);
        s = boxUV(s, 0.9);
        tintGeometry(s, 0.86 + R() * 0.24, 0.86 + R() * 0.22, 0.86 + R() * 0.2);
        place(s, cx, y + h + 0.03 + (R() - 0.5) * 0.012, cz, yaw + (R() - 0.5) * 0.05, (R() - 0.5) * 0.05, (R() - 0.5) * 0.04);
        out.push(s);
        run += cl;
      }
    }
  }
}

function walls(tex, colliders) {
  const R = rng(9001);
  const out = [];
  // 1. the field wall that crosses the path at the gate
  const g = pathAt(GATE.t), L = left(g);
  const GAP = 0.95;
  const run = (from, to) => {
    const pts = [];
    const n = Math.ceil(Math.abs(to - from) / 3);
    for (let i = 0; i <= n; i++) {
      const s = lerp(from, to, i / n), wob = 0.5 * noise(s * 0.2, 4.4, 5) * smooth(2, 8, Math.abs(s));
      pts.push([g.x + L.x * s + g.tx * wob, g.z + L.z * s + g.tz * wob]);
    }
    return pts;
  };
  let seaEnd = GAP;
  for (let s = GAP; s < 60; s += 0.5) { const x = g.x + L.x * s, z = g.z + L.z * s; if (x - coastX(z) < 1.8) break; seaEnd = s; }
  wallRun(run(GAP, seaEnd), out, colliders, R);
  wallRun(run(-GAP, -46), out, colliders, R);

  // 2. the yard wall, open where the path comes in
  const X0 = COMPOUND.x - 21, X1 = COMPOUND.x + 21, Z0 = COMPOUND.z - 17.5, Z1 = COMPOUND.z + 16.2;
  let gx = COMPOUND.x;                                                   // where the path crosses the south side
  for (const [x, z] of pathSamples) if (Math.abs(z - Z1) < 0.3) gx = x;
  const seg = (ax, az, bx, bz) => {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 4), pts = [];
    for (let i = 0; i <= n; i++) pts.push([lerp(ax, bx, i / n) + 0.25 * noise(i * 0.9, ax + az, 6), lerp(az, bz, i / n) + 0.25 * noise(i * 0.9, bx + bz, 7)]);
    pts[0] = [ax, az]; pts[n] = [bx, bz];
    return pts;
  };
  const yardOpts = { height: 0.92, thick: 0.5 };
  wallRun(seg(gx + 1.15, Z1, X1, Z1), out, colliders, R, yardOpts);
  wallRun(seg(X1, Z1, X1, Z0), out, colliders, R, yardOpts);
  wallRun(seg(X1, Z0, X0, Z0), out, colliders, R, yardOpts);
  wallRun(seg(X0, Z0, X0, Z1), out, colliders, R, yardOpts);
  wallRun(seg(X0, Z1, gx - 1.15, Z1), out, colliders, R, yardOpts);

  const mat = surface(tex.wall, { tint: [1.15, 1.12, 1.06], lichen: 0.5, lichenFreq: 4.5, vertexColors: true });
  const mesh = new THREE.Mesh(fuse(out), mat);
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'walls';
  return { mesh, gate: g, gapHalf: GAP, yardGate: { x: gx, z: Z1 } };
}

// ---- the gate ---------------------------------------------------------------------------------------
function gate(tex, colliders, g, gapHalf, woodMat) {
  const L = left(g);
  const hinge = { x: g.x + L.x * gapHalf * 0.94, z: g.z + L.z * gapHalf * 0.94 };
  const latch = { x: g.x - L.x * gapHalf * 0.94, z: g.z - L.z * gapHalf * 0.94 };
  const y = heightAt(g.x, g.z);
  const W = gapHalf * 1.88;
  const parts = [];
  const bar = (len, h, d, x, yy, rot = 0) => {
    let b = new THREE.BoxGeometry(len, h, d, 4, 1, 1);
    jitter(b, 0.008, 5, parts.length);
    b = boxUV(b, 1.3);
    b.rotateZ(rot); b.translate(x, yy, 0);
    parts.push(b);
  };
  for (const yy of [0.22, 0.47, 0.72, 0.97]) bar(W, 0.075, 0.035, W / 2, yy);    // rails
  bar(0.085, 1.0, 0.05, 0.045, 0.6); bar(0.085, 1.0, 0.05, W - 0.045, 0.6);     // stiles
  bar(Math.hypot(W - 0.1, 0.75) , 0.07, 0.03, W / 2, 0.6, Math.atan2(0.75, W - 0.1)); // brace
  const leaf = new THREE.Mesh(fuse(parts), woodMat);
  leaf.castShadow = leaf.receiveShadow = true;

  // two stout gateposts
  const postG = [];
  for (const p of [hinge, latch]) {
    let b = boxUp(0.19, 1.42, 0.19, 1, 5, 1);
    jitter(b, 0.016, 4, p.x);
    b = boxUV(b, 1.4, true);
    place(b, p.x + (p === hinge ? L.x : -L.x) * 0.13, heightAt(p.x, p.z) - 0.15, p.z + (p === hinge ? L.z : -L.z) * 0.13, 0.3);
    postG.push(b);
    colliders.circle(p.x + (p === hinge ? L.x : -L.x) * 0.13, p.z + (p === hinge ? L.z : -L.z) * 0.13, 0.13, 0.1);
  }
  const posts = new THREE.Mesh(fuse(postG), woodMat);
  posts.castShadow = posts.receiveShadow = true;

  const pivot = new THREE.Group();
  pivot.position.set(hinge.x, y + 0.06, hinge.z);
  const closedYaw = Math.atan2(-(latch.z - hinge.z), latch.x - hinge.x);
  pivot.rotation.y = closedYaw;
  pivot.add(leaf);
  const blocker = colliders.segment(hinge.x, hinge.z, latch.x, latch.z, 0.07, 0, W);

  const group = new THREE.Group();
  group.add(pivot, posts);
  let progress = 0, opening = false, swing = 0;
  const behindGate = (p) => (p.x - g.x) * g.tx + (p.z - g.z) * g.tz;
  const forwardSwing = ((latch.z - hinge.z) * g.tx - (latch.x - hinge.x) * g.tz) > 0 ? 1 : -1;
  return {
    group, pivot, blocker,
    position: new THREE.Vector3(g.x, y + 0.75, g.z),
    get moving() { return opening && progress < 1; },
    canPush(p, facing) {
      const along = behindGate(p);
      const across = (p.x - g.x) * L.x + (p.z - g.z) * L.z;
      const toward = (facing.x * g.tx + facing.z * g.tz) * -Math.sign(along);
      return Math.abs(along) < 0.69 && Math.abs(across) < gapHalf - 0.26 && toward > 0.6;
    },
    open(p) {
      if (opening) return;
      swing = forwardSwing * (behindGate(p) > 0 ? -1 : 1) * 1.73;
      opening = true;
    },
    update(dt) {
      if (!opening || progress === 1) return;
      progress = Math.min(1, progress + dt / 1.15);
      const eased = progress * progress * (3 - 2 * progress);
      pivot.rotation.y = closedYaw + swing * eased;
      blocker.bx = hinge.x + W * Math.cos(pivot.rotation.y);
      blocker.bz = hinge.z - W * Math.sin(pivot.rotation.y);
    },
  };
}

// ---- boulders ---------------------------------------------------------------------------------------
function boulders(tex, colliders, avoid) {
  const R = rng(31337);
  const out = [];
  const make = (x, z, r, squash, seed) => {
    let g = new THREE.IcosahedronGeometry(1, 3);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-4);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      let k = 1 + 0.26 * noise(vx * 1.6 + seed, vy * 1.6 + vz * 1.1, seed) + 0.1 * noise(vx * 4.2 + vz, vy * 4.2 + seed, seed + 5);
      k *= 1 - 0.18 * Math.max(0, Math.sin(vy * 9 + noise(vx * 2, vz * 2, seed) * 2)) * 0.5;  // bedding cracks
      p.setXYZ(i, vx * k * r * (0.9 + 0.35 * noise(seed, 1.5, 3)), vy * k * r * squash, vz * k * r * (0.9 + 0.35 * noise(seed, 2.5, 4)));
    }
    g.rotateY(R() * 6.28);
    g.translate(x, heightAt(x, z) + r * squash * 0.22, z);
    g.computeVertexNormals();
    out.push(g);
    if (r > 0.45) colliders.circle(x, z, r * 0.82, r * 0.2);
  };
  // authored: the lichen boulders by the start, and outcrops along the way
  const hero = [[9.6, 43.2, 1.25, 0.62], [11.2, 41.5, 0.8, 0.6], [8.9, 45.4, 0.55, 0.55], [1.5, 30.5, 0.7, 0.5], [-17.5, -8, 1.1, 0.55],
    [-7.5, -24, 0.9, 0.5], [-3.2, -44, 1.3, 0.6], [-1.5, -46, 0.7, 0.55], [8.5, -66, 1.0, 0.55], [-1.5, -98, 1.4, 0.6], [9.5, -117, 0.9, 0.5]];
  hero.forEach(([x, z, r, s], i) => make(x, z, r, s, 100 + i * 7.3));
  let placed = 0, tries = 0;
  while (placed < 70 && tries++ < 4000) {
    const s = R() * PATH_LENGTH, p = pathAt(s / PATH_LENGTH);
    const side = R() < 0.5 ? -1 : 1, off = 2.6 + R() * R() * 34;
    const x = p.x + p.tz * side * off + (R() - 0.5) * 3, z = p.z - p.tx * side * off + (R() - 0.5) * 3;
    if (x - coastX(z) < 0.5 || pathDist(x, z) < 2.3 || avoid(x, z)) continue;
    if (noise(x / 14, z / 14, 88) < 0.05) continue;                      // rocks come in outcrops, not evenly
    make(x, z, 0.22 + R() * R() * 1.1, 0.42 + R() * 0.25, 500 + placed * 3.7);
    placed++;
  }
  const mesh = new THREE.Mesh(fuse(out, { smooth: true }), rockSurface(tex, { lichen: 0.8, moss: 0.45 }));
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'boulders';
  return mesh;
}

export function createProps(scene, tex, colliders) {
  const stones = flagstones(tex);
  const f = fence(tex, colliders);
  const w = walls(tex, colliders);
  const g = gate(tex, colliders, w.gate, w.gapHalf, f.material);
  const yard = (x, z) => Math.abs(x - COMPOUND.x) < 22.5 && Math.abs(z - (COMPOUND.z - 0.6)) < 18.5;
  const rocks = boulders(tex, colliders, (x, z) => yard(x, z) || colliders.covers(x, z));
  scene.add(stones, f.mesh, w.mesh, g.group, rocks);
  return { stones, fence: f, walls: w, gate: g, rocks };
}
