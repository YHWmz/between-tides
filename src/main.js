import * as THREE from 'three/webgpu';
import './ui/ui.css';
import { loadTextures } from './world/assets.js';
import { createTerrain, sunFlat } from './world/terrain.js';
import { createAtmosphere, SEA_LAYER } from './world/atmosphere.js';
import { createGrass } from './world/grass.js';
import { createProps } from './world/props.js';
import { createStructures } from './world/structures.js';
import { Colliders } from './world/colliders.js';
import { heightAt, START, coastX, pathAt } from './world/layout.js';
import { createPlayer, BASE_FOV } from './game/player.js';
import { createAudio } from './game/audio.js';
import { createGame } from './game/game.js';
import { createUI } from './ui/ui.js';

const canvas = document.getElementById('view');
const ui = createUI(document.getElementById('ui'));

async function boot() {
  if (!navigator.gpu) {
    ui.fail('这个演示需要 WebGPU。<br>请用新版 Chrome 或 Edge 打开。');
    return;
  }
  window.__boot = 'renderer';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  const RATIO_CAP = Math.min(window.devicePixelRatio, 1.5);
  let ratio = Math.min(window.devicePixelRatio, 1.25), ratioCeil = RATIO_CAP;
  renderer.setPixelRatio(ratio);
  // A minimised or hidden window reports 0 x 0, which WebGPU cannot make a canvas for: keep the last good size.
  const size = { w: Math.max(window.innerWidth, 320), h: Math.max(window.innerHeight, 180) };
  renderer.setSize(size.w, size.h, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(BASE_FOV, size.w / size.h, 0.08, 2600);
  camera.position.set(START.x, heightAt(START.x, START.z) + 1.6, START.z);

  window.__boot = 'textures';
  const tex = await loadTextures(renderer);
  window.__boot = 'terrain';
  const terrain = createTerrain(tex);
  // the sea mirrors the sky and the far coast; the ground you stand on is never seen in it and costs the most
  terrain.group.traverse((o) => { if (o !== terrain.near) o.layers.enable(SEA_LAYER); });
  scene.add(terrain.group);

  window.__boot = 'atmosphere';
  const atmo = await createAtmosphere(renderer, scene, camera);
  sunFlat.value.copy(atmo.sunFlat);

  window.__boot = 'props';
  const colliders = new Colliders();
  const structures = createStructures(scene, tex, colliders);
  const props = createProps(scene, tex, colliders);
  window.__boot = 'grass';
  const grass = createGrass(scene, (x, z) => colliders.covers(x, z));

  window.__boot = 'game';
  const audio = createAudio();
  const player = createPlayer(camera, canvas, colliders, audio, structures.lighthouse.zone);
  const game = createGame({ camera, player, ui, audio, props, structures, renderer, canvas });
  { const s = pathAt(0.03); player.teleport(s.x, s.z, START.yaw, -0.03); }   // the opening frame: sun, fence, path, tower

  window.addEventListener('resize', () => {
    if (window.innerWidth < 2 || window.innerHeight < 2) return;
    size.w = window.innerWidth; size.h = window.innerHeight;
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
  });

  // Pointer lock is the play/pause switch: click to walk, Esc to stop.
  let playing = false, started = false, forced = false;
  const setPlaying = (on) => {
    playing = on;
    ui.veil(!on); ui.hud(on && game.state.mode === 'walk');
    if (on) { audio.start(); if (!started) { started = true; game.begin(); } } else { audio.suspend(); if (started) ui.paused(); }
  };
  document.addEventListener('pointerlockchange', () => { if (!forced) setPlaying(document.pointerLockElement === canvas); });

  const timer = new THREE.Timer();
  let t = 0;
  const frame = (dt) => {
    t += dt;
    if (playing) {
      const opts = game.update(dt);
      player.update(dt, opts);
      audio.update(t, 1 - Math.min(1, Math.max(0, (player.pos.x - coastX(player.pos.z) - 3) / 40)));
    }
    if (props.gate.moving || structures.cottage.moving || structures.lighthouse.moving) atmo.sun.shadow.needsUpdate = true;
    atmo.update(dt);
    grass.update(camera);
    atmo.renderMirror();
    renderer.render(scene, camera);
    if (playing) game.afterRender();
    player.input.endFrame();
  };
  // Resolution follows the frame rate: drop it when frames run long, creep back up when there is room.
  const fpsEl = document.createElement('div');
  fpsEl.style.cssText = 'position:absolute;right:14px;top:12px;font:12px/1.4 ui-monospace,Menlo,monospace;color:#f3ece0;text-shadow:0 1px 4px #000;display:none;text-align:right;white-space:pre';
  document.getElementById('ui').append(fpsEl);
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyP') fpsEl.style.display = fpsEl.style.display === 'none' ? 'block' : 'none'; });
  let ema = 1 / 60, slowT = 0, fastT = 0, sinceRaise = 99, hudT = 0;
  const pace = (raw) => {
    if (!playing || raw > 0.25) return;                  // paused, or the tab was in the background
    ema += (raw - ema) * 0.06; sinceRaise += raw;
    slowT = ema > 1 / 48 ? slowT + raw : 0;
    fastT = ema < 1 / 57 ? fastT + raw : 0;
    if (slowT > 1.2 && ratio > 0.7) {
      if (sinceRaise < 8) ratioCeil = Math.max(0.7, ratio * 0.9);   // the last step up was too much: do not try it again
      ratio = Math.max(0.7, ratio * 0.85); renderer.setPixelRatio(ratio); slowT = fastT = 0; ema = 1 / 55;
    } else if (fastT > 5 && ratio < ratioCeil - 0.01) {
      ratio = Math.min(ratioCeil, ratio * 1.12); renderer.setPixelRatio(ratio); slowT = fastT = 0; sinceRaise = 0;
    }
    if ((hudT += raw) > 0.4 && fpsEl.style.display !== 'none') {
      hudT = 0;
      fpsEl.textContent = `${Math.round(1 / ema)} fps\n${Math.round(size.w * ratio)} x ${Math.round(size.h * ratio)}  (x${ratio.toFixed(2)})`;
    }
  };
  renderer.setAnimationLoop(() => { timer.update(); const raw = timer.getDelta(); pace(raw); frame(Math.min(raw, 0.05)); });

  window.__boot = 'ready';
  ui.ready();

  // Hooks for automated checks: drive the game without pointer lock.
  window.__game = {
    renderer, scene, camera, atmo, grass, terrain, player, game, props, structures, heightAt, pathAt,
    play(on = true) { forced = true; setPlaying(on); },
    goto(tFrac, side = 0, yaw = null, pitch = 0) { const p = pathAt(tFrac); player.teleport(p.x - p.tz * side, p.z + p.tx * side, yaw ?? Math.atan2(-p.tx, -p.tz), pitch); },
    use(id) { game.things.find((x) => x.id === id)?.use(); },
    /** Run the simulation forward without waiting for frames (a hidden tab throttles them). */
    advance(seconds, step = 1 / 30) {
      for (let s = 0; s < seconds; s += step) { t += step; player.update(step, game.update(step)); atmo.update(step); player.input.endFrame(); }
      frame(0);
    },
    frame,
  };
  window.__view = (x, z, yaw, pitch = 0) => player.teleport(x, z, yaw, pitch);
}

boot().catch((e) => { console.error(e); ui.fail(`启动失败：${String(e?.message || e)}`); });
