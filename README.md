# Wordwell

Chrome extension for reviewing sentence corrections with a local GGUF model, including automatic checks after typing, correction underlines, a processing icon, and a Harper-style suggestion card. The standalone engine test remains available below.

## Install the extension

From the repository root, with the Conda environment activated:

```powershell
conda activate .\.conda
npm ci
npm run build:extension
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this repository's **`dist/extension`** folder.
3. Pin **Wordwell**, then click its toolbar icon to open the workspace.
4. Choose `D:\LLM_Models\Qwen3.5-0.8B\Qwen3.5-0.8B-UD-Q6_K_XL.gguf` and click **Load model**.
5. Type in the workspace's **Original** box or a webpage text box, then pause for **1.2 seconds**. The icon at the bottom-right spins while the model checks your writing. Click an underlined word or phrase to review it, then choose **Replace** or **Ignore**. After Replace, the updated sentence is checked again.
6. You can still select text and click the **bulb** beside the suggestion count at the bottom-right of the text box for a manual sentence check. The bulb appears only while text is selected; the card opens near the selected passage. It shows one corrected passage, with added or changed words highlighted in green, and a **Replace** button. Expand **Show changes** to inspect the original and removed words. **Ctrl+Z** undoes a replacement. Automatic suggestion cards have **<** and **>** buttons with a position count to review the current text box's suggestions without running another check; arrows are disabled at the ends of the list.

**Automatic checking** (after a typing pause) is enabled by default and can be turned off in the workspace's **Settings** section. The choice applies to website text boxes and the test area, and is remembered across pages and browser restarts. Automatic checking examines changed sentences rather than isolated words; nearby edits and related auxiliary/negation edits are grouped into a phrase. Unchanged sentences reuse a small in-memory cache. Ignore suppresses that suggestion while its sentence remains unchanged. Typing clears stale underlines, supersedes queued work, and discards results for an older source. Checks wait for IME composition to finish.

Both manual and automatic checks count the fully formatted prompt using the loaded model's native tokenizer. Each request must fit the selected context (**1,024 tokens by default**), including an output allowance of at least **128 tokens** (or **125% of the input text's tokens plus 16**, whichever is larger), and a **16-token safety margin**. If it cannot fit, the extension splits by **newlines**, then oversized lines by **periods**, then oversized sentences by **commas**. It checks pieces in order and preserves separators, indentation, and blank lines while joining the corrections. A piece that still cannot fit produces an error; it is never silently cut. No partial combined correction is returned if any piece fails or hits its output limit. Requests have separate resource limits of 50,000 characters and 128 chunks; these are not token estimates. Exact input counts do not predict the correction's final length.

The test area's character count has a live **prompt-token count** beside it. It includes instructions and chat formatting; hover for the text-only count, output allowance, and whether splitting is needed. Counting uses the loaded model without generating text and waits while a grammar check is running. **Settings → Context size** accepts whole numbers from 512 to 8,192 tokens. Values round up to 256-token blocks to match the engine (for example, 1,500 becomes 1,536). The selection is saved for future autoloads. For a loaded model, choose **Apply and reload model** to activate a new context; the counter and header continue showing the actual loaded context until then. Reloading reuses the selected model and does not rewrite its saved copy. Larger contexts use more memory. Run `npm run test:workspace` for focused checks of the counter, context reload, saved settings, and runtime serialization.

**Settings → Correction language** selects the language you are writing in. Choices include English (default), Vietnamese, Spanish, French, German, Italian, Brazilian Portuguese, Simplified/Traditional Chinese, Japanese, and Korean. English has one choice, with no US/UK distinction. This preference is saved and applies immediately to manual and automatic checks without reloading the model. It changes the proofreading instruction. Default English keeps the original tested prompt; language-specific choices explicitly ask the model to leave other languages unchanged. It is a correction setting rather than a translation mode. Token counts use the actual prompt. Changing language or the saved prompt clears cached/ignored suggestions and open cards; editors are checked again when focused. A running request keeps one language and prompt across its chunks, and results from older settings are discarded by the UI.

The collapsed **Settings → Correction prompt** row contains the default prompt as editable text. Edit it and choose **Save prompt** to save a global override, or leave it blank (including whitespace-only text) and save to use the selected language's default. **Load default** provides a fresh starting point for editing. A custom prompt fully replaces the default instruction, even when you select another language. Changes apply without a model reload and persist across browser starts. Prompt text is included in exact token budgeting; an override that leaves no room for a correction produces an error. The prompt editor itself is excluded from automatic and selection checks.

**Settings → Translation → Text box translation** is off by default. Enable it and choose **Translate into**, then select text in a supported editor. A translation icon appears between the bulb and the suggestion count. Click it to review a translation, then choose **Replace** to replace only the saved selection; native Undo remains available.

Enable **Instant translation** to skip that preview: clicking the text-box translation icon shows progress on the icon, then replaces the selected text directly. Native Undo and editor replacement checks still apply. Changes to the draft or translation settings discard pending results. This setting is remembered and applies only to text-box translation; page selections keep their translation card and Copy button.

**Page selection translation** is a separate, optional setting for selected webpage text, such as articles and posted comments. Choose **Page translation language**, then select text to reveal a translation icon beside the selection after releasing the mouse. The selection UI stays hidden during dragging so it does not disturb Chrome's native selection. Its card shows the selected text and translation with **Copy translation**. It leaves the webpage unchanged and also supports read-only text controls. Password fields are excluded. Each translation mode remembers its own enabled state and language.

Translation runs only when requested, shares the loaded model and request queue, and uses its own instruction independently of the correction language/custom prompt. Changing the target or disabling the matching translation mode discards pending review results; changing the selected source also invalidates its card. Translation uses exact prompt counts, the same context limit and splitting order, and a larger output allowance for language expansion. Truncated results are rejected. The live counter in the workspace continues to show the correction prompt's budget.

Language quality depends on the loaded model. The Qwen3.5-0.8B smoke tests correct English and Spanish grammar, preserve correct French/Vietnamese/Japanese examples, and leave English unchanged in a French check. These settings cannot guarantee a model's accuracy. Automatic sentence handling uses the selected locale and also handles unspaced Japanese/Chinese text; long passages can split at full-width periods and commas.

The bottom-right icon shows **…** while waiting for a typing pause, a **spinner** while a request is pending, a **number** when suggestions are available, or **!** when checking fails. Hover for the status or error. Click a suggestion count to review the first correction, or click an idle/error icon to retry. An icon reporting no suggested changes is not a guarantee of correct grammar. With automatic checking paused, the icon opens the workspace settings.

Selecting text only shows the manual bulb; clicking it explicitly requests a check. Both checking flows reuse the model already loaded in the workspace tab and do not navigate away from your writing. Requests share a serial queue, with explicit checks taking priority over queued automatic work. An already-running generation finishes before the newest request runs. Escape or clicking outside closes a suggestion card. Replace updates only the highlighted word/phrase or original manual selection and refuses to overwrite a source that has changed. It respects character limits and an editor's cancellation of the edit. If no changes are suggested, Replace is disabled.

Ordinary writable textareas, supported single-line text inputs, and basic contenteditable fields work on HTTP/HTTPS pages, including fields inside open, closed, and nested web-component shadow roots. Selection is read from the editor's own root, and closed-root typing events are resolved to the actual focused field. Password, disabled, and read-only fields remain excluded inside components. The workspace explicitly loads the same inline script so its **Original** box is also a test surface; its read-only **Suggested correction** box is excluded. Advanced editors such as Google Docs and editors with specialized document models may need additional integration. The icon and card use their own shadow root to isolate their style from the website.

Reddit and YouTube comment flows were confirmed working by the user on 2026-10-30. Automated component and layout fixtures cover their known failure cases. The shadow-editor regression uses real keyboard selection: creating a Range in page JavaScript can hide Chrome's page-level selection issue. Fixtures verify the icon, correction, Replace, native editor input, Undo, and closed-root automatic checks.

The writing overlay uses a manual popover so native dialogs cannot cover it. When editing in a modal, the overlay stays inside that modal to keep its controls interactive. Textarea measurement is isolated from website styles. Underlines use actual text rectangles for inline editors, which can report zero client dimensions, and follow their real clipping/scrolling ancestors. If a controlled editor recreates its text nodes without changing the draft, automatic suggestions are rebound to the unchanged text instead of disappearing.

Clipping uses the browser's intersection calculation rather than intersecting every ancestor's overflow box. Positioned editors can remain visible outside a collapsed wrapper; treating that wrapper as a clip incorrectly removes all underline rectangles. Geometry diagnostics include raw text rectangles, the browser's visible area, and the final clipped boxes. Scroll and resize events refresh the observation, and unchanged observations do not rebuild the controls.

The overlay host itself is protected from page styles as well as its shadow contents. Some sites hide undefined custom elements or reset all popovers; a high z-index and an open popover do not override those visibility rules. Visibility regressions check actual painting/hit testing for the icon, status, underlines, and Replace button under such rules, including a slotted Reddit-style Markdown composer.

Automatic checking also follows changes made by the site's editor after its input event, including whitespace normalization. A change in the focused field restarts the typing-pause timer instead of cancelling checking. Only the focused field is sampled as a fallback for missing input events; other fields are not periodically scanned.

If a website still fails, right-click inside its text box and choose **Wordwell: Diagnose this editor**. The workspace opens with **Website editor diagnostics** expanded. Repeat for other failing editors, then click **Copy diagnostics** and paste the report into the debugging conversation. The last five reports are kept for this browser session. Reports contain the hostname, extension version, editor structure, sizes, selection lengths, event counts, checking state, and overlay computed styles/positions/hit tests; they exclude comment text and password values. Nothing is uploaded automatically. **Clear reports** removes them. A missing content script produces its own report, so stale/inaccessible pages can be distinguished from editor bugs.

You can also paste text in the workspace, or select webpage text, right-click, and choose **Check with Wordwell** to send it there. The workspace's standalone check retains **Copy correction** for this manual paste/check flow; use its underlines or inline selection icon for Replace. Every edit requires your acceptance. The content script has access to HTTP/HTTPS pages to display the writing UI. With automatic checking enabled, changed sentences in the field you are editing are sent to the local model after a pause. It does not scan every field on the page merely because the page opened.

After you load a model successfully, the extension remembers one local copy. It autoloads when the workspace is reopened or refreshed. When Chrome starts, the extension opens a background workspace tab and loads the saved model without another file-picker prompt. Keep that tab open to reuse the loaded model. Clicking the toolbar icon or sending another selection focuses the existing workspace rather than reloading it. The loaded tab is marked non-discardable to reduce automatic unloading.

**Unload** releases the current engine but retains the saved copy for the next workspace/browser startup. **Forget model** removes the saved copy and disables autoload; an already-loaded engine stays available until you unload or close it. To replace the remembered model, unload, choose another GGUF, and load it.

The toolbar icon shows **...** while loading and a red **!** if loading, restoring, or checking fails. Hover over the icon for the reason, or click it to open the workspace error. A successful load/check clears the error badge.

The extension needs no Node server, llama.cpp server, cloud endpoint, model download, or CDN at runtime. The remembered model is stored as a File in the extension's IndexedDB, using about the model's file size in local profile storage (771 MB for the tested quant). Only one selected-model record is retained. The extension requests `unlimitedStorage` to keep this large cache from quota restrictions/automatic eviction. All JavaScript, worker files, and WebAssembly are bundled in the extension. The original GGUF is not modified.

Context is **1,024 tokens**, with a 128-token output cap and thinking disabled. This first version accepts one GGUF file under 2 GB, intended for short passages. Only the supplied Qwen3.5-0.8B UD-Q6_K_XL has been verified so far. Other architectures or quants need their own compatibility check.

The model can miss mistakes or suggest unwanted edits. In particular, **No changes suggested** is not a guarantee of correct English. Original text remains unchanged until you choose **Replace**, use **Instant translation**, or manually paste a correction.

### Verify and rebuild

```powershell
npm run build:extension
npm run test:diff
npm run test:extension
```

For a focused run of editor diagnostics, overlay visibility, and YouTube geometry checks, use `npm run test:editors`. Run `npm run test:selection-drag` to check native mouse selection on the workspace and a website, including open and closed shadow roots, without loading a model. Browser tests remove their generated profile and local model cache after closing the browser; reports and screenshots remain in the ignored `artifacts/` directory.

The automated browser test uses a separate Chrome for Testing profile and your real model file. It checks file validation, the loaded context, full-sentence correction, model reuse, selected-text routing, workspace copy, long-input rejection, and unload. It also verifies the inline icon/popup under a strict website CSP, changed/removed highlights, Replace in textareas/inputs/basic rich text, native input events, Ctrl+Z, partial selections, preservation of surrounding formatting, unchanged suggestions, editor cancellation, excluded fields, stale-result suppression, and viewport/scroll positioning. Automatic-checking checks cover debounce timing, the bottom-right spinner, clickable underlines, replacing and rescanning, Ignore, unchanged-sentence reuse, the persistent toggle, latest-text handling during inference, rich text, IME composition, input limits, and the shared queue. The diff tests cover punctuation, repeated words, whitespace, Unicode, literal markup text, sentence offsets, and grouped automatic edits. The persistence checks reload the workspace, fully close/reopen the browser profile, verify automatic restoration and real inference, simulate a missing cached model, and verify the error badge and Forget recovery. The only HTTP requests allowed during the browser test are to its own local website fixture. It exercises the shared context-menu selection handler; the native Chrome right-click menu itself is for manual testing. Results and screenshots are saved under `artifacts/`, including `extension-test.json`, `automatic-checking.png`, and `automatic-suggestion.png`.

Sources are in `extension/`; generated files are in `dist/extension/`. The build adapts wllama 3.8.1's generated Blob workers to packaged workers required by Chrome's MV3 content security policy. This adapter is version-guarded in `scripts/package-workers.mjs`; review it before upgrading wllama. The runtime includes a small native token-counting addition; its source, packaged binaries, licenses, and rebuild instructions are in [runtime/wllama](runtime/wllama/README.md). Third-party licensing is included under the generated `vendor/` folder. Run `npm run test:budget` for split-order and boundary tests; the real-model extension suite also verifies counts against inference usage and long-text corrections.

Wordwell uses a matching pen-nib mark in the workspace, text-box indicator, toolbar, and extension listing. The workspace and inline mark use `currentColor`; set `--wordwell-accent` to change their accent, with teal as the fallback. Inline overlays also accept the older `--local-english-accent` property. Chrome icons are PNGs exported from [extension/icons/wordwell.svg](extension/icons/wordwell.svg); run `npm run build:icons` after editing that vector master, then rebuild the extension. The exported sizes are 16, 32, 48, and 128 pixels.

If the test browser has not been installed yet:

```powershell
npx playwright install chromium
```

After rebuilding, reload Wordwell in `chrome://extensions`, accept any requested permissions, and refresh its workspace tab and the webpages where you want the selection icon. Browser-native clipping and expanded geometry diagnostics are in version **0.5.6**. On the first update to the remembered-model version, choose/load your model once to create the saved copy. Subsequent workspace/browser starts autoload it.

