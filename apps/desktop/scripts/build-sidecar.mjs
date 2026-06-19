/**
 * Packages the Forma Node server into a self-contained Single Executable
 * Application (SEA) that Tauri ships as a sidecar.
 *
 * Steps: esbuild-bundle the server to one CJS file → build a SEA blob → copy
 * the running `node` binary, strip its signature, inject the blob with postject,
 * re-sign (ad-hoc) → emit `binaries/forma-server-<target-triple>` where Tauri
 * looks it up.
 *
 * node:sqlite / FTS5 are built into node, so the SEA binary has them with no
 * native deps. (The agent SDK spawns its own cli.js subprocess — that path is
 * not yet covered by this packaging; tracked as a follow-up.)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const outDir = path.resolve(here, '../src-tauri/binaries');
const cacheDir = path.resolve(here, '../.node-cache');
const bundlePath = path.join(outDir, 'server.cjs');
const blobPath = path.join(outDir, 'sea-prep.blob');
const seaConfigPath = path.join(outDir, 'sea-config.json');

/**
 * SEA must be injected into an *official* node binary (statically linked, ships
 * the NODE_SEA_FUSE sentinel). Homebrew/manager node is a thin launcher over
 * libnode.dylib and won't work. Download + cache the matching official build.
 */
async function officialNodeBinary() {
  const ver = process.version; // e.g. v25.9.0
  const plat = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null;
  if (!plat) throw new Error(`SEA packaging not wired for platform: ${process.platform}`);
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
  const name = `node-${ver}-${plat}-${arch}`;
  const dest = path.join(cacheDir, name, 'bin', 'node');
  if (existsSync(dest)) {
    console.log(`• using cached official node: ${name}`);
    return dest;
  }
  mkdirSync(cacheDir, { recursive: true });
  const url = `https://nodejs.org/dist/${ver}/${name}.tar.gz`;
  console.log(`• downloading official node: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`node download failed (${res.status}): ${url}`);
  const tgz = path.join(cacheDir, `${name}.tar.gz`);
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xzf', tgz, '-C', cacheDir], { stdio: 'inherit' });
  rmSync(tgz, { force: true });
  return dest;
}

/** Tauri sidecar naming: `<name>-<rustc target triple>`. */
function targetTriple() {
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  if (process.platform === 'linux') return `${arch}-unknown-linux-gnu`;
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  throw new Error(`unsupported platform: ${process.platform}`);
}

async function bundleServer() {
  console.log('• bundling server → server.cjs');
  await build({
    entryPoints: [path.join(repoRoot, 'apps/server/src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: bundlePath,
    // Shim `import.meta.url` for the CJS output so env.ts doesn't crash at
    // startup (it only uses it to *optionally* locate a repo .env).
    banner: {
      js: "const __import_meta_url=(()=>{try{return require('node:url').pathToFileURL(__filename).href}catch{return 'file:///'}})();",
    },
    define: { 'import.meta.url': '__import_meta_url' },
    logLevel: 'warning',
  });
}

async function buildSea() {
  console.log('• building SEA blob');
  writeFileSync(
    seaConfigPath,
    JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true }),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { stdio: 'inherit' });

  const baseNode = await officialNodeBinary();
  const triple = targetTriple();
  const binPath = path.join(outDir, `forma-server-${triple}`);
  console.log(`• assembling ${path.basename(binPath)}`);
  copyFileSync(baseNode, binPath);
  execFileSync('chmod', ['u+rwx', binPath]);

  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--remove-signature', binPath], { stdio: 'inherit' });
  }

  const postjectArgs = [
    binPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  if (process.platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  execFileSync('npx', ['-y', 'postject', ...postjectArgs], { stdio: 'inherit' });

  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--sign', '-', binPath], { stdio: 'inherit' });
  }

  // Cleanup intermediates; keep the bundle for debugging.
  rmSync(blobPath, { force: true });
  rmSync(seaConfigPath, { force: true });
  console.log(`✓ sidecar ready: ${binPath}`);

  copyAgentBinary(triple);
}

/**
 * The agent SDK runs a native `claude` binary (shipped as a per-platform
 * optional dep). Copy it next to the server as a second Tauri sidecar; the
 * Rust shell points FORMA_CLAUDE_BIN at it so the bundled SDK can find it.
 */
function copyAgentBinary(triple) {
  const plat = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
  const pkg = `@anthropic-ai/claude-agent-sdk-${plat}-${arch}`;
  const src = path.join(repoRoot, 'node_modules', pkg, 'claude');
  if (!existsSync(src)) {
    throw new Error(`agent native binary not found: ${src} (is ${pkg} installed?)`);
  }
  const dest = path.join(outDir, `claude-${triple}`);
  console.log(`• copying agent binary → ${path.basename(dest)}`);
  copyFileSync(src, dest);
  execFileSync('chmod', ['u+rwx', dest]);
  console.log(`✓ agent binary ready: ${dest}`);
}

mkdirSync(outDir, { recursive: true });
await bundleServer();
await buildSea();
