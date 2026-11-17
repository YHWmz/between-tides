// 2D colliders (circles and wall segments) on a hash grid. The walker and the grass placement both ask it.
const CELL = 4;
const key = (cx, cz) => cx * 8192 + cz;

export class Colliders {
  constructor() { this.grid = new Map(); this.items = []; }

  _insert(it, x0, z0, x1, z1) {
    this.items.push(it);
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = key(cx, cz);
        let a = this.grid.get(k); if (!a) this.grid.set(k, a = []);
        a.push(it);
      }
    }
    return it;
  }

  /** @returns the collider; set `.on = false` to switch it off (an opened gate). */
  circle(x, z, r, grassPad = 0) {
    return this._insert({ kind: 0, x, z, r, on: true, pad: grassPad }, x - r - 1, z - r - 1, x + r + 1, z + r + 1);
  }

  segment(ax, az, bx, bz, half = 0.12, grassPad = 0.25, sweepRadius = 0) {
    const m = half + 1;
    return this._insert({ kind: 1, ax, az, bx, bz, r: half, on: true, pad: grassPad },
      Math.min(ax - sweepRadius, bx) - m, Math.min(az - sweepRadius, bz) - m,
      Math.max(ax + sweepRadius, bx) + m, Math.max(az + sweepRadius, bz) + m);
  }

  box(cx, cz, w, d, yaw = 0, half = 0.1, grassPad = 0.2) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
    for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; this.segment(a[0], a[1], b[0], b[1], half, grassPad); }
    this.fills = this.fills || [];
    this.fills.push({ cx, cz, w, d, c, s });
  }

  /** Push a circle of radius r at (p.x, p.z) out of everything it touches. Mutates p. */
  resolve(p, r) {
    for (let pass = 0; pass < 2; pass++) {
      const a = this.grid.get(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
      if (!a) return;
      for (let i = 0; i < a.length; i++) {
        const it = a[i];
        if (!it.on) continue;
        let nx, nz;
        if (it.kind === 0) { nx = it.x; nz = it.z; } else {
          const ex = it.bx - it.ax, ez = it.bz - it.az;
          const t = Math.min(1, Math.max(0, ((p.x - it.ax) * ex + (p.z - it.az) * ez) / (ex * ex + ez * ez || 1)));
          nx = it.ax + ex * t; nz = it.az + ez * t;
        }
        const dx = p.x - nx, dz = p.z - nz, d = Math.hypot(dx, dz), min = r + it.r;
        if (d < min && d > 1e-5) { const k = (min - d) / d; p.x += dx * k; p.z += dz * k; }
      }
    }
  }

  /** True where grass should not grow: under walls, rocks and buildings. */
  covers(x, z) {
    if (this.fills) for (const f of this.fills) {
      const dx = x - f.cx, dz = z - f.cz;
      const lx = dx * f.c - dz * f.s, lz = dx * f.s + dz * f.c;
      if (Math.abs(lx) < f.w / 2 + 0.15 && Math.abs(lz) < f.d / 2 + 0.15) return true;
    }
    const a = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!a) return false;
    for (let i = 0; i < a.length; i++) {
      const it = a[i];
      let nx, nz;
      if (it.kind === 0) { nx = it.x; nz = it.z; } else {
        const ex = it.bx - it.ax, ez = it.bz - it.az;
        const t = Math.min(1, Math.max(0, ((x - it.ax) * ex + (z - it.az) * ez) / (ex * ex + ez * ez || 1)));
        nx = it.ax + ex * t; nz = it.az + ez * t;
      }
      if (Math.hypot(x - nx, z - nz) < it.r + it.pad) return true;
    }
    return false;
  }
}
