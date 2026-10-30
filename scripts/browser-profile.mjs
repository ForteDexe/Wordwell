import { lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fresh installs now create their own setup tab. Tests must reuse it so they
// exercise real installation and cannot accidentally start a second engine.
export async function waitForWorkspace(context, extensionId, { timeout = 10000 } = {}) {
  const url = `chrome-extension://${extensionId}/workspace.html`, deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = context.pages().find(candidate => candidate.url() === url);
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Wordwell did not automatically open its setup workspace.');
}

// Persistent profiles are needed for browser-restart tests, but their local
// model caches should be released once the entire test has closed its browser.
export async function removeTestProfile(profile) {
  const root = await realpath(fileURLToPath(new URL('../.browser-check/', import.meta.url)));
  const target = await realpath(profile);
  const relative = path.relative(root, target);
  const info = await lstat(profile);
  if (!relative || path.isAbsolute(relative) || relative.includes(path.sep) || !/^(extension|editor-checks)-[a-z0-9]+$/i.test(relative) || !info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Refusing to remove a path outside the generated browser-test profiles.');
  }
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
