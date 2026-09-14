import { createRequire } from 'node:module'
import { defineConfig } from 'tsdown'

/**
 * Plugin id stamped into the loader handoff: the web shell rejects a bundle
 * whose `__ModuleLoader__.load` id differs from the installed package name.
 */
const PLUGIN_ID: string = createRequire(import.meta.url)('./package.json').name

/**
 * Browser platform words the shell's frozen module table resolves at runtime.
 * Everything else is inlined, including this package's own `lib/` modules.
 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig({
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  // The browser bundle lands beside the hand-written host half in lib/, so
  // clean must stay off or tsdown would wipe it.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  sourcemap: false,
  external: [...CLIENT_EXTERNALS],
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
