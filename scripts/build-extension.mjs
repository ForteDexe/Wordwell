import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageWorkers } from './package-workers.mjs';
import { diffText } from '../extension/text-diff.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/extension');
await mkdir(output, { recursive: true });
await cp(path.join(root, 'extension'), output, { recursive: true });
const inlineSource = await readFile(path.join(root, 'extension/inline.js'), 'utf8');
if (inlineSource.split("'__INLINE_CSS__'").length !== 2) throw new Error('Missing inline stylesheet placeholder');
if (inlineSource.split("'__INLINE_DIFF__'").length !== 2) throw new Error('Missing inline diff placeholder');
const inlineCSS = await readFile(path.join(root, 'extension/inline.css'), 'utf8');
await writeFile(path.join(output, 'inline.js'), inlineSource
  .replace("'__INLINE_CSS__'", () => JSON.stringify(inlineCSS))
  .replace("'__INLINE_DIFF__'", () => diffText.toString()));
await mkdir(path.join(output, 'vendor/wasm'), { recursive: true });
for (const file of ['index.js', 'wasm/wllama.wasm']) {
  await cp(path.join(root, 'node_modules/@wllama/wllama/esm', file), path.join(output, 'vendor', file));
}
await packageWorkers(path.join(root, 'node_modules/@wllama/wllama'), path.join(output, 'vendor'));
await cp(path.join(root, 'node_modules/@wllama/wllama/LICENCE'), path.join(output, 'vendor/LICENSE'));
await writeFile(path.join(output, 'vendor/NOTICE.txt'), 'wllama 3.8.1: https://github.com/ngxson/wllama\nMIT license. Built-in llama.cpp runtime: b11364-46ca246.\n');
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
console.log(`${manifest.name} ${manifest.version}: ${output}`);
