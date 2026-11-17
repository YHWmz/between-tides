// Texture sets (CC0, ambientCG) shared by the terrain and the props.
import * as THREE from 'three/webgpu';

const NAMES = ['ground', 'rock', 'rockmoss', 'paving', 'wood', 'plaster', 'roof', 'wall'];

export async function loadTextures(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.getMaxAnisotropy?.() ?? 8);
  const one = async (name, kind) => {
    const t = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/tex/${name}_${kind}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.colorSpace = kind === 'c' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  const out = {};
  await Promise.all(NAMES.map(async (n) => {
    const [c, nrm, r] = await Promise.all([one(n, 'c'), one(n, 'n'), one(n, 'r')]);
    out[n] = { c, n: nrm, r };
  }));
  return out;
}
