// Geometry and material helpers shared by the props.
import * as THREE from 'three/webgpu';
import { texture, uv, positionWorld, normalWorld, mix, smoothstep, vec3, float, mx_noise_float, transformNormalToView } from 'three/tsl';
import { sunFlat } from './terrain.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise } from './noise.js';

export { mergeGeometries };

/** Box-projected UVs in metres x scale, from each face's dominant axis. Returns a non-indexed geometry. */
export function boxUV(geometry, scale = 1, swap = false) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute('position');
  const uvs = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.copy(b).sub(a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u, v;
      if (ax >= ay && ax >= az) { u = p.z; v = p.y; } else if (ay >= az) { u = p.x; v = p.z; } else { u = p.x; v = p.y; }
      if (swap) [u, v] = [v, u];
      uvs[(i + k) * 2] = u * scale; uvs[(i + k) * 2 + 1] = v * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}

/** Move vertices by position-keyed noise, so coincident vertices stay welded. */
export function jitter(geometry, amp, freq = 2.3, seed = 0) {
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setXYZ(i,
      x + amp * noise(y * freq + 3.1, z * freq + x * 0.7, seed + 1),
      y + amp * noise(z * freq + 5.3, x * freq + y * 0.7, seed + 2),
      z + amp * noise(x * freq + 7.7, y * freq + z * 0.7, seed + 3));
  }
  return geometry;
}

/** A box with its base centre at the origin. */
export const boxUp = (w, h, d, sx = 1, sy = 1, sz = 1) => new THREE.BoxGeometry(w, h, d, sx, sy, sz).translate(0, h / 2, 0);

export const place = (geometry, x, y, z, yaw = 0, pitch = 0, roll = 0) => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), new THREE.Vector3(1, 1, 1));
  return geometry.applyMatrix4(m);
};

/** Merge a list of geometries into one mesh-ready geometry with fresh normals. */
export const fuse = (list, { smooth = false } = {}) => {
  const prepared = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (!['position', 'uv', 'normal', 'color'].includes(name)) n.deleteAttribute(name);
    if (!n.getAttribute('uv')) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2));
    if (!smooth || !n.getAttribute('normal')) n.computeVertexNormals();
    return n;
  });
  const hasColor = prepared.some((g) => g.getAttribute('color'));
  if (hasColor) for (const g of prepared) {
    if (!g.getAttribute('color')) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
  }
  return mergeGeometries(prepared, false);
};

export const tintGeometry = (g, r, gr, b) => {
  const n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gr; a[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};

const triplanar = (tex, p, n, s) => {
  const w = n.abs().pow(float(4));
  const ws = w.div(w.x.add(w.y).add(w.z));
  return texture(tex, p.zy.mul(s)).rgb.mul(ws.x).add(texture(tex, p.xz.mul(s)).rgb.mul(ws.y)).add(texture(tex, p.xy.mul(s)).rgb.mul(ws.z));
};

/** Lichen: pale grey-green crust and ochre spots, by world-space noise. Returns { color, amount }. */
const lichen = (p, freq = 5.0) => {
  const a = mx_noise_float(p.mul(freq)).mul(0.5).add(0.5);
  const b = mx_noise_float(p.mul(freq * 3.7).add(11.0)).mul(0.5).add(0.5);
  const amount = smoothstep(0.56, 0.7, a.mul(0.7).add(b.mul(0.3)));
  const ochre = smoothstep(0.62, 0.8, mx_noise_float(p.mul(freq * 0.6).add(31.0)).mul(0.5).add(0.5));
  const color = mix(vec3(0.42, 0.44, 0.34), vec3(0.52, 0.40, 0.12), ochre);
  return { color, amount };
};

/** UV-mapped PBR material from a texture set. opts: { tint:[r,g,b], lichen:number, lichenFreq, vertexColors } */
export function surface(set, opts = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughnessMap: set.r, metalness: 0, vertexColors: !!opts.vertexColors });
  // Flat things underfoot take the low sun the way the turf around them does (see terrain.js).
  if (opts.leanToSun) m.normalNode = transformNormalToView(normalWorld.add(sunFlat.mul(opts.leanToSun)).normalize());
  else m.normalMap = set.n;
  if (opts.normalScale) m.normalScale = new THREE.Vector2(opts.normalScale, opts.normalScale);
  const t = opts.tint ?? [1, 1, 1];
  let col = texture(set.c, uv()).rgb.mul(vec3(t[0], t[1], t[2]));
  if (opts.lichen) {
    const L = lichen(positionWorld, opts.lichenFreq ?? 5);
    col = mix(col, L.color, L.amount.mul(opts.lichen));
  }
  if (opts.extra) col = opts.extra(col);
  m.colorNode = col;
  return m;
}

/** World-triplanar rock for boulders and rough stonework: no UVs needed. */
export function rockSurface(tex, opts = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.9, vertexColors: !!opts.vertexColors });
  const p = positionWorld, n = normalWorld;
  const a = triplanar(tex.rock.c, p, n, opts.scale ?? 0.42);
  const b = triplanar(tex.rockmoss.c, p, n, (opts.scale ?? 0.42) * 0.6);
  const patch = smoothstep(0.4, 0.75, mx_noise_float(p.mul(0.5)).mul(0.5).add(0.5));
  const t = opts.tint ?? [1.15, 1.08, 0.98];
  let col = mix(a, b.mul(0.8), patch.mul(opts.moss ?? 0.35)).mul(vec3(t[0], t[1], t[2]));
  const L = lichen(p, opts.lichenFreq ?? 3.2);
  col = mix(col, L.color, L.amount.mul(opts.lichen ?? 0.7).mul(smoothstep(-0.2, 0.5, n.y)));
  m.colorNode = col;
  return m;
}
