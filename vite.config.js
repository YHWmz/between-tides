import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // The addons import bare 'three'; point it at the WebGPU build so only one copy of the library loads.
  resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
  build: { target: 'esnext', chunkSizeWarningLimit: 2500 },
});
