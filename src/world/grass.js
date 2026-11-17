// Coastal grass: a painted card atlas (no photo cut-outs needed) and tiles of card grass over the headland.
import * as THREE from 'three/webgpu';
import {
  createCardGrassMaterial, createCardGeometry, placeGrass, createGrassTile, writeGrassTile, updateGrassView, noise2,
} from '../vendor/card-grass.tsl.js';
import { heightAt, coastX, pathDist, pathSamples, COMPOUND } from './layout.js';
import { turfTint, sunFlat } from './terrain.js';
import { transformNormalToView, vec3 } from 'three/tsl';
import { rng, smooth, lerp } from './noise.js';

// Atlas cells: 0-7 green tussocks, 8-12 dry straw, 13 white campion, 14 pink thrift, 15 tall seed plumes.
const CELL = 512, GRID = 4;

const blade = (ctx, x0, y0, h, lean, w, c0, c1) => {
  const tx = x0 + lean * h, ty = y0 - h;
  const mx = x0 + lean * h * 0.28, my = y0 - h * 0.62;
  const g = ctx.createLinearGradient(x0, y0, tx, ty);
  g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0 - w, y0);
  ctx.quadraticCurveTo(mx - w * 0.7, my, tx, ty);
  ctx.quadraticCurveTo(mx + w * 0.7, my, x0 + w, y0);
  ctx.closePath(); ctx.fill();
};

