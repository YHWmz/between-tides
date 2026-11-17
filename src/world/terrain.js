// Terrain meshes (a dense near tile and a coarse far tile) and the ground material.
import * as THREE from 'three/webgpu';
import {
  texture, positionWorld, normalWorld, attribute, mix, smoothstep, float, vec3, mx_noise_float, Fn, transformNormalToView, uniform,
} from 'three/tsl';
import { heightAt, pathDist, coastX } from './layout.js';
import { smooth } from './noise.js';

export const NEAR = { x0: -96, x1: 150, z0: -290, z1: 130, step: 1 };
const FAR = { x0: -2400, x1: 1500, z0: -2500, z1: 1000, step: 13 };

/** Colour of the turf at a world position (TSL). Shared by the terrain and the grass cards. */
export const turfTint = Fn(([p]) => {
  const macro = mx_noise_float(vec3(p.x.mul(0.021), p.z.mul(0.021), 3.7)).mul(0.5).add(0.5);
  const patch = mx_noise_float(vec3(p.x.mul(0.13), p.z.mul(0.13), 9.1)).mul(0.5).add(0.5);
  const k = macro.mul(0.65).add(patch.mul(0.35));
  const green = vec3(0.080, 0.122, 0.040);
  const straw = vec3(0.205, 0.170, 0.070);
  return mix(green, straw, smoothstep(0.42, 0.82, k));
});

const triplanar = (tex, p, n, s) => {
  const w = n.abs().pow(float(4));
  const ws = w.div(w.x.add(w.y).add(w.z));
  return texture(tex, p.zy.mul(s)).rgb.mul(ws.x)
    .add(texture(tex, p.xz.mul(s)).rgb.mul(ws.y))
    .add(texture(tex, p.xy.mul(s)).rgb.mul(ws.z));
};

