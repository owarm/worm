import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const zipWorkerAssets = [
  {
    from: './node_modules/@zip.js/zip.js/dist/z-worker-pako.js',
    to: './public/fastboot/zip/z-worker-pako.js'
  },
  {
    from: './node_modules/@zip.js/zip.js/tests/vendor/pako_inflate.min.js',
    to: './public/fastboot/zip/pako_inflate.min.js'
  }
];

const copyFastbootZipWorkers = () => ({
  name: 'copy-fastboot-zip-workers',
  async buildStart() {
    await mkdir(fileURLToPath(new URL('./public/fastboot/zip/', import.meta.url)), { recursive: true });
    await Promise.all(
      zipWorkerAssets.map((asset) =>
        copyFile(fileURLToPath(new URL(asset.from, import.meta.url)), fileURLToPath(new URL(asset.to, import.meta.url)))
      )
    );
  }
});

export default defineConfig({
  plugins: [copyFastbootZipWorkers()],
  server: {
    host: '127.0.0.1',
    port: 5173
  },
  test: {
    environment: 'node',
    globals: true
  }
});
