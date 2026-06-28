import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

/** Extension host: Node, CommonJS, `vscode` provided by the runtime. */
const host = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
};

/** Webview: browser bundle of the React + TipTap editor. */
const webview = {
  ...common,
  entryPoints: ['webview/main.tsx'],
  outfile: 'media/webview.js',
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  target: 'es2020',
};

if (watch) {
  const [a, b] = await Promise.all([esbuild.context(host), esbuild.context(webview)]);
  await Promise.all([a.watch(), b.watch()]);
  console.log('[forma-vscode] watching…');
} else {
  await Promise.all([esbuild.build(host), esbuild.build(webview)]);
  console.log('[forma-vscode] build complete');
}
