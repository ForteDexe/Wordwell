# Packaged edit runtime

`npm ci` installs ONNX Runtime Web 1.31.1 and Hugging Face Tokenizers.js 0.2.0,
pinned with integrity hashes in package-lock.json. `scripts/build-extension.mjs`
copies only the WebGPU entry module, the matching asyncify WASM loader and binary,
and the tokenizer module. The WASM loader is required even with WebGPU. Inference
runs in a same-origin module worker with one WASM thread, so no blob workers,
runtime eval, CDN scripts, or relaxed CSP are needed.

`ONNX-LICENSE.txt` and `ONNX-ThirdPartyNotices.txt` are copied verbatim from
https://github.com/microsoft/onnxruntime/tree/v1.31.1. Tokenizers.js's Apache-2.0
license is copied from its installed package. The build includes these notices
alongside the runtime. Neural weights are separate local data and are not shipped.

See [edit-engine usage and export](../../docs/edit-engine.md).
