# Browser runtime with exact token counts

This is wllama 3.8.1 and its pinned llama.cpp runtime (`b11364-46ca246`),
rebuilt with one additional `count_tokens` action. It uses the model already
loaded for inference; it does not load a second model or run its layers.

`count-tokens.inc` goes inside `wllama_context`. The action reuses
`oaicompat_chat_params_parse` and `tokenize_input_prompts`, matching chat
completion's template options, generation prefix, special-token parsing, and
BOS/EOS handling. It also counts the raw user text to size the output allowance.
It uses existing GLUE request/response types, so the npm package stays intact.
`scripts/package-workers.mjs` exposes the action as `countChatTokens(options)`
and packages the matching generated JavaScript and WASM as static MV3 workers.

The checked-in `wllama.js`, `wllama.wasm`, and matching debug symbol table allow a normal extension build to
run without a C++ toolchain or network access. Both projects use the MIT license;
their licenses are included here and in the extension's generated vendor folder.

To rebuild on Windows, install npm dependencies and create the repo's `.conda`
environment with Python and Node. CMake and Git must be on PATH. Run:

```powershell
.\scripts\build-runtime.ps1
npm run build:extension
npm run test:budget
npm run test:extension
```

The rebuild script downloads Emscripten **4.0.20**, llama.cpp **46ca246** (verified
archive SHA-256), and Dawn WebGPU **v20260317.182325** into ignored `.tools/`.
It installs Ninja in `.conda` if needed. SDK activation is local to `.tools`.
The ordinary extension build needs none of these downloads.

The real-model browser tests compare preflight counts with inference's
`usage.prompt_tokens`, including Unicode, embedded special tokens, and newlines.
Each actual correction checks this equality too. Context shifting is disabled,
and a mismatch, truncated output, or failed chunk rejects the complete result.
