import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Already-published history before research was split out. Never exempt newer commits.
const PUBLIC_BASELINE = '8b6d71cc90040bdb89d560b95c6186fa887932f9';
const privateRoots = /(?:^|\/)(?:training|research|datasets?|checkpoints?|runs|models?|model-exports|benchmarks|Wordwell-Training|artifacts|\.cache|\.conda|\.local-backup|node_modules|dist)(?:\/|$)/i;
const modelFiles = /\.(?:gguf|safetensors|onnx|onnx_data|wwedit|pt|pth|ckpt|jsonl|bundle|log)$/i;
export function assertPublicPaths(paths) {
  const rejected = paths.filter(name => privateRoots.test(name) || modelFiles.test(name));
  if (rejected.length) throw new Error(`Private research or model assets cannot enter Wordwell:\n${rejected.slice(0, 20).join('\n')}`);
}
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true }).trim();
const list = value => value.split('\0').filter(Boolean);
export function auditCommitHistory(head, base) {
  if (!/^[0-9a-f]{40}$/.test(head) || (base && !/^[0-9a-f]{40}$/.test(base))) throw new Error('Invalid commit ID for public-history audit.');
  const args = ['rev-list', head, `^${PUBLIC_BASELINE}`];
  if (base && !/^0+$/.test(base)) args.push(`^${base}`);
  const commits = git(args).split('\n').filter(Boolean);
  for (const commit of commits) {
    try { assertPublicPaths(list(git(['ls-tree', '-r', '-z', '--name-only', commit]))); }
    catch (error) { throw new Error(`Unsafe public commit ${commit}: ${error.message}`); }
  }
  return commits.length;
}
function main() {
  assertPublicPaths(list(git(['ls-files', '-z'])));
  let count = 0;
  if (process.argv.includes('--pre-push')) {
    for (const line of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
      const [, local, , remote] = line.split(/\s+/);
      if (local && !/^0+$/.test(local)) {
        // A stale local remote ref is not a reason to skip the unpushed history.
        const knownRemote = remote && !/^0+$/.test(remote) && (() => { try { git(['cat-file', '-e', remote]); return true; } catch { return false; } })();
        count += auditCommitHistory(local, knownRemote ? remote : undefined);
      }
    }
  } else if (process.argv.includes('--ci')) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    count = auditCommitHistory(git(['rev-parse', 'HEAD']), event.pull_request?.base?.sha || event.before);
  } else count = auditCommitHistory(git(['rev-parse', 'HEAD']));
  console.log(`PASS: public source boundary; ${count} post-baseline commits audited.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
