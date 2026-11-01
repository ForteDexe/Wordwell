# Development

Run commands from the repository root. Node.js 24 or newer and npm are required. Python/Conda is optional for development; the existing repo-local environment is kept in the ignored `.conda` folder.

```powershell
# If using the existing Conda environment:
conda activate .\.conda
npm ci
npx playwright install chromium
npm run build:extension
```

Load `dist/extension` in Chrome's Load unpacked dialog. Reload the extension and refresh its workspace and affected websites after rebuilding. The build safely replaces its output directory so deleted source files cannot remain in a release.

## Models and tests

Put the recommended model in `models/Qwen3.5-0.8B-UD-Q4_K_XL.gguf`, or set `MODEL_FILE_PATH` to its full path. Model files are ignored by Git and never bundled into the release. For the standalone server, use `MODEL_DIR` to point at a model directory instead.

```powershell
$env:MODEL_FILE_PATH = 'C:\Models\Qwen3.5-0.8B-UD-Q4_K_XL.gguf'
npm run test:budget
npm run test:diff
npm run test:package
npm run test:selection-drag
npm run test:install
npm run test:workspace
npm run test:extension
```

`test:workspace` covers browser-model settings, exact token counts, prompt overrides, and translation. `test:server` starts a temporary fake llama.cpp loopback server and verifies connection metadata, exact token budgeting, correction, persisted reconnection, and switching back to browser mode. `test:extension` also covers the website UI, rich and shadow editors, native Undo, diagnostics, clipping, inference reuse, autoload after a full browser restart, and cache failures. It uses a fresh Chrome for Testing profile and the real local model. External HTTP requests are blocked except for its own local fixture server. Reports and screenshots go to ignored `artifacts/`; browser profiles and their model copies are removed at the end.

`test:selection-drag` checks actual forward/backward mouse selection in document, open, and closed roots without loading a model. `test:editors` is a focused editor/geometry run. A passing functional test does not establish general language accuracy.

For supported machines, `$env:PERF_GPU_PREFERENCE = 'high'` adds the GPU switches only to the isolated test browser. The normal extension relies on Chrome's chosen adapter. See [performance notes](performance.md).

The [English edit engine](edit-engine.md) uses
a separate local `.wwedit` bundle. `npm run test:edit` checks its data format,
alignment, edits, and encoder-only budgeting; `test:edit-browser` exercises a real
bundle in a disposable Chrome profile. This mode does not replace existing GGUF
or server workflows.

`npm run test:spelling` builds and tests the opt-in English spelling component,
including its packaged worker, local dictionaries, settings persistence, inline
Replace, token budgeting, and translation bypass. It uses a disposable browser
profile and fake loopback server; no model download is required. The pinned
nspell runtime runs off the main thread. US/UK affix files must match before the
build merges raw dictionary entries (avoiding successive-parser compound-rule
regeneration). Licenses and affix/dictionary data ship together in `vendor/spelling`.

## Public source boundary

Model training, dataset curation, exports and full research benchmarks are maintained
separately. Building this extension never requires access to a training repository.
Only inference runtime code, model-format support and public functional fixtures
belong in this repository. Model weights and private datasets must not be committed.

```powershell
npm run setup:hooks
npm run check:public
```

The pre-push hook checks every new commit, so adding private files and deleting them
in a later commit still fails. CI repeats the source/history check. Release packaging
also rejects research directories, dataset files and model binaries. Ignore rules
help prevent accidental staging; they do not replace the history and package checks.
Previously published history remains intact.

## Release build

```powershell
npm run build:icons     # after editing the icon's SVG source
npm run build:release
npm run test:release
```

The release builder validates the MV3 manifest, approved permissions, bundled workers/WASM, required notices, icon sizes, and file paths. It produces a versioned ZIP with `manifest.json` at the archive root, a SHA-256 sidecar, and a per-file checksum manifest. ZIP entry order and timestamps are fixed, so identical build inputs produce identical archives. `test:release` extracts the actual ZIP and runs the real-model browser suite from those files. It also produces store screenshots and a validation report tied to the ZIP's checksum. Do not rebuild the archive between the final test and upload.

## Source layout

- `extension/`: workspace, background queue, model engine, language prompts, inline tools, and UI assets.
- `runtime/wllama/`: modified native runtime and token-counting source. See its README before rebuilding it.
- `scripts/`: build, release, test, and benchmark entry points.
- `test-fixtures/`: first-party editor fixtures and the writing demo used for screenshots.
- `docs/`: user/developer documentation and static privacy/landing pages for optional GitHub Pages hosting.

Generated `dist/`, models, `.conda`, `.ref`, `.tools`, browser profiles, and artifacts stay ignored. The npm package is marked private to prevent accidental npm publication; this does not control GitHub visibility.

## Runtime and theming

wllama 3.8.1's workers are adapted into packaged MV3 workers by `scripts/package-workers.mjs`. The adapter is version-guarded; review it before upgrading. All runtime JS and WASM are bundled, with no CDN. Exact counts use the same native chat formatter and tokenizer as completion. Context defaults to 1,024, with a 16-token safety margin and operation-specific output allowance. Chunks follow newlines, periods, then commas and preserve separators.

The workspace and text-box pen marks use `currentColor`. Set `--wordwell-accent` to change their accent; inline overlays also retain `--local-english-accent` for compatibility. PNG icons come from `extension/icons/wordwell.svg`. The 128px store icon includes 16px transparent padding; smaller toolbar icons use the full frame.

Internal `local-english-*` DOM and IndexedDB names are retained so the Wordwell rename preserves saved models and settings. They are implementation identifiers, not visible branding.