const buildGrid = ({ x0, x1, z0, z1, step }, opts = {}) => {
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), wear = new Float32Array(nx * nz), lip = new Float32Array(nx * nz);
  let p = 0, q = 0;
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      let y = heightAt(x, z);
      if (opts.blur) { const s = step * 0.5; y = (2 * y + heightAt(x - s, z) + heightAt(x + s, z) + heightAt(x, z - s) + heightAt(x, z + s)) / 6; }
      if (opts.hole) {                    // far tile: sink under the near tile so the two never fight
        const h = opts.hole, m = step * 1.2;
        if (x > h.x0 + m && x < h.x1 - m && z > h.z0 + m && z < h.z1 - m) y -= 6;
      }
      if (opts.coast && (z < opts.hole.z0 + 2 || z > opts.hole.z1 - 2)) {   // the coast strip draws the far cliffs
        const d = x - coastX(z);
        if (d > -75 && d < 55) y -= 7;
      }
      if (opts.skirt && (i === 0 || j === 0 || i === nx - 1 || j === nz - 1)) y -= 5;
      pos[p++] = x; pos[p++] = y; pos[p++] = z;
      lip[q] = opts.wear ? 1 - smooth(-0.6, 1.5, x - coastX(z)) : 0;
      wear[q++] = opts.wear ? 1 - smooth(0.3, 1.45, pathDist(x, z)) : 0;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('wear', new THREE.BufferAttribute(wear, 1));
  g.setAttribute('lip', new THREE.BufferAttribute(lip, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
};

// The far tile's cells are wider than a cliff face, so the distant coast gets its own strip: columns at fixed
// distances from the cliff edge, dense across the face, a row every few metres along the shore.
const COAST_D = [-60, -30, -16, -11, -8.5, -7.6, -6.6, -5.6, -4.6, -3.6, -2.6, -1.7, -0.9, -0.3, 0, 0.8, 2, 4, 9, 20, 40, 70];
const buildCoast = (zFrom, zTo, stepZ) => {
  const nx = COAST_D.length, nz = Math.round((zTo - zFrom) / stepZ) + 1;
  const pos = new Float32Array(nx * nz * 3);
  let p = 0;
  for (let j = 0; j < nz; j++) {
    const z = zFrom + j * stepZ, cx = coastX(z);
    for (let i = 0; i < nx; i++) {
      const x = cx + COAST_D[i];
      pos[p++] = x; pos[p++] = heightAt(x, z) - (i === nx - 1 ? 1.5 : 0); pos[p++] = z;   // the inland edge tucks under the far tile
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('wear', new THREE.BufferAttribute(new Float32Array(nx * nz), 1));
  const lip = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) lip[j * nx + i] = 1 - smooth(-0.6, 1.5, COAST_D[i]);
  g.setAttribute('lip', new THREE.BufferAttribute(lip, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
};

export const sunFlat = uniform(new THREE.Vector3(-1, 0, 0)); // horizontal direction to the sun

export function createTerrain(tex) {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const p = positionWorld, n = normalWorld;

  // turf: two scales of the photo so the tile never reads, tinted by the shared turf colour
  const gA = texture(tex.ground.c, p.xz.mul(0.21)).rgb;
  const gB = texture(tex.ground.c, p.xz.mul(0.031).add(0.37)).rgb;
  const gD = texture(tex.ground.c, p.xz.mul(0.83).add(0.11)).rgb;   // close-up grain
  const turf = gA.mul(0.42).add(gB.mul(0.3)).add(gD.mul(0.28)).mul(2.9).mul(turfTint(p));

  // worn earth beside the stones
  const dirt = vec3(0.105, 0.082, 0.058).mul(gA.g.mul(4.0).add(0.45));
  const wear = attribute('wear', 'float');
  const ground = mix(turf, dirt, smoothstep(0.25, 0.85, wear.add(mx_noise_float(vec3(p.x.mul(0.9), p.z.mul(0.9), 1.0)).mul(0.22))));

  // cliff rock: triplanar photo, sediment bands, a wet dark foot
  const rockA = triplanar(tex.rock.c, p, n, 0.115);
  const rockB = triplanar(tex.rockmoss.c, p, n, 0.07);
  const bands = mx_noise_float(vec3(p.x.mul(0.035), p.y.mul(1.55), p.z.mul(0.035))).mul(0.5).add(0.5);
  const mossy = smoothstep(0.35, 0.8, mx_noise_float(vec3(p.x.mul(0.07), p.y.mul(0.11), p.z.mul(0.07))).mul(0.5).add(0.5))
    .mul(smoothstep(4.0, 10.0, p.y));
  let rock = mix(rockA.mul(1.0), rockB.mul(0.7), mossy.mul(0.55)).mul(bands.mul(0.55).add(0.68));
  // what reads from far off: gullies down the face and thick beds across it
  const gully = mx_noise_float(vec3(p.x.mul(0.045), p.y.mul(0.012), p.z.mul(0.045))).mul(0.5).add(0.5);
  const beds = mx_noise_float(vec3(p.x.mul(0.006), p.y.mul(0.33), p.z.mul(0.006))).mul(0.5).add(0.5);
  rock = rock.mul(gully.mul(0.6).add(0.5)).mul(beds.mul(0.5).add(0.62));
  rock = rock.mul(vec3(0.74, 0.66, 0.6));
  const wet = smoothstep(0.2, 3.2, p.y);
  rock = rock.mul(mix(0.34, 1.0, wet));

  const slope = n.y.oneMinus();
  const breakup = mx_noise_float(vec3(p.x.mul(0.45), p.y.mul(0.45), p.z.mul(0.45))).mul(0.07);
  // bare rock shows on steep ground, below the tide line, and along the broken lip of the cliff
  const lipRock = smoothstep(0.3, 0.62, attribute('lip', 'float').add(mx_noise_float(vec3(p.x.mul(0.6), 0.0, p.z.mul(0.6))).mul(0.3)));
  const rockMask = smoothstep(0.14, 0.3, slope.add(breakup)).max(smoothstep(1.2, 2.6, p.y).oneMinus()).max(lipRock);

  // sunlight dies quickly under water: without this the lit seabed glows teal through the shallows
  const drowned = smoothstep(-3.0, 0.4, p.y).mul(0.94).add(0.06);
  mat.colorNode = mix(ground, rock, rockMask).mul(drowned);
  // Turf is a field of upright blades: at a low sun it takes the light like a surface leaning into it.
  // rock relief: the photo's normal map on three axes, added to the surface normal
  const nw = n.abs().pow(float(4)), nws = nw.div(nw.x.add(nw.y).add(nw.z));
  const bump = (s, k) => {
    const dx = texture(tex.rock.n, p.zy.mul(s)).xy.mul(2).sub(1), dy = texture(tex.rock.n, p.xz.mul(s)).xy.mul(2).sub(1), dz = texture(tex.rock.n, p.xy.mul(s)).xy.mul(2).sub(1);
    return vec3(0, dx.y, dx.x).mul(nws.x).add(vec3(dy.x, 0, dy.y).mul(nws.y)).add(vec3(dz.x, dz.y, 0).mul(nws.z)).mul(k);
  };
  const relief = bump(0.115, 1.3).add(bump(0.031, 0.9));
  mat.normalNode = transformNormalToView(n.add(sunFlat.mul(rockMask.oneMinus().mul(0.75))).add(relief.mul(rockMask)).normalize());
  mat.roughnessNode = mix(float(0.96), mix(float(0.42), float(0.86), wet), rockMask);

  const near = new THREE.Mesh(buildGrid(NEAR, { wear: true, skirt: true }), mat);
  near.receiveShadow = true; near.castShadow = true;
  near.name = 'terrain-near';
  const far = new THREE.Mesh(buildGrid(FAR, { hole: NEAR, blur: true, coast: true }), mat);
  far.receiveShadow = false; far.castShadow = false;
  far.name = 'terrain-far';
  const group = new THREE.Group();
  group.add(near, far);
  for (const [a, b] of [[FAR.z0, NEAR.z0 + 3], [NEAR.z1 - 3, FAR.z1]]) {
    const strip = new THREE.Mesh(buildCoast(a, b, 4), mat);
    strip.name = 'terrain-coast'; group.add(strip);
  }
  return { group, near, far, material: mat };
}

/** True where a walker may stand: inland of the cliff lip, on gentle ground. */
export const walkable = (x, z) => x - coastX(z) > 1.4;
