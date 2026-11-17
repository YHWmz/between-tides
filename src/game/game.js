// What the walk is about: things to read, a gate to push, a lamp to light, a view to frame.
import * as THREE from 'three/webgpu';
import { BASE_FOV } from './player.js';
import { pathAt, GATE, coastX } from '../world/layout.js';

const NOTES = {
  bench: { style: 'brass', title: '长椅背上的铜牌', body: '给每一个\n在这里等过船的人', sign: '望潮角 · 一九七四' },
  stone: { style: 'stone', title: '界石', body: '望潮角灯塔\n由此向北 三百步\n\n雾天勿近崖边' },
  letter: { style: '', title: '信箱里的字条', body: '致后来的人：\n灯改成自动的那年，我就该走了。如今连自动也停了。\n配电盒的钥匙，我留在这只信箱里。\n若你走到塔下，天又快黑了，就替我把灯点上吧。', sign: '末任值守　林' },
  log: { style: '', title: '值守日志 · 最后一页', body: '十一月三日　晴转多云　西风四级\n能见度良好。无船只呼叫。\n灯器运转正常。\n\n明日交接。此后无人值守。' },
  door: { style: 'stone', title: '灯塔的门', body: '门锁着，锁孔里结了盐。\n\n门边有一只铁盒，一根线管沿着墙一直通到塔顶。' },
  lens: { style: 'brass', title: '灯器铭牌', body: '四等透镜\n一九三一年装', sign: '玻璃擦得很干净。抹布叠好了，留在窗台上。' },
  tide: { style: '', title: '钉在墙上的潮汐表', body: '望潮角　十一月\n三日　高潮 05:12　17:40\n四日　高潮 05:58　18:21\n\n四日那一行被铅笔圈了起来，旁边写着：\n“船 18:00 到。”' },
};

