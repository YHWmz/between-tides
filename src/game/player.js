// First-person walker over the height field. Input and look come from the character kit scripts;
// the body is a circle on the ground rather than a physics capsule, which is all a footpath needs.
import { createCharacterInput } from '../vendor/character-input.js';
import { createFirstPersonCamera } from '../vendor/character-camera.js';
import { heightAt, pathDist, pathSamples, START, coastX } from '../world/layout.js';

const EYE = 1.62, RADIUS = 0.32, WALK = 3.7, RUN = 6.6, BASE_FOV = 62;

const JUMP_SPEED = 3.35, GRAVITY = 12.5;

const coarse = pathSamples.filter((_, i) => i % 8 === 0);
const corridor = (x, z) => {                       // distance to the path, any range
  let b = 1e9;
  for (let i = 0; i < coarse.length; i++) { const dx = coarse[i][0] - x, dz = coarse[i][1] - z, d = dx * dx + dz * dz; if (d < b) b = d; }
  return Math.sqrt(b);
};

export function createPlayer(camera, canvas, colliders, audio, zone = null) {
  const input = createCharacterInput(canvas);
  input.setLookMode('capture');
  const fp = createFirstPersonCamera({ sensitivity: 0.0021 });
  fp.rotation.yaw = START.yaw;
  let zoom = 1;                                    // photo mode narrows the lens and slows the hand
  const look = fp.bind(input, () => ({ sensitivity: 0.0021 * zoom }));

  const pos = { x: START.x, z: START.z };
  const vel = { x: 0, z: 0 };
  let y = heightAt(pos.x, pos.z), stride = 0, bob = 0, lastStep = 0, speedNow = 0;

  let jumpHeight = 0, jumpSpeed = 0;

  const allowed = (x, z, fromY) => {
    if (zone?.inside) return true;
    if (x - coastX(z) < 1.5) return false;         // the cliff lip
    if (corridor(x, z) > 46) return false;         // the slice ends where the grass thins
    if (z > 62 || z < -172) return false;
    return heightAt(x, z) - fromY < 0.5;           // too steep to step up
  };

  const place = () => {
    camera.position.set(pos.x, y + EYE + jumpHeight + Math.sin(stride * 2) * 0.028 * bob, pos.z);
    camera.position.x += Math.cos(fp.rotation.yaw) * Math.sin(stride) * 0.018 * bob;
    camera.position.z -= Math.sin(fp.rotation.yaw) * Math.sin(stride) * 0.018 * bob;
  };

  return {
    input, pos, look: fp.rotation,
    get speed() { return speedNow; },
    /** Put the walker on the lighthouse stair at a given angle (for checks). */
    climbTo(theta, yaw, pitch = 0) { const [px, pz] = zone.enter(theta); pos.x = px; pos.z = pz; vel.x = vel.z = jumpHeight = jumpSpeed = 0; y = zone.apply(pos); if (yaw != null) { fp.rotation.yaw = yaw; fp.rotation.pitch = pitch; } look(camera); place(); },
    setZoom(fov) { zoom = fov / BASE_FOV; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); } },
    teleport(x, z, yaw, pitch = 0) { zone?.reset(); pos.x = x; pos.z = z; vel.x = vel.z = jumpHeight = jumpSpeed = 0; y = heightAt(x, z); if (yaw != null) { fp.rotation.yaw = yaw; fp.rotation.pitch = pitch; } look(camera); place(); },
    update(dt, { canMove = true, slow = 1, surface = null } = {}) {
      look(camera);
      const m = input.getMove();
      let wx = 0, wz = 0;
      if (canMove && (m.x || m.z)) {
        const s = Math.sin(fp.rotation.yaw), c = Math.cos(fp.rotation.yaw);
        wx = m.x * c + m.z * s; wz = -m.x * s + m.z * c;
        const l = Math.hypot(wx, wz); wx /= l; wz /= l;
      }
      const top = (input.isAction('sprint') ? RUN : WALK) * slow;
      const k = 1 - Math.exp(-dt * (wx || wz ? 7 : 9));
      vel.x += (wx * top - vel.x) * k; vel.z += (wz * top - vel.z) * k;

      const groundY = heightAt(pos.x, pos.z);
      const nx = pos.x + vel.x * dt, nz = pos.z + vel.z * dt;
      if (allowed(nx, nz, groundY)) { pos.x = nx; pos.z = nz; }
      else if (allowed(nx, pos.z, groundY)) { pos.x = nx; vel.z = 0; }
      else if (allowed(pos.x, nz, groundY)) { pos.z = nz; vel.x = 0; }
      else { vel.x = vel.z = 0; }
      if (!zone?.inside) colliders.resolve(pos, RADIUS);

      // a building with floors of its own (the lighthouse stair) answers for the ground while you are in it
      const target = zone?.apply(pos) ?? heightAt(pos.x, pos.z);
      y += (target - y) * (1 - Math.exp(-dt * 14));
      // A press starts one jump. Keep the same wall and cliff limits in the air.
      const grounded = jumpHeight === 0;
      if (grounded && canMove && input.wasPressed('jump')) jumpSpeed = JUMP_SPEED;
      if (jumpSpeed !== 0 || !grounded) {
        jumpHeight += (jumpSpeed - GRAVITY * dt * 0.5) * dt;
        jumpSpeed -= GRAVITY * dt;
        if (jumpHeight <= 0 && jumpSpeed < 0) {
          jumpHeight = jumpSpeed = 0;
          audio?.step(surface ?? (pathDist(pos.x, pos.z) < 0.95 ? 'stone' : 'grass'), 0.45);
        }
      }
      speedNow = Math.hypot(vel.x, vel.z);
      bob += ((jumpHeight === 0 && speedNow > 0.4 ? Math.min(1, speedNow / WALK) : 0) - bob) * (1 - Math.exp(-dt * 8));
      stride += speedNow * dt * 1.5;
      if (jumpHeight === 0 && speedNow > 0.5 && stride - lastStep > Math.PI) {
        lastStep = stride;
        audio?.step(surface ?? (pathDist(pos.x, pos.z) < 0.95 ? 'stone' : 'grass'), speedNow / RUN);
      }
      place();
    },
  };
}

export { BASE_FOV };
