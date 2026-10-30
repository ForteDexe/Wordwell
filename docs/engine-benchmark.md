# Standalone engine benchmark

Run all commands from the repository root.

For extension performance measurements and the optional NVIDIA startup launcher, see [Performance experiments](performance.md). The measured improvement on this laptop came from selecting the faster GPU; the model and correction instruction stayed the same.

A separate browser benchmark for the local model engine. Use it to compare model quality or backends without loading the extension.

## Run on Windows

From the repository root:

```powershell
conda activate .\.conda
npm ci
.\start-engine-test.ps1
```

Open **http://127.0.0.1:8766**, click **Load model**, then correct a sentence or run the grammar set. Keep the PowerShell server running; Ctrl+C stops it. **Unload** releases the model from the browser.

Put the downloaded model in the repository models folder:

```text
models/Qwen3.5-0.8B-UD-Q6_K_XL.gguf
```

The server reads the model without modifying or copying the source file. It serves static assets and model bytes only; inference happens in the browser. Model weights and inference assets are local, with no CDN or cloud inference endpoint. The model is not persistently cached by the app. A model load fetches it again from your disk.

Context is explicitly **1,024 tokens**, shared between the instructions, input, and output. Output is capped at 128 tokens, thinking is disabled, and sampling uses temperature 0 with seed 42. Use short sentences or paragraphs for this test.

Optional server configuration:

```powershell
$env:MODEL_DIR = '.\models'
$env:PORT = '8766'
npm start
```

Only the engine-test assets, wllama assets, and GGUF files from the configured model folder are served. The server binds to 127.0.0.1 and sends the isolation headers required for multithreaded WASM. It does not serve `.conda` or `.ref`.

## Automated browser check

With the Conda environment activated:

```powershell
npm run test:engine
```

This launches the installed Google Chrome in a separate headless session, starts a temporary local file server, loads the model, verifies the actual loaded context, and runs the 16-case grammar set. External HTTP requests are blocked and recorded as test failures. Output and engine details are saved under `artifacts/engine-auto.json`, with a screenshot alongside it. The test closes its browser and temporary server when finished.

Optional variations:

```powershell
$env:BACKEND = 'cpu' # auto (default), cpu, or gpu
$env:MODEL_FILE = 'Qwen3.5-0.8B-BF16.gguf'
$env:REPORT_NAME = 'bf16-cpu'
npm run test:engine
```

The initial verified run used `auto` with UD-Q6_K_XL. The other combinations must be tested separately; sharing the GGUF format is not proof of support for every architecture or quant.

The automated PASS means the engine loaded at 1,024 tokens, all generations finished, and there were no page errors or external requests. It does **not** mean all English corrections were right. Reference sentences are examples; different wording may also be valid.

## Initial result, 2026-10-29

- Model: Qwen3.5-0.8B UD-Q6_K_XL, 771,092,736 bytes.
- Engine: wllama 3.8.1, Chrome 156, WebGPU; reported adapter Intel Gen-12LP.
- Actual context: 1,024 tokens; multithread enabled with eight threads requested.
- Load including reading the local model: 6.28 seconds.
- Median correction time: 1.79 seconds; range 1.61–2.91 seconds.
- All 16 generations completed normally; no page errors or external HTTP requests.
- Manual assessment of the 14 incorrect sentences: 10 corrected, one partially corrected, three unchanged despite errors. Both already-correct controls stayed unchanged.

Examples of remaining errors:

- `I am living here since five years.` became `I have been living here since five years.` The tense improved, but `since` should be `for`.
- `Can you explain me how this works?` remained unchanged; it needs `explain to me`.
- `I have finished my work yesterday.` remained unchanged; the reference uses `I finished`.
- `I am agree with you.` remained unchanged; it needs `I agree`.

This is a small handpicked smoke test, not a general accuracy benchmark. Model quality varies; review every proposed edit.
