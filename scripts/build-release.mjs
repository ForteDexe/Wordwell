import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkedDist, root } from './build-paths.mjs';
import { packageFiles, validatePackage, createReleaseZip, sha256 } from './release-package.mjs';

await import('./build-extension.mjs');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = await checkedDist();
const files = await packageFiles(path.join(output, 'extension'));
validatePackage(files, version);
const zip = createReleaseZip(files), filename = `wordwell-${version}.zip`;
await writeFile(path.join(output, filename), zip);
const manifest = { version, filename, sha256: sha256(zip), bytes: zip.length,
  files: Object.keys(files).sort().map(name => ({ name, bytes: files[name].length, sha256: sha256(files[name]) })) };
await writeFile(path.join(output, `wordwell-${version}.release.json`), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(output, `${filename}.sha256`), `${manifest.sha256}  ${filename}\n`);
console.log(`Release: ${path.join(output, filename)} (${(zip.length / 1024 / 1024).toFixed(2)} MiB, ${manifest.files.length} files)`);
console.log(`SHA-256: ${manifest.sha256}`);
