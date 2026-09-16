import { defineConfig } from 'tsdown'

/**
 * Bundle undici into `lib/vendor/`, leaving Node's own modules external. The
 * result is what `lib/index.js` imports, so the published package installs
 * with nothing to download.
 */
export default defineConfig({
  name: 'dsh-net-policy/vendor',
  entry: { undici: 'src/vendor/undici.ts' },
  outDir: 'lib/vendor',
  format: 'esm',
  platform: 'node',
  dts: false,
  clean: false,
  sourcemap: false,
  treeshake: true,
  // Node's own modules stay external; everything else — undici and its
  // dependencies — is inlined.
  noExternal: (id: string) => !id.startsWith('node:'),
})
