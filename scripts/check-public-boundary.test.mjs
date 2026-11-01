import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicPaths } from './check-public-boundary.mjs';

test('runtime code, notices and public functional fixtures remain allowed', () => {
  assert.doesNotThrow(() => assertPublicPaths(['extension/edit-model-core.js', 'runtime/wllama/wllama.wasm', 'runtime/edit-model/ONNX-LICENSE.txt', 'engine-test/cases.json', 'scripts/test-edit-model.mjs']));
});
test('research, local outputs and weights are rejected even after force-adding ignored files', () => {
  for (const file of ['training/train.py', 'extension/training/data.json', 'research/report.json', 'datasets/pairs.json', 'benchmarks/private.json', 'models/export.json', '.cache/pairs.json', '.local-backup/source.zip', 'extension/model.wwedit', 'extension/model.onnx', 'extension/weights.safetensors', 'docs/pairs.jsonl', 'archive.bundle']) {
    assert.throws(() => assertPublicPaths([file]), /cannot enter Wordwell/);
  }
});
