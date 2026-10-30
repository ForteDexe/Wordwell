import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultModel = 'Qwen3.5-0.8B-UD-Q6_K_XL.gguf';
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };

export async function startServer({ port = Number(process.env.PORT || 8766), modelDirectory = process.env.MODEL_DIR || path.join(root, 'models') } = {}) {
  const modelRoot = path.resolve(modelDirectory);
  const models = await Promise.all((await readdir(modelRoot)).filter(name => name.endsWith('.gguf')).map(async name => ({ name, bytes: (await stat(path.join(modelRoot, name))).size })));
  const server = createServer(async (request, response) => {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/config') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ models, defaultModel, context: 1024, engine: 'wllama 3.8.1' }));
        return;
      }
      let file;
      if (url.pathname === '/model') {
        const name = url.searchParams.get('name') || defaultModel;
        if (!models.some(model => model.name === name)) { response.writeHead(404).end('Unknown model'); return; }
        file = path.join(modelRoot, name);
      } else if (url.pathname.startsWith('/vendor/')) {
        const vendorRoot = path.join(root, 'node_modules/@wllama/wllama/esm');
        file = path.resolve(vendorRoot, decodeURIComponent(url.pathname.slice('/vendor/'.length)));
        if (!file.startsWith(vendorRoot + path.sep)) { response.writeHead(403).end(); return; }
      } else {
        const files = { '/': 'index.html', '/engine.mjs': 'engine.mjs', '/styles.css': 'styles.css', '/cases.json': 'cases.json' };
        if (!files[url.pathname]) { response.writeHead(404).end(); return; }
        file = path.join(root, 'engine-test', files[url.pathname]);
      }
      const info = await stat(file);
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.setHeader('Accept-Ranges', 'bytes');
      let start = 0, end = info.size - 1;
      if (request.headers.range) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
        if (!range) { response.writeHead(416).end(); return; }
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), end) : end;
        if (start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end(); return; }
        response.statusCode = 206;
        response.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
      }
      response.setHeader('Content-Length', end - start + 1);
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file, { start, end });
      response.on('close', () => stream.destroy());
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer();
  console.log(`Local browser engine test: ${url}`);
}
