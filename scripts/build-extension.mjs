import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageWorkers } from './package-workers.mjs';
import { diffText } from '../extension/text-diff.js';
import { createWritingTools } from '../extension/writing-tools.js';
import { createAutoChecker } from '../extension/auto-check.js';
import { createLanguageTools } from '../extension/languages.js';
import { resetOutputDirectory } from './build-paths.mjs';
import { TRANSLATION_DEFAULTS, ENGINE_DEFAULTS } from '../extension/settings.js';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = await resetOutputDirectory('extension');
await cp(path.join(root, 'extension'), output, { recursive: true });
await cp(path.join(root, 'docs/privacy.html'), path.join(output, 'privacy.html'));
await cp(path.join(root, 'docs/privacy.css'), path.join(output, 'privacy.css'));
await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
await cp(path.join(root, 'NOTICE'), path.join(output, 'NOTICE'));
await cp(path.join(root, 'engine-test/cases.json'), path.join(output, 'benchmark-cases.json'));
const inlineSource = await readFile(path.join(root, 'extension/inline.js'), 'utf8');
if (inlineSource.split("'__INLINE_CSS__'").length !== 2) throw new Error('Missing inline stylesheet placeholder');
if (inlineSource.split("'__INLINE_DIFF__'").length !== 2) throw new Error('Missing inline diff placeholder');
for (const placeholder of ['__INLINE_WRITING_TOOLS__', '__INLINE_AUTO_CHECKER__', '__INLINE_LANGUAGE_TOOLS__', '__INLINE_DEFAULT_SETTINGS__']) {
  if (inlineSource.split(`'${placeholder}'`).length !== 2) throw new Error(`Missing ${placeholder} placeholder`);
}
const inlineCSS = await readFile(path.join(root, 'extension/inline.css'), 'utf8');
await writeFile(path.join(output, 'inline.js'), inlineSource
  .replace("'__INLINE_CSS__'", () => JSON.stringify(inlineCSS))
  .replace("'__INLINE_DIFF__'", () => diffText.toString())
  .replace("'__INLINE_DEFAULT_SETTINGS__'", () => JSON.stringify({ ...TRANSLATION_DEFAULTS, engineMode: ENGINE_DEFAULTS.engineMode }))
  .replace("'__INLINE_WRITING_TOOLS__'", () => createWritingTools.toString())
  .replace("'__INLINE_LANGUAGE_TOOLS__'", () => createLanguageTools.toString())
  .replace("'__INLINE_AUTO_CHECKER__'", () => createAutoChecker.toString()));
await mkdir(path.join(output, 'vendor/wasm'), { recursive: true });
await cp(path.join(root, 'runtime/wllama/wllama.wasm'), path.join(output, 'vendor/wasm/wllama.wasm'));
await packageWorkers(path.join(root, 'node_modules/@wllama/wllama'), path.join(output, 'vendor'));
await cp(path.join(root, 'node_modules/@wllama/wllama/LICENCE'), path.join(output, 'vendor/LICENSE'));
await cp(path.join(root, 'runtime/wllama/LLAMA-LICENSE'), path.join(output, 'vendor/LLAMA-LICENSE'));
await writeFile(path.join(output, 'vendor/NOTICE.txt'), 'wllama 3.8.1: https://github.com/ngxson/wllama\nMIT license. Built-in llama.cpp runtime: b11364-46ca246.\nLocal addition: exact chat prompt token counting. Source and rebuild instructions: runtime/wllama/.\n');
await mkdir(path.join(output, 'vendor/onnx'), { recursive: true });
await mkdir(path.join(output, 'vendor/tokenizers'), { recursive: true });
for (const name of ['ort.webgpu.bundle.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  await cp(path.join(root, 'node_modules/onnxruntime-web/dist', name), path.join(output, 'vendor/onnx', name));
}
await cp(path.join(root, 'node_modules/onnxruntime-web/README.md'), path.join(output, 'vendor/onnx/README.txt'));
await cp(path.join(root, 'runtime/edit-model/ONNX-LICENSE.txt'), path.join(output, 'vendor/onnx/LICENSE'));
await cp(path.join(root, 'runtime/edit-model/ONNX-ThirdPartyNotices.txt'), path.join(output, 'vendor/onnx/ThirdPartyNotices.txt'));
await cp(path.join(root, 'node_modules/@huggingface/tokenizers/dist/tokenizers.mjs'), path.join(output, 'vendor/tokenizers/tokenizers.mjs'));
await cp(path.join(root, 'node_modules/@huggingface/tokenizers/LICENSE'), path.join(output, 'vendor/tokenizers/LICENSE'));
const spelling = path.join(output, 'vendor/spelling');
await mkdir(spelling, { recursive: true });
const aff = await readFile(path.join(root, 'node_modules/dictionary-en/index.aff'));
if (!aff.equals(await readFile(path.join(root, 'node_modules/dictionary-en-gb/index.aff')))) throw new Error('Spelling dictionaries need matching affix rules.');
await build({ entryPoints: [path.join(root, 'node_modules/nspell/lib/index.js')], outfile: path.join(spelling, 'nspell.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof' });
await writeFile(path.join(spelling, 'en.aff'), aff);
const entries = new Set();
for (const pkg of ['dictionary-en', 'dictionary-en-gb']) {
  const lines = (await readFile(path.join(root, 'node_modules', pkg, 'index.dic'), 'utf8')).trim().split(/\r?\n/);
  if (!/^\d+$/.test(lines.shift())) throw new Error('Unexpected spelling dictionary header.');
  for (const line of lines) if (line) entries.add(line);
  await cp(path.join(root, 'node_modules', pkg, 'license'), path.join(spelling, `${pkg}-LICENSE.txt`));
}
// Parse once: nspell's successive dictionary() calls regenerate compound rules
// incorrectly. The matching affixes let us safely merge the raw entries first.
await writeFile(path.join(spelling, 'en.dic'), `${entries.size}\n${[...entries].join('\n')}\n`);
await cp(path.join(root, 'node_modules/nspell/license'), path.join(spelling, 'nspell-LICENSE.txt'));
await cp(path.join(root, 'node_modules/is-buffer/LICENSE'), path.join(spelling, 'is-buffer-LICENSE.txt'));
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
console.log(`${manifest.name} ${manifest.version}: ${output}`);
