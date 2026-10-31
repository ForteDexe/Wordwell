import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function packageFiles(directory) {
  const files = {};
  async function visit(relative = '') {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const key = relative ? `${relative}/${name}` : name;
      const full = path.join(directory, ...key.split('/'));
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error(`Package cannot contain links: ${key}`);
      if (info.isDirectory()) await visit(key);
      else if (info.isFile()) files[key] = await readFile(full);
      else throw new Error(`Unsupported package entry: ${key}`);
    }
  }
  await visit();
  return files;
}

export function validatePackage(files, version) {
  const requireFile = name => {
    if (!Object.hasOwn(files, name) || !files[name].length) throw new Error(`Missing package file: ${name}`);
    return files[name];
  };
  for (const name of Object.keys(files)) {
    if (name.includes('\\') || name.startsWith('/') || name.split('/').some(part => !part || part.startsWith('.'))
      || !/^[\w/.-]+$/.test(name) || (!/\.(js|css|html|json|png|svg|txt|wasm)$/i.test(name) && !/(^|\/)(LICENSE|NOTICE|LLAMA-LICENSE)$/.test(name))) {
      throw new Error(`Unexpected package path: ${name}`);
    }
  }
  const manifest = JSON.parse(Buffer.from(requireFile('manifest.json')).toString());
  if (manifest.manifest_version !== 3 || manifest.name !== 'Wordwell' || manifest.version !== version) throw new Error('Release manifest does not match the package name and version.');
  for (const name of ['workspace.html', 'workspace.js', 'inline.js', 'settings.js', 'benchmark.js', 'benchmark-cases.json', 'privacy.html', 'privacy.css', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt',
    'licenses/harper-LICENSE.txt', 'vendor/LICENSE', 'vendor/LLAMA-LICENSE', 'vendor/index.js',
    'vendor/main-worker.js', 'vendor/pthread-worker.js', 'vendor/opfs-worker.js', 'vendor/wasm/wllama.wasm']) requireFile(name);
  for (const paths of [manifest.icons, manifest.action?.default_icon]) {
    for (const size of [16, 32, 48, 128]) {
      const png = Buffer.from(requireFile(paths?.[size]));
      if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`Invalid ${size}px icon.`);
    }
  }
  for (const script of manifest.content_scripts || []) for (const name of [...(script.js || []), ...(script.css || [])]) requireFile(name);
  requireFile(manifest.background?.service_worker);
  const csp = manifest.content_security_policy?.extension_pages || '';
  const expectedCsp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; style-src 'self'; img-src 'self' data:; object-src 'none';";
  if (csp !== expectedCsp || /'unsafe-eval'|'unsafe-inline'|https:\/\//.test(csp)) throw new Error('Unexpected extension CSP.');
  if (Buffer.from(files['inline.js']).includes(Buffer.from('__INLINE_'))) throw new Error('Unbundled inline placeholder in release.');
  if (Buffer.from(files['vendor/wasm/wllama.wasm']).subarray(0, 4).toString('hex') !== '0061736d') throw new Error('Invalid packaged WASM.');
  const expected = ['clipboardWrite', 'contextMenus', 'storage', 'unlimitedStorage'];
  if (JSON.stringify([...(manifest.permissions || [])].sort()) !== JSON.stringify(expected)) throw new Error('Review changed release permissions.');
  const expectedHosts = ['http://127.0.0.1/*', 'http://localhost/*'];
  if (JSON.stringify([...(manifest.host_permissions || [])].sort()) !== JSON.stringify(expectedHosts)) throw new Error('Review changed release host permissions.');
  return manifest;
}

export function createReleaseZip(files) {
  const entries = {};
  for (const name of Object.keys(files).sort()) entries[name] = [files[name], { mtime: new Date(2000, 0, 1), os: 0, attrs: 0 }];
  const zip = zipSync(entries, { level: 9 });
  const restored = unzipSync(zip);
  if (Object.keys(restored).length !== Object.keys(files).length) throw new Error('ZIP round-trip changed package file count.');
  for (const name of Object.keys(files)) if (sha256(restored[name]) !== sha256(files[name])) throw new Error(`ZIP round-trip changed ${name}`);
  return zip;
}
