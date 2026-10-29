import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// wllama 3.8.1 normally builds its workers with Blob URLs. MV3 requires
// packaged worker URLs. Adapt the build output only; keep node_modules intact.
export async function packageWorkers(packageRoot, output) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.version !== '3.8.1') throw new Error('Review the worker adapter before changing wllama versions.');
  const generated = await readFile(path.join(packageRoot, 'src/workers-code/generated.ts'), 'utf8');
  function literal(name) {
    const match = generated.match(new RegExp(`export const ${name} = ("[^\\n]*");`));
    if (!match) throw new Error(`Missing generated worker: ${name}`);
    return JSON.parse(match[1]);
  }
  const nativeCode = literal('WLLAMA_EMSCRIPTEN_CODE');
  let workerCode = literal('LLAMA_CPP_WORKER_CODE');
  const opfsCode = literal('OPFS_UTILS_WORKER_CODE');
  const original = await readFile(path.join(packageRoot, 'esm/index.js'), 'utf8');
  const stub = original.match(/var JSPI_STUB = `([\s\S]*?)`;/)?.[1];
  if (!stub) throw new Error('Missing JSPI compatibility stub');
  const scriptBlob = '? argMainScriptBlob';
  if (workerCode.split(scriptBlob).length !== 2) throw new Error('Unexpected pthread worker configuration');
  workerCode = workerCode.replace(scriptBlob, "? new URL('./pthread-worker.js', self.location.href).href");

  const start = original.indexOf('var createWorker = (workerCode) => {');
  const end = original.indexOf('\nvar cbToAsyncIter', start);
  if (start < 0 || end < start) throw new Error('Unexpected wllama worker factory');
  const factory = `var createWorker = (workerCode) => {
    if (workerCode === OPFS_UTILS_WORKER_CODE) {
      return new Worker(new URL('./opfs-worker.js', import.meta.url), { type: 'module' });
    }
    const options = /^const RUN_OPTIONS = (\{.*\});*$/m.exec(workerCode);
    if (!options) throw new Error('Missing packaged worker configuration');
    const url = new URL('./main-worker.js', import.meta.url);
    url.searchParams.set('options', JSON.stringify(JSON.parse(options[1])));
    if (workerCode.includes('Object.defineProperty(WorkerNavigator.prototype')) url.searchParams.set('cpu', '1');
    return new Worker(url, { type: 'module' });
  };`;
  const bootstrap = `const params = new URL(self.location.href).searchParams;
const RUN_OPTIONS = JSON.parse(params.get('options'));
if (params.get('cpu') === '1') {
  Object.defineProperty(WorkerNavigator.prototype, 'gpu', {get: () => ({requestAdapter: async () => null})});
}
function wModuleInit() {
${stub}
${nativeCode.replace('var Module', 'var ___Module')}
return Module;
}
`;
  await Promise.all([
    writeFile(path.join(output, 'index.js'), original.slice(0, start) + factory + original.slice(end)),
    writeFile(path.join(output, 'main-worker.js'), bootstrap + workerCode),
    writeFile(path.join(output, 'pthread-worker.js'), stub + nativeCode),
    writeFile(path.join(output, 'opfs-worker.js'), opfsCode),
  ]);
}