export function createGame({ camera, player, ui, audio, props, structures, renderer, canvas }) {
  const state = { key: false, gateOpen: false, lit: false, read: new Set(), photos: 0, mode: 'walk', fov: BASE_FOV };
  const input = player.input;
  let openNote = null, capture = false, hinted = { gate: false, yard: false, sea: false, gallery: false };
  const lh = structures.lighthouse, ct = structures.cottage;

  const read = (id) => {
    openNote = NOTES[id]; state.read.add(id); state.mode = 'read';
    ui.note(openNote); ui.hud(false); audio.paper();
  };

  const pushGate = () => {
    if (state.gateOpen) return;
    state.gateOpen = true;
    props.gate.open(player.pos);
    audio.gate();
    ui.objective('灯塔就在前面');
  };
  const setLamp = (on) => {
    state.lit = on;
    lh.setLit(on);
    audio.latch();
    if (on) audio.lamp();
    if (!state.ended) litAt = on ? clock : -1;
  };
  const things = [
    { id: 'bench', pos: structures.bench.pos, range: 2.6, label: () => '查看长椅', use: () => read('bench') },
    { id: 'stone', pos: structures.milestone.pos, range: 2.4, label: () => '查看界石', use: () => read('stone') },
    { id: 'mailbox', pos: structures.mailbox.pos, range: 2.3, label: () => (state.key ? '再读一遍字条' : '打开信箱'),
      use: () => { read('letter'); if (!state.key) { state.key = true; audio.latch(); pending = () => ui.toast('得到　一把黄铜钥匙'); } } },
    { id: 'gate', pos: props.gate.position, range: 2.5, label: () => (state.gateOpen ? null : '推开栅门'),
      use: pushGate },
    { id: 'cottage', pos: ct.doorPos, range: 2.2, label: () => (ct.doorOpen ? null : '推开屋门'),
      use: () => { ct.openDoor(); audio.latch(); audio.door(); } },
    { id: 'log', indoor: true, pos: ct.logPos, range: 2.0, label: () => '翻看日志', use: () => read('log') },
    { id: 'tide', indoor: true, pos: ct.tidePos, range: 2.2, label: () => '查看潮汐表', use: () => read('tide') },
    { id: 'lamp', indoor: true, pos: ct.lampPos, range: 1.9, label: () => (ct.lampLit ? null : '点亮油灯'), use: () => { ct.lightLamp(); audio.match(); } },
    { id: 'door', pos: lh.doorPos, range: 2.4, label: () => (lh.doorOpen ? null : state.key ? '用钥匙打开塔门' : '查看塔门'),
      use: () => { if (!state.key) { read('door'); return; } lh.openDoor(); audio.latch(); audio.door(); } },
    ...lh.windows.map((window, index) => ({
      id: `window-${index + 1}`, window, pos: window.pos, range: 2.1,
      label: () => window.opened ? '关上窗户' : '推开窗户',
      use: () => { window.toggle(); audio.door(); },
    })),
    { id: 'lens', tower: true, pos: lh.lensPos, range: 2.2, label: () => '查看灯器', use: () => read('lens') },
    { id: 'top-switch', tower: true, pos: lh.topSwitchPos, range: 1.7,
      label: () => state.lit ? '关掉灯塔' : '点亮灯塔',
      use: () => setLamp(!state.lit) },
    { id: 'switch', pos: lh.switchPos, range: 2.3, label: () => (state.lit ? null : state.key ? '打开配电盒，合上电闸' : '查看配电盒'),
      use: () => {
        if (!state.key) { audio.locked(); ui.toast('铁盒上着一把小锁。钥匙也许留在来路上。', 5); ui.objective('找到配电盒的钥匙', 9); return; }
        setLamp(true);
      } },
  ];
  let pending = null, litAt = -1, clock = 0, focused = null, litE = 0, indoors = 0;
  const dir = new THREE.Vector3(), to = new THREE.Vector3();

  const pickFocus = () => {
    camera.getWorldDirection(dir);
    let best = null, bestScore = 0.9;                        // within about 25 degrees of the view centre
    for (const t of things) {
      if (!t.label()) continue;
      if (t.indoor && !ct.inside(player.pos.x, player.pos.z)) continue;   // not through the wall
      if (t.window) {
        if (!lh.zone.inside || Math.abs(lh.zone.theta - t.window.theta) > 1.15) continue;
      } else if (t.tower ? !lh.zone.atTop : lh.zone.inside && t.id !== 'door') continue;
      to.copy(t.pos).sub(camera.position);
      const d = to.length();
      if (d > t.range) continue;
      // right up against a thing its centre slides off the reticle: be more forgiving the closer it is
      const score = to.multiplyScalar(1 / d).dot(dir) - d * 0.012 + Math.max(0, 1.1 - d) * 0.25;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  };

  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0 && state.mode === 'photo' && document.pointerLockElement === canvas) capture = true; });

  const gatePos = pathAt(GATE.t);

  return {
    state, things,
    begin() { ui.objective('沿着石径，走向灯塔', 9); },
    /** @returns movement options for the player this frame */
    update(dt) {
      clock += dt;
      // E: use, or put a note away
      if (input.wasPressed('interact')) {
        if (state.mode === 'read') { openNote = null; state.mode = 'walk'; ui.note(null); ui.hud(true); if (pending) { pending(); pending = null; } }
        else if (state.mode === 'walk' && focused) focused.use();
      }
      // F: the viewfinder
      if (input.wasPressed('secondary') && state.mode !== 'read') {
        state.mode = state.mode === 'photo' ? 'walk' : 'photo';
        if (state.mode === 'walk') state.fov = BASE_FOV;
        ui.hud(state.mode === 'walk'); ui.photo(state.mode === 'photo', state.fov);
      }
      if (state.mode === 'photo') {
        const w = input.consumeWheel();
        if (w) { state.fov = Math.min(BASE_FOV, Math.max(16, state.fov * (1 + w * 0.09))); ui.photo(true, state.fov); }
      }
      const cur = camera.fov + (state.fov - camera.fov) * (1 - Math.exp(-dt * 10));
      player.setZoom(Math.abs(cur - state.fov) < 0.02 ? state.fov : cur);

      focused = state.mode === 'walk' ? pickFocus() : null;
      if (state.mode === 'walk') ui.focus(focused ? focused.label() : null);

      if (state.mode === 'walk' && !state.gateOpen && input.getMove().z < 0
        && props.gate.canPush(player.pos, dir)) pushGate();

      // quiet nudges, once each
      const p = player.pos;
      if (!hinted.gate && !state.gateOpen && Math.hypot(p.x - gatePos.x, p.z - gatePos.z) < 7) { hinted.gate = true; ui.objective('一道栅门拦在石墙之间', 7); }
      if (!hinted.yard && state.gateOpen && Math.hypot(p.x - lh.doorPos.x, p.z - lh.doorPos.z) < 14) { hinted.yard = true; ui.objective(state.key ? '塔下有一只配电盒' : '看看塔脚下有什么', 8); }
      if (!hinted.sea && p.x - coastX(p.z) < 7 && clock > 20) { hinted.sea = true; ui.toast('按 F 举起取景框', 6); }

      // after the lamp: the evening closes in a little and the walk is done
      if (litAt >= 0) {
        const k = Math.min(1, (clock - litAt) / 9), e = k * k * (3 - 2 * k);
        litE = e;
        if (clock - litAt > 3.2 && !state.ended) { state.ended = true; ui.ending(true); setTimeout(() => ui.ending(false), 14000); }
      } else {
        litE *= Math.exp(-dt * 2.2);
      }
      // stepping indoors: the eye opens up, the windows blow out, the wind drops behind the walls
      const within = ct.inside(p.x, p.z);
      const inTower = lh.zone.inside;
      if (lh.zone.atTop && !hinted.gallery) {
        hinted.gallery = true;
        ui.objective('朝海的门洞通往外侧环廊', 6);
      }
      let windowAir = 0, pan = 0;
      if (inTower && !lh.zone.atTop && !lh.zone.onGallery) {
        const yaw = player.look.yaw;
        for (const window of lh.windows) {
          if (!window.openness || Math.abs(lh.zone.theta - window.theta) > 1.85) continue;
          const dx = window.pos.x - p.x, dz = window.pos.z - p.z;
          const d = Math.hypot(dx, window.pos.y - camera.position.y, dz);
          const strength = window.openness * Math.max(0, 1 - d / 3.4) ** 1.5;
          if (strength <= windowAir) continue;
          windowAir = strength;
          pan = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(0.35, Math.hypot(dx, dz));
        }
      }
      audio.setWindowAir(windowAir, pan, clock);
      indoors += (Math.max(within ? 1 : 0, lh.zone.shade) - indoors) * (1 - Math.exp(-dt * 2.2));
      renderer.toneMappingExposure = (0.92 - 0.3 * litE) * (1 + 0.6 * indoors);
      audio.setIndoor(indoors);
      ct.update(dt, clock, indoors);
      props.gate.update(dt);
      lh.update(dt, clock);
      return { canMove: state.mode !== 'read', slow: (state.mode === 'photo' ? 0.55 : 1) * (inTower ? 0.62 : 1), surface: within ? 'wood' : inTower ? 'stone' : null };
    },
    /** Call right after the frame is drawn: a WebGPU canvas can only be read back in the same task. */
    afterRender() {
      if (!capture) return;
      capture = false; state.photos++;
      const n = state.photos;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `潮汐之间-${String(n).padStart(2, '0')}.png`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
      ui.flash(); audio.shutter();
      ui.toast(`第 ${n} 张 · 已存到下载目录`, 3);
    },
  };
}