const rgb = (r, g, b, j, R) => {
  const k = 1 + (R() - 0.5) * j;
  return `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;
};

function paintAtlas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = CELL * GRID;
  const ctx = cv.getContext('2d');
  for (let cell = 0; cell < 16; cell++) {
    const R = rng(1000 + cell * 97);
    const ox = (cell % GRID) * CELL, oy = Math.floor(cell / GRID) * CELL;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox + 3, oy + 3, CELL - 6, CELL - 6); ctx.clip();
    const cx = ox + CELL / 2, base = oy + CELL - 4;
    const dry = cell >= 8 && cell <= 12, plume = cell === 15, flower = cell === 13 || cell === 14;
    const n = plume ? 46 : 80 + ((R() * 50) | 0);
    const spread = plume ? 70 : 105 + R() * 45;
    const tall = plume ? 470 : dry ? 300 + R() * 150 : 250 + R() * 190;
    const tips = [];
    for (let i = 0; i < n; i++) {
      const a = R() * 2 - 1;
      const x0 = cx + a * spread * (0.35 + 0.65 * R());
      const h = tall * (0.45 + 0.55 * R()) * (1 - 0.3 * Math.abs(a));
      const lean = a * 0.42 + (R() - 0.5) * 0.3;
      const w = 2.6 + R() * 3.6;
      const isDry = dry || plume || R() < 0.18;
      const c0 = isDry ? rgb(104, 88, 46, 0.3, R) : rgb(46, 70, 26, 0.35, R);
      const c1 = isDry ? rgb(226, 200, 128, 0.22, R) : rgb(150, 172, 74, 0.28, R);
      blade(ctx, x0, base, h, lean, w, c0, c1);
      tips.push([x0 + lean * h, base - h, isDry]);
    }
    if (dry || plume) {                                   // seed heads
      for (const [x, y] of tips) {
        if (R() > (plume ? 0.75 : 0.35)) continue;
        ctx.fillStyle = rgb(214, 186, 122, 0.2, R);
        const len = plume ? 46 + R() * 34 : 16 + R() * 14;
        for (let k = 0; k < len; k += 3.2) {
          const wob = Math.sin(k * 0.6) * 1.5;
          ctx.beginPath(); ctx.ellipse(x + wob, y + k, plume ? 4.6 - k * 0.04 : 2.6, 3.2, 0, 0, 7); ctx.fill();
        }
      }
    }
    if (flower) {
      const pink = cell === 14;
      for (let i = 0; i < (pink ? 16 : 22); i++) {
        const a = R() * 2 - 1;
        const x0 = cx + a * spread * 0.8, h = 250 + R() * 190, lean = a * 0.3 + (R() - 0.5) * 0.2;
        blade(ctx, x0, base, h, lean, 1.9, 'rgb(58,80,34)', 'rgb(120,140,70)');
        const x = x0 + lean * h, y = base - h;
        const pet = pink ? 9 : 6, rad = pink ? 12 : 9;
        for (let k = 0; k < pet; k++) {
          const t = (k / pet) * Math.PI * 2 + R();
          ctx.fillStyle = pink ? rgb(226, 150, 176, 0.14, R) : rgb(246, 244, 232, 0.08, R);
          ctx.beginPath(); ctx.ellipse(x + Math.cos(t) * rad * 0.55, y + Math.sin(t) * rad * 0.5, rad * 0.55, rad * 0.5, t, 0, 7); ctx.fill();
        }
        ctx.fillStyle = pink ? 'rgb(190,110,140)' : 'rgb(214,196,120)';
        ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  return t;
}

// distance to the path beyond the 6 m the layout query answers
const coarse = pathSamples.filter((_, i) => i % 10 === 0);
const farPathDist = (x, z) => {
  let b = 1e9;
  for (let i = 0; i < coarse.length; i++) { const dx = coarse[i][0] - x, dz = coarse[i][1] - z, d = dx * dx + dz * dz; if (d < b) b = d; }
  return Math.sqrt(b);
};

const FADE = [82, 112];   // metres from the camera where cards start to sink / are gone

/** @param {(x:number,z:number)=>boolean} blocked footprint test for buildings, walls and rocks */
export function createGrass(scene, blocked) {
  const atlas = paintAtlas();
  const material = createCardGrassMaterial({
    atlas, fade: [FADE[0], FADE[1]], sink: 2.2, gain: 0.9, rootShade: 0.62, clumpJitter: 0.3,
    tintAt: (p) => turfTint(p), tintAmount: 0.42,
    wind: { amount: 0.085, speed: 1.35, ripple: 0.4, rippleSpeed: 2.9, side: 0.4 },
  });
  material.normalNode = transformNormalToView(vec3(0, 1, 0).add(sunFlat.mul(0.85)).normalize());
  // skylight: cards in shade keep the colour of the turf around them instead of going black
  material.emissiveNode = material.colorNode.rgb.mul(vec3(0.13, 0.15, 0.19));
  const geometry = createCardGeometry();
  const TILE = 36, SPACING = 0.315;
  const tiles = [];
  let total = 0;

  const accept = (x, y, z) => {
    const d = x - coastX(z);
    if (d < 0.75 || y < 3) return false;
    const pd = pathDist(x, z);
    if (pd < 0.78) return false;
    if (blocked(x, z)) return false;
    const e = 0.7;                                       // no cards on steep ground
    if (Math.abs(heightAt(x + e, z) - heightAt(x - e, z)) > 0.62 || Math.abs(heightAt(x, z + e) - heightAt(x, z - e)) > 0.62) return false;
    if (pd >= 6) {                                       // thin with distance from the walk
      const keep = lerp(1, 0.26, smooth(18, 70, farPathDist(x, z)));
      if (noise2(x * 7.3, z * 7.3, 0.6, 77) * 0.5 + 0.5 > keep) return false;
    }
    return true;
  };
  const scale = (x, y, z, r) => {
    const pd = pathDist(x, z);
    const edge = smooth(0.78, 2.2, pd);                   // short beside the stones, taller away from them
    const yard = 1 - 0.45 * (1 - smooth(COMPOUND.flat - 4, COMPOUND.flat + 6, Math.hypot(x - COMPOUND.x, z - COMPOUND.z)));
    const far = pd >= 6 ? smooth(18, 70, farPathDist(x, z)) : 0;
    return (0.14 + r * 0.46) * lerp(0.55, 1, edge) * yard + far * 0.22;
  };
  const pickCard = (x, y, z, s, h) => {
    const dryShare = 0.2 + 0.24 * noise2(x, z, 30, 5);
    const r = (h * 977) % 1;
    if (s > 0.2 && r < 0.034) return 13;
    if (s > 0.2 && r < 0.05) return 14;
    if (r > 0.972) return 15;
    return h < dryShare ? 8 + ((h * 131) | 0) % 5 : ((h * 173) | 0) % 8;
  };

  for (let tz = -236; tz < 100; tz += TILE) for (let tx = -44; tx < 104; tx += TILE) {
    const placements = placeGrass({
      originX: tx, originZ: tz, size: TILE, spacing: SPACING, seed: 3, heightAt, accept, scale,
      density: { base: 0.86, a: 0.2, scaleA: 30, b: 0.2, scaleB: 7, min: 0.5, max: 1 },
    });
    const count = placements.length / 4;
    if (!count) continue;
    const mesh = createGrassTile(geometry, material, count);
    writeGrassTile(mesh, placements, { x: tx, z: tz }, pickCard, { height: { base: 0.3, perScale: 1.05, min: 0.3, max: 1.05 }, lean: 0.36 });
    mesh.frustumCulled = true;
    scene.add(mesh); tiles.push(mesh); total += count;
  }

  // tiles wholly past the fade ring are not drawn at all
  const update = (camera) => {
    updateGrassView(material, camera);
    const cx = camera.position.x, cz = camera.position.z;
    for (const t of tiles) {
      const dx = Math.max(t.position.x - cx, 0, cx - t.position.x - TILE), dz = Math.max(t.position.z - cz, 0, cz - t.position.z - TILE);
      t.visible = dx * dx + dz * dz < (FADE[1] + 2) ** 2;
    }
  };
  return { material, tiles, total, update };
}