The inline card's surfaces and typography adapt Harper's `SuggestionBox.ts` (Apache-2.0). Attribution and the license are included in the extension. Automatic underlines come from the local model's proposed edits; Harper's original rule engine has not been added.

Chrome on Windows currently ignores the WebGPU `powerPreference` hint. The app omits that hint on Windows to avoid the resulting console warning; WebGPU remains enabled and Chrome chooses its adapter. This does not force NVIDIA/CUDA or switch inference to CPU.

## Standalone engine test

For extension performance measurements and the optional NVIDIA startup launcher, see [Performance experiments](docs/performance.md). The measured improvement on this laptop came from selecting the faster GPU; the model and correction instruction stayed the same.

A separate browser benchmark for the local model engine. Use it to compare model quality or backends without loading the extension.

## Run on Windows

From the repository root:

```powershell
conda activate .\.conda
npm ci
.\start-engine-test.ps1
```

Open **http://127.0.0.1:8766**, click **Load model**, then correct a sentence or run the grammar set. Keep the PowerShell server running; Ctrl+C stops it. **Unload** releases the model from the browser.

The default model is your existing file:

```text
D:\LLM_Models\Qwen3.5-0.8B\Qwen3.5-0.8B-UD-Q6_K_XL.gguf
```

The server reads the model without modifying or copying the source file. It serves static assets and model bytes only; inference happens in the browser. Model weights and inference assets are local, with no CDN or cloud inference endpoint. The model is not persistently cached by the app. A model load fetches it again from your disk.

Context is explicitly **1,024 tokens**, shared between the instructions, input, and output. Output is capped at 128 tokens, thinking is disabled, and sampling uses temperature 0 with seed 42. Use short sentences or paragraphs for this test.

Optional server configuration:

```powershell
$env:MODEL_DIR = 'D:\LLM_Models\Qwen3.5-0.8B'
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

This is a small handpicked smoke test, not a general accuracy benchmark. The original Harper checkout and earlier tests are archived under `.ref`; `.conda` remains at the root.
