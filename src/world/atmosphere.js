// Sky dome, sun, fog, environment light and the sea: the golden-hour atmosphere.
import * as THREE from 'three/webgpu';
import { createPhotoSky } from '../vendor/photo-sky.tsl.js';
import { Ocean } from '../vendor/ocean.tsl.js';
import { heightAt, SEA_LEVEL } from './layout.js';

export const SEA_LAYER = 4;                  // what the sea mirror is allowed to see
export const EXPOSURE = 0.92;
const FOG_FAR = 1650;

const SUN_AZIMUTH = Math.atan2(-0.74, -0.67); // over the sea, ahead and to the left of the walk
const dirFrom = (elevDeg) => {
  const e = (elevDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(SUN_AZIMUTH) * Math.cos(e), Math.sin(e), Math.sin(SUN_AZIMUTH) * Math.cos(e)).normalize();
};

export async function createAtmosphere(renderer, scene, camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;

  scene.fog = new THREE.Fog(0x9d95a1, 24, FOG_FAR);

  // The photo's sun sits 1 degree up; the dome can lift it to about 2.2. The key light comes from a little
  // higher so shadows keep some shape, which the eye accepts at this hour.
  const skySun = dirFrom(1.0);
  const lightDir = dirFrom(7.5);

  const sky = createPhotoSky({
    slots: [{ file: 'dusk.webp', sunElev: 0.99, sunClear: 0.8, exp: 1.0 }],
    bands: [[-90, 0]],
    roles: {},
    basePath: `${import.meta.env.BASE_URL}assets/sky/`,
    // decode() can stay pending for ever in a tab that is not being drawn; the image is usable without it
    loadImage: async (url) => {
      const img = await new THREE.ImageLoader().loadAsync(url);
      if (img.decode) await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
      return img;
    },
    radius: 1900,
    knobs: { exposureRef: EXPOSURE, horizonBand: 0.05, horizonHaze: 0.5 },
  });
  sky.mesh.layers.enable(SEA_LAYER);
  scene.add(sky.mesh);
  window.__boot = 'sky.load';
  await sky.load(0);

  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.6, 0.33), 5.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.00055;      // in light-depth units: any more and sun creeps under the cottage walls
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = 2.5;
  sun.shadow.autoUpdate = false;  // the sun stands still: redraw the shadow map only when its box moves or something swings
  sun.shadow.needsUpdate = true;
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 120; sc.far = 420;
  sun.layers.enable(SEA_LAYER);
  scene.add(sun, sun.target);

  // cool skylight from the east fills the shadow side
  const fill = new THREE.HemisphereLight(0x8090b8, 0x40382e, 0.42);
  fill.layers.enable(SEA_LAYER);
  scene.add(fill);

  // a soft bloom around the sun disc: the photo clips it to a hard dot
  const glare = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,244,224,1)'); g.addColorStop(0.05, 'rgba(255,214,160,0.75)'); g.addColorStop(0.2, 'rgba(255,170,110,0.26)');
    g.addColorStop(0.5, 'rgba(255,140,90,0.07)'); g.addColorStop(1, 'rgba(255,120,80,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.scale.setScalar(620); s.renderOrder = 5;
    return s;
  })();
  scene.add(glare);

  const pmrem = new THREE.PMREMGenerator(renderer);
  sky.update({ dt: 0, sunDir: skySun, overcast: 0, rain: 0, bright: 0, aurora: 0, day: 0, exposure: EXPOSURE, camera });
  sky.uniforms.hazeColor.value.copy(scene.fog.color);
  window.__boot = 'sky.bake';
  const envRT = sky.bake(pmrem);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.8;

  const sunFlat = new THREE.Vector3(lightDir.x, 0, lightDir.z).normalize();
  window.__boot = 'ocean';
  const ocean = new Ocean(scene, {
    heightAt, seaLevel: SEA_LEVEL,
    windDir: 0.35, dirSpread: 0.75,            // swell runs onto the cliffs
    fog: { color: scene.fog.color, far: FOG_FAR },
    preset: 'Golden hour',
    params: { amplitude: 0.85, deep: '#0f1a24', shallow: '#2a3947', specular: 2.4, reflectivity: 0.2, shoreFoam: 3.2, crestFoam: 1.2, floatFoam: 0.9, crestThresh: 0.16, rippleStrength: 0.26, refractDistort: 0.03, sss: 0.12, caustics: 0.0, absorb: 0.3, absorbTint: '#a39390' },
  });
  ocean.setReflectionLayers(1 << SEA_LAYER);
  ocean.bakeBedNow(camera.position.x, camera.position.z);

  const snap = 8;
  let lastCx = NaN, lastCz = NaN;
  const update = (dt) => {
    sky.update({ dt, sunDir: skySun, overcast: 0, rain: 0, bright: 0, aurora: 0, day: 0, exposure: EXPOSURE, camera });
    sky.uniforms.hazeColor.value.copy(scene.fog.color);
    // the shadow box follows the walker on a coarse lattice so its texels do not swim
    const cx = Math.round(camera.position.x / snap) * snap, cz = Math.round(camera.position.z / snap) * snap;
    const cy = heightAt(cx, cz);
    if (cx !== lastCx || cz !== lastCz) { lastCx = cx; lastCz = cz; sun.shadow.needsUpdate = true; }
    sun.target.position.set(cx, cy, cz);
    sun.position.copy(sun.target.position).addScaledVector(lightDir, 260);
    ocean.update(camera, dt, skySun);
    ocean.u.foamLight.value = 0.6;             // the kit dims foam to 12 % for a 1-degree sun; surf at dusk is still pale
    glare.position.copy(camera.position).addScaledVector(sky.uniforms.imgSunDir.value, 1500);
  };
  const renderMirror = () => ocean.renderMirror(renderer, camera);

  return { sky, sun, fill, ocean, skySun, lightDir, sunFlat, update, renderMirror };
}
