import { mkdir, lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
export const dist = path.join(root, 'dist');

export async function checkedDist() {
  await mkdir(dist, { recursive: true });
  if (path.relative(root, await realpath(dist)) !== 'dist' || (await lstat(dist)).isSymbolicLink()) {
    throw new Error('Build output must be the real dist directory inside this repository.');
  }
  return dist;
}

export async function resetOutputDirectory(name) {
  if (!['extension', 'release-validation'].includes(name)) throw new Error('Unknown build output directory.');
  const directory = path.join(await checkedDist(), name);
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || path.relative(dist, await realpath(directory)) !== name) {
      throw new Error('Refusing to clean a redirected build output directory.');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Both absolute paths and their real locations have been checked above.
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(directory);
  return directory;
}
