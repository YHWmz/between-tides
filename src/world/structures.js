// The lighthouse, the keeper's cottage, and the small things people left along the way.
import * as THREE from 'three/webgpu';
import { texture, uv, positionWorld, mix, smoothstep, vec3, float, mx_noise_float, uniform } from 'three/tsl';
import { heightAt, pathAt, LIGHTHOUSE, COTTAGE, GATE } from './layout.js';
import { boxUV, jitter, boxUp, place, fuse, surface, rockSurface } from './build.js';
import { createCottage } from './cottage.js';
import { createLighthouse } from './lighthouse.js';

const paint = (hex, rough = 0.6, metal = 0) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness: rough, metalness: metal });

/** Limewash over stone: the plaster photo with rain streaks and green at the foot. */
function limewash(tex, baseY, tint = [1.0, 0.99, 0.96]) {
  return surface(tex.plaster, {
    tint,
    extra: (col) => {
      const p = positionWorld;
      const streak = mx_noise_float(vec3(p.x.mul(2.6), p.y.mul(0.16), p.z.mul(2.6))).mul(0.5).add(0.5);
      const blot = mx_noise_float(p.mul(0.9)).mul(0.5).add(0.5);
      const grime = smoothstep(0.42, 0.8, streak.mul(0.65).add(blot.mul(0.35)));
      let c = mix(col, col.mul(vec3(0.5, 0.46, 0.38)), grime.mul(0.8));
      const foot = smoothstep(float(baseY + 0.1), float(baseY + 2.6), p.y).oneMinus().mul(mx_noise_float(vec3(p.x.mul(1.7), p.y.mul(0.9), p.z.mul(1.7))).mul(0.5).add(0.6));
      c = mix(c, vec3(0.2, 0.23, 0.13), foot.clamp(0, 1).mul(0.6));
      return c;
    },
  });
}


// ---- things left along the way ----------------------------------------------------------------------
function bench(tex, colliders) {
  const p = pathAt(0.185), rx = -p.tz, rz = p.tx;                       // to the walker's right, inland
  const x = p.x + rx * 1.95, z = p.z + rz * 1.95, y = heightAt(x, z);
  const yaw = Math.atan2(-rx, -rz);                                     // seat faces the sea, across the path
  const wood = surface(tex.wood, { tint: [0.86, 0.82, 0.76], lichen: 0.7, lichenFreq: 8 });
  const parts = [];
  const plank = (len, h, dp, px, py, pz, pitch = 0) => {
    let g = new THREE.BoxGeometry(len, h, dp, 5, 1, 1); jitter(g, 0.007, 5, py * 9 + pz * 5);
    g = boxUV(g, 1.2); g.rotateX(pitch); g.translate(px, py, pz); parts.push(g);
  };
  for (const zz of [-0.15, 0, 0.15]) plank(1.55, 0.04, 0.125, 0, 0.45, zz);
  for (const yy of [0.68, 0.86]) plank(1.55, 0.13, 0.035, 0, yy, -0.25, -0.2);
  for (const s of [-0.62, 0.62]) {
    parts.push(boxUV(boxUp(0.07, 0.45, 0.42), 1.3, true).translate(s, 0, 0));
    let b = boxUp(0.06, 0.98, 0.06); b = boxUV(b, 1.3, true); b.rotateX(-0.2); b.translate(s, 0, -0.22); parts.push(b);
  }
  const mesh = new THREE.Mesh(fuse(parts), wood);
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.008), new THREE.MeshStandardNodeMaterial({ color: 0x9a7a3a, roughness: 0.38, metalness: 0.9 }));
  plaque.position.set(0, 0.86, -0.262); plaque.rotation.x = -0.2;
  const group = new THREE.Group(); group.add(mesh, plaque);
  group.position.set(x, y - 0.02, z); group.rotation.y = yaw;
  mesh.castShadow = mesh.receiveShadow = true;
  colliders.segment(x - Math.cos(yaw) * 0.7, z + Math.sin(yaw) * 0.7, x + Math.cos(yaw) * 0.7, z - Math.sin(yaw) * 0.7, 0.3, 0.1);
  return { group, pos: new THREE.Vector3(x, y + 0.8, z) };
}

