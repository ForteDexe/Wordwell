# English edit engine

Select **Edit model** in the Engine dropdown, choose a local
`.wwedit` bundle, and click **Load model**. After loading, typing-pause checks,
underlines, selected-text correction, Replace, and the built-in benchmark use
that engine. Switch back to **Run model in Chrome** or **Connect to llama.cpp
server** at any time. Existing installations keep their current engine choice.

Only the selected engine is loaded. The previous browser model is unloaded and
the edit worker is terminated when leaving this mode. Your GGUF file, edit
bundle, server address, and preferences remain saved independently; the selected
engine autoloads when Chrome starts. **Forget model** in either browser mode
removes only that mode's saved file. There can be two model copies on disk, but
only one active model in Wordwell's workspace.

This engine supports **English correction only**. Translation and custom prompts
are unavailable; those settings are restored when you switch back. The encoder
reads its input context limit from the bundle. A shared budgeting policy reserves
32 tokens for iterative edits and uses the rest for each initial chunk. The current
research bundle declares 512 input tokens, including special tokens, giving a
480-token working budget. The header and token counter display the loaded limit;
before loading they do not assume a context size. It preserves line breaks and splits
oversized lines at periods, then commas. An indivisible oversized section fails
without applying a partial correction. At most five edit passes run per section.

The loader accepts declared contexts from 64 to 8,192 tokens. A bundle must
declare a limit supported by its actual ONNX model; editing metadata cannot extend
the learned position table.
There is no user-editable context setting in edit mode.

WebGPU is preferred; WebAssembly runs on the CPU when WebGPU cannot load the
model. The worker, tokenizer, JavaScript, and WASM are packaged locally. Model
bundles contain data, hashes, tokenizer assets, a verb dictionary, and an ONNX
graph; no model-supplied JavaScript is executed or downloaded. The extension's
permissions and Content Security Policy are unchanged.

## Model bundles

Obtain a compatible `.wwedit` bundle from its provider and load it locally. No
model weights are included or downloaded automatically. Each model keeps its own
license and usage restrictions; inspect the provider's terms before use.

Bundles contain an ONNX graph, tokenizer assets, edit labels and settings, a
verb-form dictionary, and SHA-256 checksums. The loader accepts BERT/RoBERTa
English edit models that implement this inference interface. A file extension
alone does not guarantee compatibility. GGUF models use Run model in Chrome.
Training datasets, teacher outputs and training/export scripts are not needed
by this extension.

## Development checks

```powershell
npm run build:extension
npm run test:edit
$env:EDIT_MODEL_PATH = 'C:\Models\english-edit-model.wwedit'
npm run test:edit-browser
```

The browser test uses a local bundle in a disposable Chrome profile and covers
workspace and inline corrections, automatic Replace, saved-model autoload,
engine switching and cache failures. Model copies in test profiles are removed
after the test. No model download or private research repository is required.

Decoder regression tests cover sentence-start insertions, literal edit-marker
text, dangling merges and spacing around inserted contractions. The decoder fixes
work with existing compatible bundles; no new model download is required.
