# Performance experiments

Measured on 2026-10-30 using the existing Qwen3.5-0.8B UD-Q6_K_XL GGUF, wllama 3.8.1, Chromium 156, and a 1,024-token context. No model downloads or cloud inference were used.

## Results

| Experiment | Median correction time | Result |
| --- | ---: | --- |
| Default Intel WebGPU, 8 threads | 1.96–1.99 s | Baseline; repeated runs stayed within this range |
| Prompt caching | 1.99 s | Zero reused tokens for these different sentences; identical outputs |
| Batch/ubatch 256 instead of 128 | 1.96 s | No useful gain; identical outputs |
| 4 threads | 1.99 s | No useful gain; identical outputs |
| 1 thread | 1.98 s | No useful gain; identical outputs |
| Shorter instruction | 1.99 s | No useful median gain; weakened one correction |
| CPU-only, 8 threads | 3.34 s | Slower; identical outputs |
| NVIDIA WebGPU, original settings | 0.60 s | About 70% less time than the Intel baseline |

The NVIDIA baseline and repeated baseline each ran all 16 sentences twice, reversing their order in the second round. A third NVIDIA run tested caching. All 96 NVIDIA outputs matched the Intel baseline for those inputs, including the already-correct controls. NVIDIA caching still reused zero tokens and provided no useful gain. These checks support preserving behavior on this small set; they do not establish general grammar accuracy.

For the original instruction, median prompt processing fell from about 1,269 ms on Intel to 359 ms on NVIDIA, while median output generation fell from 726 ms to 238 ms. Both the adapter probe and the inference engine's native log reported NVIDIA/Lovelace in the faster run. The installed Google Chrome 156.0.8078.48 also selected Intel by default and NVIDIA with the same startup flags.

These are warmed inference times, excluding model load and the automatic checker's **1.2-second typing pause**. The headless baseline differs from the approximately 1.4 seconds observed interactively. Longer passages take more time. NVIDIA may also consume more power on battery.

The extension's model, correction instruction, cache policy, threads, and batch sizes retain their original behavior. The experiment exports the existing instruction so the benchmark imports the same text instead of maintaining a second copy.

## Try the faster GPU in your normal Chrome

1. Save your work and exit Chrome completely. Background Chrome processes must also stop; startup flags do not change an existing browser process.
2. From the repository root, run:

   ```powershell
   .\start-fast-chrome.ps1
   ```

3. Open Wordwell. Under **Engine details**, verify `adapter.vendor` is `nvidia`, then check the same sentences you checked before.

The launcher uses the existing Google Chrome installation and normal profile, including the extension and remembered model. It refuses to start while a Chrome process exists. It does not terminate Chrome, change Windows/Chrome settings, edit shortcuts, or promise a specific GPU on other machines. Fully exit Chrome and reopen it normally to restore default GPU selection. Use `-ShowCommand` to inspect the command without launching anything.

The tested switches are `--force-high-performance-gpu` and `--use-webgpu-power-preference=force-high-performance`. They are Chromium startup controls, not extension permissions. See Chromium's [GPU switch definitions](https://github.com/chromium/chromium/blob/main/gpu/config/gpu_switches.cc).

## Reproduce the experiment

Activate the repository's Conda environment first. Keep the machine's power mode and other workloads consistent. Experiments run sequentially in a disposable extension profile, block external HTTP requests, exclude one warmup generation per configuration, and remove the profile after closing the browser.

```powershell
conda activate .\.conda
npm run build:extension
npm run benchmark:extension
```

By default this tests `baseline,cache,batch256,threads4,threads1,baseline-repeat` against all 16 cases in `engine-test/cases.json`. Results include per-sentence outputs, completion status, prompt/generation timings, token usage, adapter information, median/p90 latency, exact reference matches, and differences from the baseline. Reference matches are a comparison aid, not an accuracy score; alternative wording may be valid.

For the GPU comparison:

```powershell
$env:PERF_GPU_PREFERENCE = 'high'
$env:PERF_CONFIGS = 'baseline,cache,baseline-repeat'
$env:PERF_ROUNDS = '2'
$env:REPORT_NAME = 'nvidia'
npm run benchmark:extension
```

For prompt/CPU comparisons, clear `PERF_GPU_PREFERENCE`, set `PERF_CONFIGS` to `baseline,short-prompt,cpu,baseline-repeat`, and choose another `REPORT_NAME`. `PERF_PROBE=1` inspects adapter selection without loading the model. `MODEL_FILE_PATH` can select a different local GGUF. `HEADED=1` makes the isolated test browser visible. Clear experimental environment variables before unrelated tests.

Reports from the measured runs are in ignored local files `artifacts/performance-sweep.json`, `artifacts/performance-prompt-cpu.json`, `artifacts/performance-nvidia.json`, and `artifacts/performance-installed-chrome.json`. To exercise the complete extension with the faster GPU, run `npm run test:extension` with `PERF_GPU_PREFERENCE=high`.
