# Model evaluation

This directory preserves Wordwell's local correction and translation model evaluation from 2026-10-31.

## Contents

- [`correction-summary.md`](correction-summary.md): manually reviewed correction quality, controls, size, and performance across candidate models and quantizations.
- [`translation-summary.md`](translation-summary.md): manually reviewed English-to-Vietnamese and English-to-Simplified-Chinese quality.
- [`reports/correction/`](reports/correction/): raw correction outputs and runtime measurements.
- [`reports/translation/`](reports/translation/): raw translation outputs and runtime measurements.
- [`translation-cases.json`](translation-cases.json): translation quality cases and references.
- [`benchmark-translation.mjs`](benchmark-translation.mjs): browser-engine translation benchmark runner.

The correction runner is [`scripts/benchmark-extension.mjs`](../../scripts/benchmark-extension.mjs), and its cases are [`engine-test/cases.json`](../../engine-test/cases.json).

## Running the translation benchmark

Build the extension first, then set `MODEL_FILE_PATH` to a local GGUF and choose a report suffix:

```powershell
$env:MODEL_FILE_PATH = 'D:\path\to\model.gguf'
$env:REPORT_NAME = 'model-name'
$env:PERF_GPU_PREFERENCE = 'high'
.\.conda\node.exe benchmarks/model-evaluation/benchmark-translation.mjs
```

The runner uses Wordwell's packaged browser engine, production translation prompt, a 1,024-token context, deterministic sampling, and a disposable browser profile. Reports are written under `reports/translation/`.

## Interpretation

Exact reference matching is useful for correction but too strict for translation, where multiple outputs can be valid. The summaries therefore include manually reviewed acceptance scores and document the review criteria. Results are directional rather than a substitute for professional linguistic evaluation.
