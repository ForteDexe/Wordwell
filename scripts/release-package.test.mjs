import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { root, dist } from './build-paths.mjs';
import { packageFiles, validatePackage, createReleaseZip, sha256 } from './release-package.mjs';

const files = await packageFiles(path.join(dist, 'extension'));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const modifyManifest = change => {
  const manifest = JSON.parse(files['manifest.json']); change(manifest);
  return { ...files, 'manifest.json': Buffer.from(JSON.stringify(manifest)) };
};

test('the built package has its root manifest, runtime, privacy page, notices, and icon assets', () => {
  assert.equal(validatePackage(files, version).name, 'Wordwell');
});
test('release archives are deterministic and preserve every file byte', () => {
  assert.equal(sha256(createReleaseZip(files)), sha256(createReleaseZip(files)));
});
test('models, hidden files, and traversing archive paths are rejected', () => {
  for (const name of ['model.gguf', 'model.safetensors', 'weights.bin', '.env', '../secret.txt', '/secret.txt', 'a\\secret.txt']) {
    assert.throws(() => validatePackage({ ...files, [name]: Buffer.from('not for release') }, version), /Unexpected package path/);
  }
});
test('a missing packaged worker is rejected', () => {
  const copy = { ...files }; delete copy['vendor/pthread-worker.js'];
  assert.throws(() => validatePackage(copy, version), /Missing package file/);
});
test('version mismatches and changed permission/CSP declarations require review', () => {
  assert.throws(() => validatePackage(modifyManifest(m => { m.version = '99.0.0'; }), version), /manifest does not match/);
  assert.throws(() => validatePackage(modifyManifest(m => { m.permissions.push('history'); }), version), /changed release permissions/);
  assert.throws(() => validatePackage(modifyManifest(m => { m.host_permissions.push('https://example.com/*'); }), version), /changed release host permissions/);
  assert.throws(() => validatePackage(modifyManifest(m => { m.content_security_policy.extension_pages += " script-src 'unsafe-eval';"; }), version), /Unexpected extension CSP/);
});
test('an invalid icon size is rejected', () => {
  const name = 'icons/icon128.png', png = Buffer.from(files[name]); png.writeUInt32BE(64, 16);
  assert.throws(() => validatePackage({ ...files, [name]: png }, version), /Invalid 128px icon/);
});
test('clean builds remove obsolete output files before packaging', async () => {
  const sentinel = path.join(dist, 'extension', 'obsolete-test.txt');
  await writeFile(sentinel, 'must not survive a clean build');
  await promisify(execFile)(process.execPath, ['scripts/build-extension.mjs'], { cwd: root, windowsHide: true });
  await assert.rejects(access(sentinel), { code: 'ENOENT' });
});