function milestone(tex, colliders) {
  const p = pathAt(0.405), rx = -p.tz, rz = p.tx;
  const x = p.x + rx * 1.35, z = p.z + rz * 1.35, y = heightAt(x, z);
  let g = boxUp(0.36, 0.86, 0.2, 2, 4, 1); jitter(g, 0.022, 3, 5);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.8) pos.setX(i, pos.getX(i) * 0.72);    // a rounded head
  const mesh = new THREE.Mesh(place(g, x, y - 0.14, z, Math.atan2(p.tx, p.tz) + 0.5, 0.06, -0.05), rockSurface(tex, { scale: 0.9, lichen: 0.9, tint: [1.5, 1.42, 1.3], moss: 0.15 }));
  mesh.castShadow = mesh.receiveShadow = true;
  colliders.circle(x, z, 0.22, 0.05);
  return { group: mesh, pos: new THREE.Vector3(x, y + 0.55, z) };
}

function mailbox(tex, colliders) {
  const g = pathAt(GATE.t), rx = -g.tz, rz = g.tx;
  const x = g.x - g.tx * 1.5 + rx * 1.75, z = g.z - g.tz * 1.5 + rz * 1.75, y = heightAt(x, z);
  const wood = surface(tex.wood, { tint: [0.86, 0.82, 0.76], lichen: 0.6 });
  // post, a shelf board and a brace under it
  const brace = boxUV(new THREE.BoxGeometry(0.05, 0.34, 0.05), 1.4, true); brace.rotateX(-0.82); brace.translate(0, 1.02, 0.14);
  const timber = new THREE.Mesh(fuse([
    boxUV(jitter(boxUp(0.105, 1.17, 0.105, 1, 4, 1), 0.01, 5, 2), 1.4, true),
    boxUV(new THREE.BoxGeometry(0.19, 0.028, 0.5), 1.4).translate(0, 1.184, 0.04),
    brace,
  ]), wood);
  // the tin: an arched box, painted once, rusting along the seams
  const arch = (w, h) => { const s = new THREE.Shape(); s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w, h); s.absarc(0, h, w, 0, Math.PI, false); s.lineTo(-w, 0); return s; };
  const tin = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.35 });
  {
    const p = positionWorld;
    const rust = smoothstep(0.42, 0.72, mx_noise_float(p.mul(9.0)).mul(0.5).add(0.5).mul(0.7).add(mx_noise_float(p.mul(37.0)).mul(0.5).add(0.5).mul(0.3)));
    tin.colorNode = mix(vec3(0.05, 0.085, 0.062), vec3(0.16, 0.07, 0.03), rust.mul(0.85));
    tin.roughnessNode = mix(float(0.5), float(0.92), rust);
    tin.metalnessNode = mix(float(0.45), float(0.05), rust);
  }
  const body = new THREE.ExtrudeGeometry(arch(0.105, 0.12), { depth: 0.44, bevelEnabled: false, curveSegments: 14 }).translate(0, 1.2, -0.18);
  const door = new THREE.ExtrudeGeometry(arch(0.112, 0.124), { depth: 0.014, bevelEnabled: false, curveSegments: 14 }).translate(0, 1.197, 0.26);
  const rim = new THREE.ExtrudeGeometry(arch(0.112, 0.124), { depth: 0.012, bevelEnabled: false, curveSegments: 14 }).translate(0, 1.197, -0.188);
  const shell = new THREE.Mesh(fuse([body, door, rim, new THREE.BoxGeometry(0.03, 0.012, 0.02).translate(0, 1.21, 0.278)], { smooth: true }), tin);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8).translate(0, 1.37, 0.28), paint(0x9a7a3a, 0.4, 0.9));
  // the flag, left up: there is something inside
  const flagG = fuse([new THREE.BoxGeometry(0.008, 0.2, 0.018).translate(0, 0.1, 0), new THREE.BoxGeometry(0.008, 0.062, 0.085).translate(0, 0.17, 0.045)]);
  const flag = new THREE.Mesh(flagG, paint(0x8a2d20, 0.55, 0.25));
  flag.position.set(0.112, 1.27, 0.12); flag.rotation.x = -0.12;
  const group = new THREE.Group(); group.add(timber, shell, knob, flag);
  group.position.set(x, y - 0.1, z); group.rotation.set(0.04, Math.atan2(-rx, -rz), -0.05);
  for (const m of [timber, shell, knob, flag]) { m.castShadow = true; m.receiveShadow = true; }
  colliders.circle(x, z, 0.14, 0.05);
  return { group, pos: new THREE.Vector3(x, y + 1.2, z) };
}

export function createStructures(scene, tex, colliders) {
  const lh = createLighthouse(tex, colliders);
  const ct = createCottage(tex, colliders, { limewash, paint });
  const bn = bench(tex, colliders);
  const ms = milestone(tex, colliders);
  const mb = mailbox(tex, colliders);
  scene.add(lh.group, ct.group, bn.group, ms.group, mb.group);
  return { lighthouse: lh, cottage: ct, bench: bn, milestone: ms, mailbox: mb };
}
