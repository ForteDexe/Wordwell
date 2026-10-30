import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { unzipSync } from 'fflate';
import { root, dist, resetOutputDirectory } from './build-paths.mjs';
import { validatePackage, sha256 } from './release-package.mjs';

const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const zip = await readFile(path.join(dist, `wordwell-${version}.zip`));
const manifest = JSON.parse(await readFile(path.join(dist, `wordwell-${version}.release.json`), 'utf8'));
if (sha256(zip) !== manifest.sha256) throw new Error('Release ZIP checksum mismatch.');
const files = unzipSync(zip);
validatePackage(files, version);
if (manifest.files.length !== Object.keys(files).length) throw new Error('Release file count mismatch.');
for (const entry of manifest.files) if (!files[entry.name] || sha256(files[entry.name]) !== entry.sha256) throw new Error(`Release file checksum mismatch: ${entry.name}`);
const directory = await resetOutputDirectory('release-validation');
for (const [name, bytes] of Object.entries(files)) {
  const output = path.join(directory, ...name.split('/'));
  if (path.relative(directory, output).startsWith('..')) throw new Error('ZIP entry escapes the release validation directory.');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes);
}
console.log(`Testing the extracted release ZIP, SHA-256 ${manifest.sha256}`);
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/test-extension.mjs'], {
    cwd: root, env: { ...process.env, EXTENSION_PATH: directory, RELEASE_SHA256: manifest.sha256, RELEASE_SCREENSHOTS: '1' }, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
});
if (exitCode !== 0) process.exitCode = exitCode;
else {
  const report = JSON.parse(await readFile(path.join(root, 'artifacts/extension-test.json'), 'utf8'));
  if (!report.passed || report.releaseSha256 !== manifest.sha256) throw new Error('Release validation report does not match the archive.');
  await writeFile(path.join(dist, `wordwell-${version}.validation.json`), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS: the release archive passed fresh-profile browser tests, including full restart and cached-model recovery.');
}
