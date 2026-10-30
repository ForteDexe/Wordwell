import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageWorkers } from './package-workers.mjs';
import { diffText } from '../extension/text-diff.js';
import { createWritingTools } from '../extension/writing-tools.js';
import { createAutoChecker } from '../extension/auto-check.js';
import { createLanguageTools } from '../extension/languages.js';
import { resetOutputDirectory } from './build-paths.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = await resetOutputDirectory('extension');
await cp(path.join(root, 'extension'), output, { recursive: true });
await cp(path.join(root, 'docs/privacy.html'), path.join(output, 'privacy.html'));
await cp(path.join(root, 'docs/privacy.css'), path.join(output, 'privacy.css'));
await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
await cp(path.join(root, 'NOTICE'), path.join(output, 'NOTICE'));
const inlineSource = await readFile(path.join(root, 'extension/inline.js'), 'utf8');
if (inlineSource.split("'__INLINE_CSS__'").length !== 2) throw new Error('Missing inline stylesheet placeholder');
if (inlineSource.split("'__INLINE_DIFF__'").length !== 2) throw new Error('Missing inline diff placeholder');
for (const placeholder of ['__INLINE_WRITING_TOOLS__', '__INLINE_AUTO_CHECKER__', '__INLINE_LANGUAGE_TOOLS__']) {
  if (inlineSource.split(`'${placeholder}'`).length !== 2) throw new Error(`Missing ${placeholder} placeholder`);
}
const inlineCSS = await readFile(path.join(root, 'extension/inline.css'), 'utf8');
await writeFile(path.join(output, 'inline.js'), inlineSource
  .replace("'__INLINE_CSS__'", () => JSON.stringify(inlineCSS))
  .replace("'__INLINE_DIFF__'", () => diffText.toString())
  .replace("'__INLINE_WRITING_TOOLS__'", () => createWritingTools.toString())
  .replace("'__INLINE_LANGUAGE_TOOLS__'", () => createLanguageTools.toString())
  .replace("'__INLINE_AUTO_CHECKER__'", () => createAutoChecker.toString()));
await mkdir(path.join(output, 'vendor/wasm'), { recursive: true });
await cp(path.join(root, 'runtime/wllama/wllama.wasm'), path.join(output, 'vendor/wasm/wllama.wasm'));
await packageWorkers(path.join(root, 'node_modules/@wllama/wllama'), path.join(output, 'vendor'));
await cp(path.join(root, 'node_modules/@wllama/wllama/LICENCE'), path.join(output, 'vendor/LICENSE'));
await cp(path.join(root, 'runtime/wllama/LLAMA-LICENSE'), path.join(output, 'vendor/LLAMA-LICENSE'));
await writeFile(path.join(output, 'vendor/NOTICE.txt'), 'wllama 3.8.1: https://github.com/ngxson/wllama\nMIT license. Built-in llama.cpp runtime: b11364-46ca246.\nLocal addition: exact chat prompt token counting. Source and rebuild instructions: runtime/wllama/.\n');
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
console.log(`${manifest.name} ${manifest.version}: ${output}`);
